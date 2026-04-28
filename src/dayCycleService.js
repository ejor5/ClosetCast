const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { dateAtTime, formatClockTime, formatLocalDate, addDays } = require("./timeUtils");

class DayCycleService {
  constructor(config, logger, onUpdate) {
    this.config = {
      enabled: true,
      windDownReminderTime: "22:00",
      sleepTime: "22:30",
      wakeTime: "09:00",
      triggerSleepFromApp: true,
      sleepScriptPath: "scripts/sleep-now.ps1",
      ...config.dayCycle
    };
    this.projectRoot = config.__projectRoot;
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.lastMode = null;
    this.sleepTriggeredDate = null;
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

    if (nextState.sleepDue && this.config.triggerSleepFromApp && this.sleepTriggeredDate !== nextState.localDate) {
      this.sleepTriggeredDate = nextState.localDate;
      this.logger.info("Sleep triggered", { sleepTime: this.config.sleepTime });
      this.triggerSleep();
      this.publish({ ...nextState, sleepTriggered: true, message: "Sleep command sent" });
    }
  }

  buildState(now) {
    const reminder = dateAtTime(now, this.config.windDownReminderTime, "22:00");
    const sleep = dateAtTime(now, this.config.sleepTime, "22:30");
    const todayWake = dateAtTime(now, this.config.wakeTime, "09:00");
    const nextWake = now < todayWake ? todayWake : dateAtTime(addDays(now, 1), this.config.wakeTime, "09:00");
    const nextSleep = now < sleep ? sleep : dateAtTime(addDays(now, 1), this.config.sleepTime, "22:30");
    const windDownActive = this.config.enabled && now >= reminder && now < sleep;
    const sleepDue = this.config.enabled && now >= sleep && this.sleepTriggeredDate !== formatLocalDate(now);

    let mode = "normal";
    let message = `Next sleep ${formatClockTime(nextSleep)}`;
    if (windDownActive) {
      mode = "winddown";
      message = `Wind-down until ${formatClockTime(sleep)}`;
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
      nextWake: nextWake.toISOString(),
      nextSleep: nextSleep.toISOString(),
      nextWakeLabel: formatClockTime(nextWake),
      nextSleepLabel: formatClockTime(nextSleep),
      minutesUntilSleep: Math.max(0, Math.ceil((sleep.getTime() - now.getTime()) / 60_000)),
      windDownActive,
      sleepDue,
      sleepTriggered: false
    };
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

module.exports = { DayCycleService };
