const http = require("http");
const { spawn } = require("child_process");
const { redactUrl } = require("./logger");

function createStreamServer(config, logger) {
  const host = config.streamServer.host || "127.0.0.1";
  const port = Number(config.streamServer.port || 4557);
  const cameras = new Map(config.cameras.filter((camera) => camera.enabled !== false).map((camera) => [camera.id, camera]));
  const activeStreams = new Map();

  function buildArgs(camera) {
    const fps = config.lowCpuMode ? "4" : "8";
    const scale = config.lowCpuMode ? "640:-2" : "960:-2";
    return [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      "-stimeout",
      "8000000",
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
    const ffmpegPath = config.ffmpegPath || "ffmpeg";
    let closed = false;
    let restartTimer = null;
    let processRef = null;

    response.writeHead(200, {
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Connection": "close",
      "Content-Type": "multipart/x-mixed-replace; boundary=closetcast"
    });

    function start() {
      if (closed) return;
      logger.info("Starting camera bridge", { camera: camera.name, url: redactUrl(camera.url) });
      activeStreams.set(camera.id, { camera: camera.name, startedAt, lastStart: Date.now() });
      processRef = spawn(ffmpegPath, buildArgs(camera), { windowsHide: true });

      let pending = Buffer.alloc(0);
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
          pending = pending.subarray(endIndex + 2);
          startIndex = pending.indexOf(Buffer.from([0xff, 0xd8]));
          endIndex = pending.indexOf(Buffer.from([0xff, 0xd9]), startIndex + 2);
        }

        if (pending.length > 5_000_000) pending = Buffer.alloc(0);
      });

      processRef.stderr.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) logger.warn("Camera bridge warning", { camera: camera.name, message: text.slice(0, 500) });
      });

      processRef.on("error", (error) => {
        logger.error("Camera bridge failed to start", { camera: camera.name, error: error.message });
      });

      processRef.on("close", (code) => {
        activeStreams.delete(camera.id);
        if (closed) return;
        logger.warn("Camera bridge exited; reconnecting", { camera: camera.name, code });
        restartTimer = setTimeout(start, 5000);
      });
    }

    response.on("close", () => {
      closed = true;
      activeStreams.delete(camera.id);
      if (restartTimer) clearTimeout(restartTimer);
      if (processRef && !processRef.killed) processRef.kill("SIGTERM");
    });

    start();
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

    streamCamera(camera, response);
  });

  return {
    baseUrl: `http://${host}:${port}`,
    start() {
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
    "Content-Security-Policy": "default-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'unsafe-inline';"
  });
  response.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #050505; }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #050505; }
  </style>
</head>
<body>
  <iframe
    src="${escapeHtml(target)}"
    allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen></iframe>
</body>
</html>`);
}

function normalizeYouTubeEmbedUrl(rawUrl, origin) {
  try {
    const target = new URL(rawUrl || "");
    const hostname = target.hostname.replace(/^www\./, "");
    const allowedHosts = new Set(["youtube.com", "youtube-nocookie.com"]);
    if (!allowedHosts.has(hostname)) return "";
    if (!target.pathname.startsWith("/embed/")) return "";
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

module.exports = { createStreamServer, normalizeYouTubeEmbedUrl };
