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

module.exports = { createStreamServer };
