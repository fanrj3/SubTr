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

Granted namespaces only: if you were not granted `dictionary.source`, then
`api.dictionary` is **absent** (calling it throws).

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
