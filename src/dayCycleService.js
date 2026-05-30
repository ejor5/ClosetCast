const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { dateAtTime, formatClockTime, formatLocalDate, addDays, startOfLocalDay } = require("./timeUtils");

const DAY_INDEXES = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

class DayCycleService {
  constructor(config, logger, onUpdate) {
    this.config = {
      enabled: true,
      windDownReminderTime: "22:00",
      sleepTime: "22:30",
      wakeTime: "09:00",
      triggerSleepFromApp: true,
      sleepScriptPath: "scripts/sleep-now.ps1",
      extraSleepWindows: [],
      ...config.dayCycle
    };
    this.extraSleepWindows = normalizeExtraSleepWindows(this.config.extraSleepWindows);
    this.projectRoot = config.__projectRoot;
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.lastMode = null;
    this.sleepTriggeredKey = null;
    this.state = this.buildState(new Date());
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  tick() {
    const nextState = this.buildState(new Date());
    this.publish(nextState);

    if (nextState.sleepDue && this.config.triggerSleepFromApp && this.sleepTriggeredKey !== nextState.sleepTriggerKey) {
      this.sleepTriggeredKey = nextState.sleepTriggerKey;
      this.logger.info("Sleep triggered", {
        sleepTime: nextState.sleepTriggerTime || this.config.sleepTime,
        window: nextState.sleepTriggerLabel || "Daily sleep"
      });
      this.triggerSleep();
      this.publish({ ...nextState, sleepTriggered: true, message: "Sleep command sent" });
    }
  }

  buildState(now) {
    const reminder = dateAtTime(now, this.config.windDownReminderTime, "22:00");
    const sleep = dateAtTime(now, this.config.sleepTime, "22:30");
    const todayWake = dateAtTime(now, this.config.wakeTime, "09:00");
    const activeExtraWindow = this.findActiveExtraSleepWindow(now);
    const nextExtraWindow = this.findNextExtraSleepWindow(now);
    const nextWake = now < todayWake ? todayWake : dateAtTime(addDays(now, 1), this.config.wakeTime, "09:00");
    const nextDailySleep = now < sleep ? sleep : dateAtTime(addDays(now, 1), this.config.sleepTime, "22:30");
    const nextSleep = activeExtraWindow?.start || earliestDate(nextDailySleep, nextExtraWindow?.start);
    const activeWake = activeExtraWindow?.end || nextWake;
    const windDownActive = this.config.enabled && now >= reminder && now < sleep;
    const dailySleepKey = `daily:${formatLocalDate(now)}`;
    const dailySleepDue = now >= sleep && this.sleepTriggeredKey !== dailySleepKey;
    const extraSleepDue = Boolean(activeExtraWindow && this.sleepTriggeredKey !== activeExtraWindow.key);
    const sleepDue = this.config.enabled && (dailySleepDue || extraSleepDue);
    const sleepTriggerKey = activeExtraWindow?.key || dailySleepKey;
    const sleepTriggerTime = activeExtraWindow?.startTime || this.config.sleepTime;
    const sleepTriggerLabel = activeExtraWindow?.label || "Daily sleep";

    let mode = "normal";
    let message = `Next sleep ${formatClockTime(nextSleep)}`;
    if (windDownActive) {
      mode = "winddown";
      message = `Wind-down until ${formatClockTime(sleep)}`;
    } else if (activeExtraWindow) {
      mode = "overnight";
      message = `${activeExtraWindow.label} until ${formatClockTime(activeExtraWindow.end)}`;
    } else if (now >= sleep || now < todayWake) {
      mode = "overnight";
      message = `Next wake ${formatClockTime(nextWake)}`;
    }

    return {
      enabled: Boolean(this.config.enabled),
      mode,
      message,
      localDate: formatLocalDate(now),
      reminderTime: this.config.windDownReminderTime,
      sleepTime: this.config.sleepTime,
      wakeTime: this.config.wakeTime,
      nextWake: activeWake.toISOString(),
      nextSleep: nextSleep.toISOString(),
      nextWakeLabel: formatClockTime(activeWake),
      nextSleepLabel: formatClockTime(nextSleep),
      minutesUntilSleep: Math.max(0, Math.ceil((nextSleep.getTime() - now.getTime()) / 60_000)),
      windDownActive,
      sleepDue,
      sleepTriggerKey,
      sleepTriggerTime,
      sleepTriggerLabel,
      sleepTriggered: false
    };
  }

  findActiveExtraSleepWindow(now) {
    return this.buildExtraWindowInstances(now, -1, 1)
      .filter((window) => now >= window.start && now < window.end)
      .sort((a, b) => a.end - b.end)[0] || null;
  }

  findNextExtraSleepWindow(now) {
    return this.buildExtraWindowInstances(now, 0, 7)
      .filter((window) => window.start > now)
      .sort((a, b) => a.start - b.start)[0] || null;
  }

  buildExtraWindowInstances(now, startOffset, endOffset) {
    const today = startOfLocalDay(now);
    const instances = [];
    for (let offset = startOffset; offset <= endOffset; offset++) {
      const day = addDays(today, offset);
      for (const window of this.extraSleepWindows) {
        if (!window.dayIndexes.includes(day.getDay())) continue;
        const start = dateAtTime(day, window.startTime, "00:00");
        let end = dateAtTime(day, window.endTime, "00:00");
        if (end <= start) end = addDays(end, 1);
        instances.push({
          ...window,
          start,
          end,
          key: `extra:${window.id}:${formatLocalDate(start)}`
        });
      }
    }
    return instances;
  }

  publish(nextState) {
    this.state = nextState;
    if (this.lastMode !== nextState.mode) {
      this.logger.info("Day cycle mode changed", { mode: nextState.mode, message: nextState.message });
      this.lastMode = nextState.mode;
    }
    this.onUpdate(nextState);
  }

  triggerSleep() {
    const sleepScript = path.isAbsolute(this.config.sleepScriptPath)
      ? this.config.sleepScriptPath
      : path.join(this.projectRoot, this.config.sleepScriptPath);
    const args = fs.existsSync(sleepScript)
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sleepScript]
      : [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Add-Type -Name PowerState -Namespace ClosetCast -MemberDefinition '[System.Runtime.InteropServices.DllImport(\"powrprof.dll\", SetLastError = true)] public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);'; [void][ClosetCast.PowerState]::SetSuspendState($false, $false, $false)"
      ];
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  }
}

function normalizeExtraSleepWindows(windows) {
  if (!Array.isArray(windows)) return [];
  return windows
    .map((window, index) => {
      const days = Array.isArray(window.days) ? window.days : [];
      const dayIndexes = days
        .map((day) => DAY_INDEXES[String(day).toLowerCase()])
        .filter((day) => Number.isInteger(day));
      return {
        id: window.id || `window-${index + 1}`,
        label: window.label || "Sleep window",
        days,
        dayIndexes,
        startTime: window.startTime,
        endTime: window.endTime
      };
    })
    .filter((window) => window.dayIndexes.length && isTimeText(window.startTime) && isTimeText(window.endTime));
}

function isTimeText(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ""));
}

function earliestDate(first, second) {
  if (!second) return first;
  return first < second ? first : second;
}

module.exports = { DayCycleService };
