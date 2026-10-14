// Dev launcher: runs `next dev -p 3311` and Electron (pointed at it) together.
// main.cjs uses SUBTR_DEV_URL when set and skips the standalone server spawn.

const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npx.cmd" : "npx";

// Dev server-side plugins: a repo-local dir with hot reload enabled.
const pluginsDir = path.join(root, ".subtr-plugins");

const next = spawn(npmCmd, ["next", "dev", "-p", "3311"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SUBTR_PLUGINS_DIR: pluginsDir,
    SUBTR_PLUGIN_WATCH: "1",
  },
});

const electron = spawn(npmCmd, ["electron", "."], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SUBTR_DEV_URL: "http://localhost:3311",
    SUBTR_PLUGINS_DIR: pluginsDir,
    SUBTR_PLUGIN_WATCH: "1",
  },
});

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    next.kill();
  } catch {
    // ignore
  }
  try {
    electron.kill();
  } catch {
    // ignore
  }
  process.exit(code ?? 0);
}

electron.on("exit", () => shutdown(0));
next.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
