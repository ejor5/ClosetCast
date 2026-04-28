const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { resolveProjectPath } = require("./config");

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov"];
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

function listMediaFiles(config, logger) {
  if (!config.media || !config.media.enabled) return [];

  const folder = resolveProjectPath(config.__projectRoot, config.media.folderPath || "media");
  const allowed = new Set((config.media.allowedExtensions || DEFAULT_EXTENSIONS).map((ext) => ext.toLowerCase()));

  try {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      return [];
    }

    return fs.readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(folder, entry.name))
      .filter((filePath) => allowed.has(path.extname(filePath).toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        return {
          name: path.basename(filePath),
          type: VIDEO_EXTENSIONS.has(ext) ? "video" : "image",
          url: pathToFileURL(filePath).toString()
        };
      });
  } catch (error) {
    logger.warn("Media scan failed", { error: error.message, folder });
    return [];
  }
}

module.exports = { listMediaFiles };
