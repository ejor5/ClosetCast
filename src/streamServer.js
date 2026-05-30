const http = require("http");
const { spawn } = require("child_process");
const { redactUrl } = require("./logger");

function createStreamServer(config, logger) {
  const host = config.streamServer.host || "127.0.0.1";
  const port = Number(config.streamServer.port || 4557);
  const ffmpegPath = config.ffmpegPath || "ffmpeg";
  const cameras = new Map(config.cameras.filter((camera) => camera.enabled !== false).map((camera) => [camera.id, camera]));
  const activeStreams = new Map();
  let rtspTransportCheck = { ok: true, message: "" };

  function buildArgs(camera) {
    const fps = config.lowCpuMode ? "4" : "8";
    const scale = config.lowCpuMode ? "640:-2" : "960:-2";
    return [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      "-i",
      camera.url,
      "-an",
      "-vf",
      `fps=${fps},scale=${scale}`,
      "-q:v",
      config.lowCpuMode ? "9" : "6",
      "-f",
      "mjpeg",
      "pipe:1"
    ];
  }

  function streamCamera(camera, response) {
    const startedAt = Date.now();
    const firstFrameTimeoutMs = Math.max(5, Number(config.streamServer.firstFrameTimeoutSeconds || 15)) * 1000;
    const stallTimeoutMs = Math.max(10, Number(config.streamServer.stallTimeoutSeconds || 25)) * 1000;
    let closed = false;
    let restartTimer = null;
    let frameWatchdog = null;
    let processRef = null;

    if (!rtspTransportCheck.ok) {
      response.writeHead(503, {
        "Cache-Control": "no-store",
        "Connection": "close",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(rtspTransportCheck.message);
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Connection": "close",
      "Content-Type": "multipart/x-mixed-replace; boundary=closetcast"
    });
    if (typeof response.flushHeaders === "function") response.flushHeaders();

    function clearFrameWatchdog() {
      if (frameWatchdog) clearInterval(frameWatchdog);
      frameWatchdog = null;
    }

    function start() {
      if (closed) return;
      clearFrameWatchdog();
      const lastStart = Date.now();
      let lastFrameAt = lastStart;
      let frameCount = 0;
      let stderrText = "";
      logger.info("Starting camera bridge", {
        camera: camera.name,
        url: redactUrl(camera.url),
        rtspTransport: "tcp"
      });
      activeStreams.set(camera.id, {
        camera: camera.name,
        startedAt,
        lastStart,
        status: "connecting",
        frames: 0,
        lastFrameAt: null
      });
      processRef = spawn(ffmpegPath, buildArgs(camera), { windowsHide: true });

      let pending = Buffer.alloc(0);
      frameWatchdog = setInterval(() => {
        if (closed || !processRef || processRef.killed) return;
        const timeoutMs = frameCount > 0 ? stallTimeoutMs : firstFrameTimeoutMs;
        const elapsedMs = Date.now() - lastFrameAt;
        if (elapsedMs < timeoutMs) return;

        const status = frameCount > 0 ? "stalled" : "no frames";
        activeStreams.set(camera.id, {
          camera: camera.name,
          startedAt,
          lastStart,
          status,
          frames: frameCount,
          lastFrameAt: frameCount > 0 ? lastFrameAt : null
        });
        logger.warn("Camera bridge frame timeout; reconnecting", {
          camera: camera.name,
          status,
          elapsedMs
        });
        clearFrameWatchdog();
        processRef.kill("SIGTERM");
      }, Math.min(5000, firstFrameTimeoutMs));

      processRef.stdout.on("data", (chunk) => {
        if (closed) return;
        pending = Buffer.concat([pending, chunk]);
        let startIndex = pending.indexOf(Buffer.from([0xff, 0xd8]));
        let endIndex = pending.indexOf(Buffer.from([0xff, 0xd9]), startIndex + 2);

        while (startIndex !== -1 && endIndex !== -1) {
          const frame = pending.subarray(startIndex, endIndex + 2);
          response.write(`--closetcast\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
          response.write(frame);
          response.write("\r\n");
          frameCount += 1;
          lastFrameAt = Date.now();
          activeStreams.set(camera.id, {
            camera: camera.name,
            startedAt,
            lastStart,
            status: "streaming",
            frames: frameCount,
            lastFrameAt
          });
          if (frameCount === 1) {
            logger.info("Camera bridge first frame received", { camera: camera.name });
          }
          pending = pending.subarray(endIndex + 2);
          startIndex = pending.indexOf(Buffer.from([0xff, 0xd8]));
          endIndex = pending.indexOf(Buffer.from([0xff, 0xd9]), startIndex + 2);
        }

        if (pending.length > 5_000_000) pending = Buffer.alloc(0);
      });

      processRef.stderr.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (!text) return;
        stderrText = `${stderrText}${text}\n`.slice(-2000);
        logger.warn("Camera bridge warning", { camera: camera.name, message: text.slice(0, 500) });
      });

      processRef.on("error", (error) => {
        logger.error("Camera bridge failed to start", { camera: camera.name, error: error.message });
      });

      processRef.on("close", (code) => {
        clearFrameWatchdog();
        activeStreams.delete(camera.id);
        if (closed) return;
        if (isUnsupportedRtspTransport(stderrText)) {
          rtspTransportCheck = {
            ok: false,
            message: FFMPEG_RTSP_TRANSPORT_WARNING
          };
          logger.error(FFMPEG_RTSP_TRANSPORT_WARNING, {
            camera: camera.name,
            ffmpegPath
          });
          return;
        }
        logger.warn("Camera bridge exited; reconnecting", { camera: camera.name, code });
        restartTimer = setTimeout(start, 5000);
      });
    }

    response.on("close", () => {
      closed = true;
      activeStreams.delete(camera.id);
      if (restartTimer) clearTimeout(restartTimer);
      clearFrameWatchdog();
      if (processRef && !processRef.killed) processRef.kill("SIGTERM");
    });

    start();
  }

  function serveDemoCamera(camera, response) {
    const colors = demoCameraColors(camera.id);
    const now = new Date();
    const label = escapeHtml(camera.name || camera.id || "Camera");
    const time = escapeHtml(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now));
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1080" viewBox="0 0 960 1080">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/>
      <stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient>
    <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
      <path d="M80 0H0V80" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="960" height="1080" fill="url(#sky)"/>
  <rect width="960" height="1080" fill="url(#grid)" opacity="0.62"/>
  <rect x="68" y="72" width="824" height="936" rx="46" fill="rgba(4,7,12,0.34)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  <circle cx="150" cy="148" r="10" fill="#86efac"/>
  <text x="178" y="158" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">DEMO FEED</text>
  <text x="92" y="886" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="66" font-weight="760">${label}</text>
  <text x="92" y="944" fill="#cbd5e1" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="600">${time}</text>
  <path d="M92 760 C 202 692, 292 720, 380 642 S 568 562, 692 630 S 842 702, 892 642 V1008 H92 Z" fill="rgba(255,255,255,0.13)"/>
</svg>`;
    response.writeHead(200, {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Type": "image/svg+xml; charset=utf-8"
    });
    response.end(svg);
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`);

    if (url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, streams: Array.from(activeStreams.values()) }));
      return;
    }

    if (url.pathname === "/youtube-player") {
      serveYouTubePlayer(url, response, `http://${host}:${port}`);
      return;
    }

    const match = url.pathname.match(/^\/camera\/(.+)\.mjpeg$/);
    if (!match) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    const cameraId = decodeURIComponent(match[1]);
    const camera = cameras.get(cameraId);
    if (!camera) {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Camera not configured");
      return;
    }

    if (isDemoCamera(camera)) {
      serveDemoCamera(camera, response);
      return;
    }

    streamCamera(camera, response);
  });

  return {
    baseUrl: `http://${host}:${port}`,
    async start() {
      const needsFfmpeg = Array.from(cameras.values()).some((camera) => !isDemoCamera(camera));
      if (needsFfmpeg) {
        rtspTransportCheck = await checkFfmpegRtspTransport(ffmpegPath);
        if (rtspTransportCheck.ok) {
          logger.info("FFmpeg RTSP transport option confirmed", { ffmpegPath });
        } else {
          logger.error(rtspTransportCheck.message, {
            ffmpegPath,
            details: rtspTransportCheck.details
          });
        }
      } else {
        rtspTransportCheck = { ok: true, message: "" };
        logger.info("Camera stream server using local demo feeds");
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          logger.info("Camera stream server listening", { host, port });
          resolve();
        });
      });
    },
    stop() {
      server.close();
    }
  };
}

const FFMPEG_RTSP_TRANSPORT_WARNING = "Your FFmpeg build does not support -rtsp_transport. Install a full FFmpeg build and update ffmpegPath.";

function isDemoCamera(camera) {
  return /^closetcast-demo:\/\//i.test(camera.url || "");
}

function demoCameraColors(id) {
  const palettes = [
    ["#111827", "#0e7490"],
    ["#18181b", "#6d28d9"],
    ["#082f49", "#0f766e"],
    ["#1f2937", "#b45309"],
    ["#0f172a", "#be123c"]
  ];
  const text = String(id || "");
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palettes[hash % palettes.length];
}

function checkFfmpegRtspTransport(ffmpegPath) {
  return new Promise((resolve) => {
    let child;
    let output = "";
    try {
      child = spawn(ffmpegPath, ["-hide_banner", "-h", "demuxer=rtsp"], { windowsHide: true });
    } catch (error) {
      resolve({
        ok: false,
        message: `FFmpeg could not be started from ffmpegPath: ${ffmpegPath}`,
        details: error.message
      });
      return;
    }

    child.stdout.on("data", (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-8000);
    });

    child.stderr.on("data", (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-8000);
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        message: `FFmpeg could not be started from ffmpegPath: ${ffmpegPath}`,
        details: error.message
      });
    });

    child.on("close", () => {
      if (/\brtsp_transport\b/i.test(output)) {
        resolve({ ok: true, message: "" });
        return;
      }
      resolve({
        ok: false,
        message: FFMPEG_RTSP_TRANSPORT_WARNING,
        details: output.trim().slice(-1000)
      });
    });
  });
}

