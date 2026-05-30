const { spawn } = require("child_process");
const path = require("path");
const { loadConfig } = require("../src/config");
const { checkFfmpegRtspTransport } = require("../src/streamServer");
const { redactUrl } = require("../src/logger");

if (process.argv[2]) {
  process.env.CLOSETCAST_CONFIG = path.resolve(process.argv[2]);
}

const config = loadConfig();
const enabledCameras = config.cameras.filter((camera) => camera.enabled !== false);
const ffmpegPath = config.ffmpegPath || "ffmpeg";
const timeoutMs = Math.max(5, Number(config.streamServer.firstFrameTimeoutSeconds || 15)) * 1000;

async function main() {
  console.log(`ClosetCast RTSP diagnostic`);
  console.log(`Config: ${config.__configPath}`);
  console.log(`FFmpeg: ${ffmpegPath}`);
  console.log(`Cameras: ${enabledCameras.length}`);

  console.log(`Checking RTSP demuxer: ${ffmpegPath} -hide_banner -h demuxer=rtsp`);
  const ffmpegCheck = await checkFfmpegRtspTransport(ffmpegPath);
  if (!ffmpegCheck.ok) {
    console.log(`FAIL FFmpeg: ${ffmpegCheck.message}`);
    if (ffmpegCheck.details) console.log(`  ffmpeg: ${summarizeStderr(ffmpegCheck.details)}`);
    process.exitCode = 1;
    return;
  }
  console.log("OK FFmpeg: rtsp_transport is supported");

  if (!enabledCameras.length) {
    console.log("No enabled cameras found.");
    return;
  }

  let failures = 0;
  for (const camera of enabledCameras) {
    const result = await checkCamera(camera);
    const label = result.ok ? "OK" : "FAIL";
    console.log(`${label} ${camera.name}: ${result.message}`);
    if (result.stderr) console.log(`  ffmpeg: ${result.stderr}`);
    if (!result.ok) failures += 1;
  }

  if (failures) {
    console.log("");
    console.log("At least one RTSP feed did not produce a frame. Check ffmpegPath, the camera IP, credentials, and that this laptop is on the same network as the camera/NVR.");
    process.exitCode = 1;
  }
}

function checkCamera(camera) {
  return new Promise((resolve) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      "-i",
      camera.url,
      "-frames:v",
      "1",
      "-f",
      "mjpeg",
      "pipe:1"
    ];
    let child;
    let finished = false;
    let bytes = 0;
    let stderr = "";

    try {
      child = spawn(ffmpegPath, args, { windowsHide: true });
    } catch (error) {
      resolve({
        ok: false,
        message: error.message,
        stderr: ""
      });
      return;
    }

    const timer = setTimeout(() => {
      finish(false, `timed out after ${Math.round(timeoutMs / 1000)}s with 0 frame bytes`);
    }, timeoutMs);

    function finish(ok, message) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      resolve({
        ok,
        message,
        stderr: summarizeStderr(stderr)
      });
    }

    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024) finish(true, `received camera frame bytes (${bytes})`);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(false, error.message);
    });

    child.on("close", (code) => {
      if (finished) return;
      if (bytes > 0) {
        finish(true, `received camera frame bytes (${bytes})`);
      } else {
        finish(false, `ffmpeg exited with code ${code}`);
      }
    });
  });
}

function summarizeStderr(stderr) {
  return redactUrl(stderr)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
