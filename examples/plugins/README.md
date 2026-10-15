# SubTr plugins

Server-side plugins extend SubTr's translation pipeline and dictionary. Each
plugin is a **folder** placed in the plugins directory:

- **Desktop (packaged):** `<userData>/plugins` (e.g. `~/Library/Application Support/SubTr/plugins` on macOS, `%APPDATA%/SubTr/plugins` on Windows).
- **Dev (`npm run desktop:dev`):** `<repo>/.subtr-plugins` (git-ignored) with hot reload enabled.
- **Override:** set the `SUBTR_PLUGINS_DIR` environment variable.
- **Watch:** set `SUBTR_PLUGIN_WATCH=1` to reload plugins when the directory changes (dev only).

## Installing a sample

Copy one of the folders in this directory into your plugins dir, then enable it
from the app (Settings → Plugins) and grant the capabilities you want:

```bash
mkdir -p ~/.subtr/plugins
cp -R examples/plugins/uppercase ~/.subtr/plugins/
cp -R examples/plugins/acme-translate ~/.subtr/plugins/
```

## manifest.json

```json
{
  "id": "uppercase",
  "name": "Uppercase",
  "version": "1.0.0",
  "apiVersion": 1,
  "minAppVersion": "0.2.5",
  "description": "…",
  "author": "optional",
  "homepage": "optional",
  "entry": "index.cjs",
  "capabilities": ["translate.transformInput", "translate.transformOutput"],
  "streaming": "per-chunk",
  "contributes": { "providers": [ /* ProviderPreset[] */ ] }
}
```

- `id` must match the folder name (`/^[a-z0-9-]+$/`) and use lowercase.
- `version` / `minAppVersion` must be semver (`x.y.z`).
- `apiVersion` must be `1` (otherwise the plugin is reported as `incompatible`).
- `entry` is required when `capabilities` is non-empty (default `index.cjs`).
- A plugin with no capabilities needs no code at all — see `acme-translate`,
  which only contributes a provider preset.

## Capabilities

| Capability                    | Grants                                             |
| ----------------------------- | -------------------------------------------------- |
| `translate.transformInput`    | `api.translate.onTransformInput(fn)`                |
| `translate.transformOutput`   | `api.translate.onTransformOutput(fn)`               |
| `dictionary.source`           | `api.dictionary.onLookup(fn)`                       |
| `ui.panel`                    | Serve panel HTML into a sandboxed iframe            |

Granted namespaces only: if you were not granted `dictionary.source`, then
`api.dictionary` is **absent** (calling it throws).

## UI panels

A plugin with the `ui.panel` capability can add a panel that renders inside the
app as a **sandboxed iframe** (`sandbox="allow-scripts"`, opaque origin). A panel
is a self-contained `panel.html` file declared in the manifest:

```json
{
  "capabilities": ["ui.panel"],
  "panels": [
    { "id": "main", "title": "Usage Stats", "entry": "panel.html", "location": "home" }
  ]
}
```

- `location` is `"settings"` (rendered under Settings → Plugins) or `"home"`
  (shown on the home page; toggled from the same card).
- The panel is served from `/api/plugins/:id/panel/:panelId` with
  `Cache-Control: no-store`, so saving the file and reloading shows your edits.

### The panel bridge

Because the iframe has an opaque origin it cannot fetch on its own. It talks to
the host with `postMessage`:

| Direction | Message | Meaning |
| --- | --- | --- |
| host → panel | `{ type: "subtr-plugin-init", theme: "light"\|"dark", lang: "en"\|"zh-CN" }` | Sent on load and whenever the app theme/language changes. |
| panel → host | `{ type: "subtr-plugin-fetch", rid, url }` | Fetch a `/api/…` URL; the host relays it. |
| host → panel | `{ type: "subtr-plugin-fetch-result", rid, ok, status, body }` | The response. `body` is text. |
| panel → host | `{ type: "subtr-plugin-resize", height }` | Report your content height so the iframe fits. |

Only `/api/…` URLs are relayed; anything else is ignored. Start from the
`usage-stats` example — it implements the full bridge.

### Panel UI kit

Link the shared stylesheet to make a panel look native with almost no CSS:

```html
<link rel="stylesheet" href="/plugin-kit/panel.css" />
```

