const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [];

function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") continue;
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
}

walk(path.join(root, "src"));
walk(path.join(root, "scripts"));

let failed = false;
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  try {
    new vm.Script(source, { filename: file });
  } catch (error) {
    failed = true;
    process.stderr.write(`${error.stack || error.message}\n`);
  }
}

if (failed) process.exit(1);
console.log(`Checked ${files.length} JavaScript files.`);
