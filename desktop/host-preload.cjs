// Preload for the plugin host renderer windows (capture freeze + regions).
// Exposes a tiny, frozen bridge to the host HTML pages (desktop/host-*.html).
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("subtrHost", {
  // --- capture.region freeze window -------------------------------------
  onCaptureInit(cb) {
    if (typeof cb !== "function") return;
    ipcRenderer.on("subtr:host-capture-init", (_e, payload) => cb(payload));
  },
  completeCapture(rect) {
    ipcRenderer.send("subtr:host-capture-complete", rect);
  },
  cancelCapture() {
    ipcRenderer.send("subtr:host-capture-cancel");
  },

  // --- overlay.regions window -------------------------------------------
  onRegionsInit(cb) {
    if (typeof cb !== "function") return;
    ipcRenderer.on("subtr:host-regions-init", (_e, payload) => cb(payload));
  },
  onRegionsUpdate(cb) {
    if (typeof cb !== "function") return;
    ipcRenderer.on("subtr:host-regions-update", (_e, payload) => cb(payload));
  },
  regionEvent(ev) {
    ipcRenderer.send("subtr:host-region-event", ev);
  },
  hideRegions() {
    ipcRenderer.send("subtr:host-regions-hide");
  },
});