The kit is theme-aware through the `.dark` class — mirror the init message onto
the root element and everything follows:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "subtr-plugin-init") {
    document.documentElement.classList.toggle("dark", e.data.theme === "dark");
    document.documentElement.lang = e.data.lang;
  }
});
```

It is a plain CSS file (no fonts, no JS, ~5 KB gzipped) served from the app, so
it loads fine inside the sandboxed iframe. It provides tokens (`--pk-bg`,
`--pk-fg`, `--pk-muted`, `--pk-accent`, `--pk-danger`, `--pk-success`, …) and
these classes:

| Area | Classes |
| --- | --- |
| Layout | `.pk-section`, `.pk-section-title`, `.pk-row`, `.pk-hr` |
| Surface | `.pk-surface`, `.pk-card`, `.pk-card-title` |
| Stats | `.pk-stats`, `.pk-stats--4`, `.pk-stat`, `.pk-stat-label`, `.pk-stat-value`, `.pk-stat-hint` |
| Badge | `.pk-badge`, `.pk-badge--ok/--warn/--danger/--accent` |
| Segmented control | `.pk-segmented`, `.pk-segmented__item[aria-pressed="true"]` |
| Buttons | `.pk-btn`, `.pk-btn--primary`, `.pk-btn--ghost`, `.pk-btn--danger`, `.pk-btn--sm` |
| Table | `.pk-table` |
| Bar chart | `.pk-chart`, `.pk-chart__yaxis`, `.pk-chart__canvas`, `.pk-chart__grid`, `.pk-chart__gridline`, `.pk-bars`, `.pk-bar`, `.pk-bar__fill`, `.pk-chart__xaxis`, `.pk-xcell` |
| Heatmap | `.pk-heat-wrap`, `.pk-heat-days`, `.pk-heat-body`, `.pk-heat-months`, `.pk-heat`, `.pk-cell`, `.pk-lvl-0`…`.pk-lvl-5`, `.pk-legend` |
| Tooltip | `.pk-tooltip`, `.pk-tooltip__date`, `.pk-tooltip__value`, `.pk-tooltip--visible` |
| States | `.pk-empty`, `.pk-loading`, `.pk-error`, `.pk-spinner`, `.pk-scroll` |
| Helpers | `.pk-muted`, `.pk-faint`, `.pk-mono`, `.pk-cluster`, `.pk-row-between` |

The `usage-stats` example uses all of the chart, heatmap and state primitives.

### Previewing a panel

You do not have to enable a panel on the home page just to look at it. Every
plugin panel gets a **Preview** action in Settings → Plugins. It opens a
full-page preview at:

```
/panel-preview/<pluginId>/<panelId>   e.g. /panel-preview/usage-stats/main
```

The preview renders the real iframe and bridge and follows the app language. It
includes a **theme** switcher (Follow app / Light / Dark) that re-sends
`subtr-plugin-init` live, a **width** switcher (Narrow / Medium / Full), and a
Reload button. It works in the browser and in the packaged desktop app — there
are no popups. Because panel files are served `no-store`, editing `panel.html`
and pressing **Reload** is a fast edit loop.

## Packaging a sample

`npm run plugins:zip` builds an importable zip for every folder under
`examples/plugins/` into `examples/plugin-zips/<id>.zip`. Import a zip from
Settings → Plugins → Import plugin.

## API

```js
module.exports = {
  activate(api) {
    // api.plugin  → { id, version, dir }
    // api.log     → { info, warn, error }
    api.translate.onTransformInput((ctx) => ctx.text.toUpperCase());
    api.translate.onTransformOutput((ctx) => ctx.text.toUpperCase());
    api.dictionary.onLookup((term) =>
      term.toLowerCase() === "subtr" ? { phonetic: "sʌbˈtiːɑːr", senses: ["示例词典条目"] } : null
    );
  },
  // optional
  deactivate() {},
};
```

- **Input ctx:** `{ text, targetLang, profile: { id, presetId, model } }` — never the API key or base URL.
- **Output ctx:** `{ text, targetLang, stream }`.
- A transform returns the new string, or `{ text }`, or mutates `ctx.text`.
- Each hook has a **2 second timeout**. A failing hook is skipped for that
  request (the text is unchanged); two consecutive failures auto-disable the plugin.
- `streaming: "per-chunk"` (default) applies output transforms to each streamed
  chunk; `"buffered"` collects the whole translation first and emits it as one chunk.

## Security

**Plugins run as local code inside the SubTr server process.** Only install
plugins you have reviewed. Capabilities gate which API namespaces a plugin can
reach, but they are not a sandbox.
