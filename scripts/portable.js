const fs = require("fs");
const path = require("path");

const root = process.cwd();
const outDir = path.join(root, "portable");
const appDir = path.join(outDir, "app");

const include = [
  "package.json",
  "electron-main.js",
  "index.html",
  "styles.css",
  "app.js",
  "node_modules"
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });

for (const rel of include) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) {
    console.warn(`[portable] Skipping missing path: ${rel}`);
    continue;
  }
  const dest = path.join(appDir, rel);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[portable] Copied: ${rel}`);
}

// One-click launchers for users.
const runSh = "#!/usr/bin/env bash\nset -euo pipefail\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\ncd \"$DIR/app\"\nnpm start\n";
fs.writeFileSync(path.join(outDir, "run.sh"), runSh);
fs.chmodSync(path.join(outDir, "run.sh"), 0o755);

const runBat = "@echo off\r\ncd /d %~dp0app\r\nnpm start\r\n";
fs.writeFileSync(path.join(outDir, "run.bat"), runBat);

const runNotes = `Sail ER Map (portable)\n\nRun the app:\n\n  Windows: double-click run.bat\n  macOS/Linux: ./run.sh\n\nThis bundle includes node_modules so users do not need to install dependencies.\nSail must be running separately on 127.0.0.1:43385.\n`;
fs.writeFileSync(path.join(outDir, "README.txt"), runNotes);

console.log("[portable] Portable bundle ready at portable/");