function isUnsupportedRtspTransport(message) {
  return /rtsp_transport/i.test(message) && /(Unrecognized option|Option not found)/i.test(message);
}

function serveYouTubePlayer(url, response, origin) {
  const target = normalizeYouTubeEmbedUrl(url.searchParams.get("src"), origin);
  if (!target) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid YouTube embed URL");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; script-src 'unsafe-inline' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline';"
  });
  const player = buildYouTubePlayerConfig(target);
  response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #050505; }
    #player, iframe { width: 100%; height: 100%; border: 0; display: block; background: #050505; }
  </style>
  <script>
    const videoId = ${JSON.stringify(player.videoId)};
    const playerVars = ${JSON.stringify(player.playerVars)};
    const embedUrl = ${JSON.stringify(target)};
    const playerOrigin = new URL(embedUrl).origin;
    window.__closetCastYouTubeStatus = {
      unavailable: false,
      reason: "loading",
      ready: false,
      playing: false,
      state: "loading",
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    function playerFrame() {
      return document.getElementById("player");
    }
    function updateStatus(patch) {
      window.__closetCastYouTubeStatus = {
        ...window.__closetCastYouTubeStatus,
        ...patch,
        unavailable: false,
        updatedAt: Date.now()
      };
    }
    function markUnavailable(reason, code) {
      window.__closetCastYouTubeStatus = {
        ...window.__closetCastYouTubeStatus,
        unavailable: true,
        reason,
        code,
        updatedAt: Date.now()
      };
    }
    function playbackStateName(value) {
      if (value === -1) return "unstarted";
      if (value === 0) return "ended";
      if (value === 1) return "playing";
      if (value === 2) return "paused";
      if (value === 3) return "buffering";
      if (value === 5) return "cued";
      return "unknown";
    }
    function postToPlayer(message) {
      const frame = playerFrame();
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(JSON.stringify(message), playerOrigin);
    }
    function nudgePlayer() {
      postToPlayer({ event: "listening", id: "player" });
      if (playerVars.autoplay !== "0") {
        postToPlayer({ event: "command", func: "mute", args: [] });
        postToPlayer({ event: "command", func: "playVideo", args: [] });
      }
    }
    function installPlaybackWatchdog() {
      [12000, 22000].forEach((delay) => {
        setTimeout(() => {
          const status = window.__closetCastYouTubeStatus;
          if (status.unavailable || status.playing) return;
          markUnavailable("YouTube stayed black or did not start", status.state || "loading");
        }, delay);
      });
    }
    window.addEventListener("message", (event) => {
      if (!/https:\\/\\/(www\\.)?youtube(-nocookie)?\\.com$/.test(event.origin)) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (_) {
          data = {};
        }
      }
      if (!data || typeof data !== "object") return;
      if (data.event === "onReady") {
        updateStatus({ ready: true, state: "ready", reason: "ready" });
        nudgePlayer();
      }
      if (data.event === "onStateChange") {
        const state = playbackStateName(data.info);
        updateStatus({
          ready: true,
          playing: state === "playing",
          state,
          reason: state
        });
      }
      if (data.event === "infoDelivery" && data.info) {
        const state = data.info.playerState == null ? window.__closetCastYouTubeStatus.state : playbackStateName(data.info.playerState);
        updateStatus({
          ready: true,
          playing: state === "playing" || Number(data.info.currentTime || 0) > 0,
          state,
          reason: state
        });
      }
      if (data && data.event === "onError") {
        const code = data.info;
        const reason = code === 101 || code === 150
          ? "Video unavailable - watch on YouTube"
          : "YouTube player error";
        markUnavailable(reason, code);
      }
    });
    function startPlayerNudges() {
      nudgePlayer();
      [500, 1500, 3500, 7000].forEach((delay) => setTimeout(nudgePlayer, delay));
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startPlayerNudges);
    } else {
      startPlayerNudges();
    }
    installPlaybackWatchdog();
  </script>
