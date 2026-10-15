// Image Translate — plugin entry (SKELETON, phase P0).
//
// This file is a placeholder for the Node-side half of the plugin: OCR
// orchestration, translation batching, and region state. It deliberately does
// nothing yet, because the host capabilities it depends on do not exist in the
// host at the time of writing:
//
//   capture.region, overlay.regions, overlay.subtitle, translate.text,
//   hotkey.register
//
// Until the host wave ships those capabilities, the loader reports this plugin
// as `error` with "unknown capabilities: …". See README.md ("Build status") for
// the exact behaviour and the version that will enable it.
//
// Planned wiring (phases P2/P3) — the shape the entry will take once the
// capabilities are granted:
//
//   module.exports = {
//     async activate(api) {
//       const state = { boxes: [], translations: new Map() };
//
//       // 5) Global shortcut (default CommandOrControl+Shift+P).
//       const reg = await api.hotkey.register({
//         accelerator: "CommandOrControl+Shift+P",
//         when: "translation-mode", // only while the app is translating
//         onTrigger: () => runCapture(),
//       });
//
//       // 1) Host shows the frozen-snapshot selection UI, returns a crop.
//       async function runCapture() {
//         const shot = await api.capture.region({ mode: "freeze" });
//         if (!shot.ok) return; // cancelled / no-permission / error
//         const ocr = await recognise(shot);              // P2: Vision or PP-OCRv6
//         if (ocr.boxes.length === 0) return api.overlay.subtitle.show({ text: "No text found" });
//         state.boxes = ocr.boxes;
//
//         // 2) Host draws the image + highlights (hot path, no wait on translation).
//         const handle = await api.overlay.regions.show({
//           imageDataUrl: shot.imageDataUrl,
//           widthPx: shot.widthPx,
//           heightPx: shot.heightPx,
//           boxes: ocr.boxes,
//           style: { highlight: "glow", numbered: true },
//         });
//
//         // 3) Pre-translate every box so hover is instant (hover→subtitle ≤150ms).
//         void pretranslate(ocr.boxes);
//
//         api.overlay.regions.onRegionHover((e) => {
//           const t = state.translations.get(e.boxId);
//           api.overlay.subtitle.show({ text: t ?? "…", tone: "muted" });
//         });
//         api.overlay.regions.onRegionSelect((e) => api.overlay.subtitle.show({ text: state.translations.get(e.boxId) ?? "" }));
//         api.overlay.regions.onRegionDismiss(() => api.overlay.subtitle.clear());
//       }
//
//       // 4) Batch translate through the app's ACTIVE profile (keys never exposed).
//       async function pretranslate(boxes) {
//         const res = await api.translate.text({ texts: boxes.map((b) => b.text) });
//         if (!res.ok) return; // fall back to on-demand translation on hover
//         boxes.forEach((b, i) => state.translations.set(b.id, res.translations[i]?.text ?? ""));
//       }
//     },
//   };

module.exports = {
  activate(api) {
    api.log.info(
      "image-translate skeleton loaded — waiting for host capabilities " +
        "(capture.region, overlay.regions, overlay.subtitle, translate.text, hotkey.register)"
    );
  },
  deactivate() {},
};
