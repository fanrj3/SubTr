// Dev launcher: runs `next dev -p 3311` and Electron (pointed at it) together.
// main.cjs uses SUBTR_DEV_URL when set and skips the standalone server spawn.
//
// The plugin host-capability bridge lives in Electron main but the dev server is
// spawned here, so we mint a token + port here and pass them to BOTH processes;
// main.cjs binds to SUBTR_BRIDGE_PORT instead of an ephemeral one.

const { spawn } = require("node:child_process");
const net = require("node:net");
const crypto = require("node:crypto");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npx.cmd" : "npx";

// Dev server-side plugins: a repo-local dir with hot reload enabled.
const pluginsDir = path.join(root, ".subtr-plugins");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  const bridgeToken = crypto.randomBytes(24).toString("hex");
  const bridgePort = await getFreePort();
  const sharedEnv = {
    ...process.env,
    SUBTR_PLUGINS_DIR: pluginsDir,
    SUBTR_PLUGIN_WATCH: "1",
    SUBTR_BRIDGE_PORT: String(bridgePort),
    SUBTR_BRIDGE_TOKEN: bridgeToken,
    SUBTR_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
  };

  const next = spawn(npmCmd, ["next", "dev", "-p", "3311"], { cwd: root, stdio: "inherit", env: sharedEnv });

  const electron = spawn(npmCmd, ["electron", "."], {
    cwd: root,
    stdio: "inherit",
    env: { ...sharedEnv, SUBTR_DEV_URL: "http://localhost:3311" },
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
}

void main();