</head>
<body>
  <iframe
    id="player"
    src="${escapeHtml(target)}"
    title="Ambient YouTube"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
    allowfullscreen
  ></iframe>
</body>
</html>`);
}

function buildYouTubePlayerConfig(rawUrl) {
  const url = new URL(rawUrl);
  const videoId = url.pathname.split("/").filter(Boolean)[1] || "";
  const playerVars = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "enablejsapi" || key === "origin" || key === "widget_referrer") continue;
    playerVars[key] = value;
  }
  playerVars.enablejsapi = "1";
  playerVars.vq = playerVars.vq || "hd720";
  return { videoId, playerVars };
}

function normalizeYouTubeEmbedUrl(rawUrl, origin) {
  try {
    const target = new URL(rawUrl || "");
    const hostname = target.hostname.replace(/^www\./, "");
    const allowedHosts = new Set(["youtube.com", "youtube-nocookie.com"]);
    if (!allowedHosts.has(hostname)) return "";
    if (!target.pathname.startsWith("/embed/")) return "";
    target.searchParams.set("enablejsapi", "1");
    target.searchParams.set("origin", origin);
    target.searchParams.set("widget_referrer", origin);
    return target.toString();
  } catch (_) {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  FFMPEG_RTSP_TRANSPORT_WARNING,
  checkFfmpegRtspTransport,
  createStreamServer,
  buildYouTubePlayerConfig,
  isUnsupportedRtspTransport,
  normalizeYouTubeEmbedUrl
};
