# Image Translate — plugin project plan

**One page.** Separate plugin project, independently versioned (**not** part of
SubTr's version numbers). It is the driver for extending the plugin system:
SubTr grows five capabilities because this plugin needs them. Improving plugin
capabilities is explicitly in scope.

- Spec: [`examples/plugins/image-translate/README.md`](../examples/plugins/image-translate/README.md)
- Folder: `examples/plugins/image-translate/`
- Relationship to SubTr: the plugin **version starts at 0.1.0** and moves on its
  own. SubTr's `0.2.x`/`0.3.x` numbers stay untouched by plugin releases.

## Phases

| Phase | Goal | Key deliverables | Exit criteria | Owner |
| --- | --- | --- | --- | --- |
| **P0 — Spec** *(this round)* | Agree the design before code | `README.md` spec, `manifest.json` wishlist, `panel.html` shell, this plan | Spec approved; capability shapes frozen | Design + Orchestrator |
| **P1 — Host capabilities** | Make the host able to serve the plugin | `capture.region`, `overlay.regions`, `overlay.subtitle`, `translate.text`, `hotkey.register`, plugin-local `node_modules` loading, consent entries | Each capability works from a throwaway test plugin; no unknown-capability error for the wishlist | Host lane (`src/**`, `desktop/**`) |
| **P2 — Plugin core** | Capture → OCR → boxes | `index.cjs` orchestration, Vision helper + fallback, PP-OCRv6 via ONNX, engine selection, model download + SHA-256 verify, settings persistence in the panel | Warm capture→boxes ≤ 1.5 s on Vision; PP-OCRv6 fallback works on Windows/Linux | Plugin lane |
| **P3 — Highlights + pre-translation** | The Live Text feel | `overlay.regions` wiring, hover/select/dismiss, 1–9 number keys, batched `translate.text` pre-translation, subtitle line integration | Hover→subtitle ≤ 150 ms warm; image unmodified; original text never overwritten | Plugin + host lanes |
| **P4 — Polish + packaging** | Ship it | Lite vs Full installs, `.zipignore`/skip list for `node_modules` + models, `NOTICE`/`LICENSE`, error/empty/loading states, EN + zh-CN copy, `prefers-reduced-motion` | Both install shapes import cleanly; notices present; no placeholder copy | Design + Release |

## Dependency chain

```
P0 spec ──▶ P1 host capabilities ──▶ P2 plugin core ──▶ P3 highlights ──▶ P4 packaging
                    │                        │
                    └── capability shapes are a hard API ── later changes cost both lanes
```

P1 blocks everything after it. The capability shapes in the spec are the
contract: the plugin lane codes against them and the host lane implements them,
so a late change is a two-lane change.

## Scope / conflict boundaries

- **This round (P0)** touches only `examples/plugins/image-translate/**` and this
  `docs/` file. No `src/**`, no `desktop/**`, no `package.json`, no loader.
- **P1** is the first lane that changes shared code (`src/lib/server/plugins.ts`,
  `src/lib/client/plugins.ts`, `desktop/main.cjs`, `desktop/preload.cjs`, consent
  list). It must not regress the existing four capabilities.
- **P2–P4** stay inside the plugin folder except for the capability surfaces
  defined in P1.

## Risks

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | **Model download reliability** — HF mirrors (hf-mirror / ModelScope / PaddleX BOS) can be slow or blocked | PP-OCRv6 path unusable on first run | Mirror fallback chain + SHA-256 pinning; offer a bundled “Full” install; clear error copy |
| 2 | **Plugin zip size cap** — `node_modules` + ONNX runtime blow past `MAX_PLUGIN_ZIP_BYTES` (20 MB), and `scripts/build-plugin-zips.mjs` walks the whole folder | PP-OCRv6 can't be packaged as-is | `.zipignore`/skip list (P4); default to the Lite (Vision) install; download models, don't bundle |
| 3 | **macOS helper signing** — a spawned Vision helper needs ad-hoc codesign; Gatekeeper may block | Vision path fails on some machines | Ship a signed helper; always fall back to PP-OCRv6; surface status in the panel |
| 4 | **The panel system cannot draw over the desktop** — true root constraint | Highlights can't be plugin-drawn | This is exactly why highlights are host-rendered via `overlay.regions`; keep drawing out of the plugin |
| 5 | **PP-OCRv6 CPU speed** — no GPU assumed | Capture→boxes misses the 1.5 s target | Budget 2.5 s for PP-OCRv6; draw boxes before translation; run on a worker thread |
| 6 | **Hotkey collision** — the app already owns ⌘⇧T (mode toggle) and ⌘⇧D/D | ⌘⇧P may be taken by another app | `hotkey.register` returns `conflict`; panel suggests alternatives (`SUGGESTED_HOTKEYS`) |
| 7 | **Multi-display / Retina** — per-display overlay + scale factor math | Boxes offset or scaled wrongly | `capture.region` returns `scaleFactor`, `rect`, `displayId`; boxes are normalized (0–1); test 1×/2×/1.5× and hot-plug |
| 8 | **Licensing** — Apache-2.0 (PaddleOCR) requires notices; app is free but obligations hold | Legal/attribution failure | Ship `NOTICE` + full license text in the folder and credits; pin attribution text (P2/P4) |
| 9 | **`minAppVersion` drift** — set to `0.2.9` but capabilities ship later | Misleading metadata | Bump to the first host version that ships the capabilities before release (open question #1 in the spec) |
| 10 | **Shared-code regression** — P1 touches the loader and desktop | Existing plugins or capture break | Keep P1 additive; capability list grows, hooks unchanged; test the four existing capabilities + `uppercase`/`usage-stats` |

## Success criteria (project)

- With translation mode on, ⌘⇧P → drag → confirm shows highlighted boxes and
  instant hover translations, with the image untouched.
- Works on macOS via Apple Vision and on Windows/Linux via PP-OCRv6.
- No API keys or image pixels ever leave the machine; only recognised text is
  translated, through the app's active profile.
- The plugin ships and updates independently of SubTr's version.
