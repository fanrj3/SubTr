import { Suspense } from "react";
import { PanelPreview } from "@/components/panel-preview";

type PanelPreviewParams = { id: string; panelId: string };

// A dev preview route is inherently request-specific: the plugin id and panel id
// are runtime params, so this route blocks instead of prerendering a static shell.
export const instant = false;

/**
 * /panel-preview/<pluginId>/<panelId> — full-page preview of a plugin panel.
 *
 * Renders the real panel iframe + postMessage bridge, with theme/language
 * following the app. Files are served fresh (no-store), so reloading picks up
 * panel edits. Works in the browser and in the Electron app (no popups).
 */
export default function PanelPreviewPage({
  params,
}: {
  params: Promise<PanelPreviewParams>;
}) {
  return (
    <Suspense fallback={<PanelPreviewFallback />}>
      {params.then(({ id, panelId }) => (
        <PanelPreview pluginId={id} panelId={panelId} />
      ))}
    </Suspense>
  );
}

function PanelPreviewFallback() {
  return <div className="min-h-dvh bg-background" />;
}
