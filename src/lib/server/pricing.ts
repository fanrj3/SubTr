import { PROVIDER_PRESETS } from "@/lib/presets";
import type { ProviderPreset } from "@/lib/types";

/**
 * Pricing lookup for the cost meter.
 *
 * Prices come from the provider presets (`pricing`, USD per 1M tokens). A model
 * is matched against the presets' `defaultModel` map first; when that fails the
 * request's `presetId` is used. Anything unknown resolves to null (cost unknown).
 */

export type Pricing = NonNullable<ProviderPreset["pricing"]>;

const byModel = new Map<string, Pricing>();
const byPreset = new Map<string, Pricing>();

for (const preset of PROVIDER_PRESETS) {
  if (!preset.pricing) continue;
  byPreset.set(preset.id, preset.pricing);
  const model = preset.defaultModel?.trim();
  if (model) byModel.set(model, preset.pricing);
}

/** Resolve pricing for a model (+ optional preset id), or null when unknown. */
export function resolvePricing(model: string, presetId?: string): Pricing | null {
  const trimmed = model.trim();
  if (trimmed && byModel.has(trimmed)) return byModel.get(trimmed) ?? null;
  if (presetId && byPreset.has(presetId)) return byPreset.get(presetId) ?? null;
  return null;
}

/** USD cost for a token count pair; never negative. */
export function computeCostUsd(
  inTok: number,
  outTok: number,
  pricing: Pricing,
): number {
  const input = Math.max(0, inTok);
  const output = Math.max(0, outTok);
  return (input / 1_000_000) * pricing.inPerM + (output / 1_000_000) * pricing.outPerM;
}
