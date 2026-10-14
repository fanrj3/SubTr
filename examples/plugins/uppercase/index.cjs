// Example SubTr plugin: uppercase both the translated text and its input.
//
// The `activate(api)` export receives a capability-scoped api object: only the
// namespaces you were granted are present. This plugin is granted
// `translate.transformInput` + `translate.transformOutput`, so `api.translate`
// exists; `api.dictionary` is absent.

module.exports = {
  activate(api) {
    api.log.info("activated — text will be uppercased in and out");

    // ctx = { text, targetLang, profile: { id, presetId, model } } — never keys.
    api.translate.onTransformInput((ctx) => ctx.text.toUpperCase());

    // ctx = { text, targetLang, stream }
    api.translate.onTransformOutput((ctx) => ctx.text.toUpperCase());
  },
};
