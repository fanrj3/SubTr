import type { ProviderPreset } from "@/lib/types";

export type PluginStatus = "ok" | "disabled" | "error" | "incompatible";

export type PluginInfo = {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  minAppVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  entry?: string;
  capabilities: string[];
  streaming?: "per-chunk" | "buffered";
  contributes?: { providers?: ProviderPreset[] };
  panels?: { id: string; title: string; entry: string }[];
  enabled: boolean;
  grantedCapabilities: string[];
  status: PluginStatus;
  error?: string;
};

export type PluginsResponse = {
  revision: number;
  dir: string;
  plugins: PluginInfo[];
};

export const PLUGIN_CAPABILITIES = [
  "translate.transformInput",
  "translate.transformOutput",
  "dictionary.source",
  "ui.panel",
] as const;

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export function isPluginCapability(value: string): value is PluginCapability {
  return (PLUGIN_CAPABILITIES as readonly string[]).includes(value);
}

export async function fetchPlugins(): Promise<PluginsResponse | null> {
  try {
    const res = await fetch("/api/plugins", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as PluginsResponse;
    if (!data || !Array.isArray(data.plugins)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function setPluginEnabled(
  id: string,
  enabled: boolean,
  grantedCapabilities?: string[]
): Promise<boolean> {
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, grantedCapabilities }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function hostFromBaseURL(baseURL: string): string {
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

export function mergeProviderPresets(
  base: ProviderPreset[],
  plugins: PluginsResponse | null
): ProviderPreset[] {
  if (!plugins) return base;
  const merged = new Map<string, ProviderPreset>(base.map((preset) => [preset.id, preset]));
  for (const plugin of plugins.plugins) {
    if (!plugin.enabled) continue;
    if (plugin.status === "error" || plugin.status === "incompatible") continue;
    for (const provider of plugin.contributes?.providers ?? []) {
      merged.set(provider.id, provider);
    }
  }
  return Array.from(merged.values());
}
