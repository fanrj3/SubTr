// Copies Next.js static assets into the standalone output so the server can
// serve them without the source tree present. Cross-platform (fs.cp).

const fs = require("node:fs/promises");
const path = require("node:path");

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyInto(src, dest, label) {
  if (!(await exists(src))) {
    console.warn(`[prepare-standalone] skip ${label}: ${src} not found`);
    return;
  }
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true });
  console.log(`[prepare-standalone] copied ${label} -> ${path.relative(process.cwd(), dest)}`);
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const standalone = path.join(root, ".next", "standalone");

  if (!(await exists(standalone))) {
    throw new Error(
      `Standalone output not found at ${standalone}. ` +
        'Run `next build` with output: "standalone" in next.config.ts.',
    );
  }

  await copyInto(
    path.join(root, ".next", "static"),
    path.join(standalone, ".next", "static"),
    ".next/static",
  );
  await copyInto(
    path.join(root, "public"),
    path.join(standalone, "public"),
    "public",
  );

  console.log("[prepare-standalone] done");
}

main().catch((error) => {
  console.error("[prepare-standalone] failed:", error && error.message ? error.message : error);
  process.exit(1);
});
