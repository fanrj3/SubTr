// SubTr apiVersion-2 host-capability test fixture.
//
// Registers region events + a global hotkey and appends every host→plugin event
// to SUBTR_CAPS_EVENTS_LOG so an automated harness can assert delivery. This
// plugin is a test fixture: it is NOT packaged (build-plugin-zips skips `_*`).
/* eslint-disable @typescript-eslint/no-require-imports -- plugin entry points are CommonJS by contract */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOG =
  process.env.SUBTR_CAPS_EVENTS_LOG || path.join(os.tmpdir(), "subtr-caps-demo-events.log");

function record(event) {
  try {
    fs.appendFileSync(LOG, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
  } catch {
    // ignore
  }
}

async function activate(api) {
  record({ type: "activate", id: api.plugin.id });
  api.log.info(`caps-demo activated (log: ${LOG})`);

  // overlay.regions events → recorded for assertions.
  api.overlay.regions.onRegionHover((e) => record({ type: "region.hover", event: e }));
  api.overlay.regions.onRegionSelect((e) => record({ type: "region.select", event: e }));
  api.overlay.regions.onRegionDismiss((e) => record({ type: "region.dismiss", event: e }));

  const testRectRaw = process.env.SUBTR_CAPS_TEST_RECT;

  // hotkey.register (translation-mode gated). On trigger: translate.text (test),
  // then the full chain capture.region → overlay.regions.show → overlay.subtitle.show.
  const result = await api.hotkey.register({
    accelerator: process.env.SUBTR_CAPS_ACCEL || "CommandOrControl+Shift+P",
    when: "translation-mode",
    onTrigger: async () => {
      record({ type: "hotkey.trigger" });
      try {
        // translate.text through the plugin API (post-activation).
        if (process.env.SUBTR_CAPS_TEST_TRANSLATE === "1") {
          const res = await api.translate.text({ texts: ["hello", "world"] });
          record({ type: "translate.result", result: res });
        }
        const opts = testRectRaw ? { testRect: JSON.parse(testRectRaw) } : {};
        const cap = await api.capture.region(opts);
        record({ type: "chain.capture", ok: cap.ok, widthPx: cap.widthPx, heightPx: cap.heightPx });
        if (cap.ok) {
          await api.overlay.regions.show({
            imageDataUrl: cap.imageDataUrl,
            widthPx: cap.widthPx,
            heightPx: cap.heightPx,
            boxes: [
              { id: "b1", xPct: 0.1, yPct: 0.1, wPct: 0.35, hPct: 0.2, text: "Hello" },
              { id: "b2", xPct: 0.1, yPct: 0.4, wPct: 0.5, hPct: 0.15, text: "World" },
            ],
            style: { highlight: "glow", numbered: true },
            ...(testRectRaw ? { testHoverId: "b1" } : {}),
          });
          await api.overlay.subtitle.show({ text: `Caps demo ${cap.widthPx}×${cap.heightPx}` });
          record({ type: "chain.done" });
        }
      } catch (error) {
        record({ type: "chain.error", message: String(error) });
      }
    },
  });
  record({ type: "hotkey.register", result });

  return {
    deactivate() {
      record({ type: "deactivate" });
    },
  };
}

module.exports = { activate };
