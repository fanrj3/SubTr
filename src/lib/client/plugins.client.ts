"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPlugins,
  setPluginEnabled,
  type PluginsResponse,
} from "./plugins";

export function usePlugins(): {
  data: PluginsResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  toggle: (
    id: string,
    enabled: boolean,
    grantedCapabilities?: string[],
    visiblePanels?: Record<string, boolean>
  ) => Promise<boolean>;
} {
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchPlugins();
    setData(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const toggle = useCallback(
    async (
      id: string,
      enabled: boolean,
      grantedCapabilities?: string[],
      visiblePanels?: Record<string, boolean>
    ) => {
      const ok = await setPluginEnabled(id, enabled, grantedCapabilities, visiblePanels);
      if (ok) await refresh();
      return ok;
    },
    [refresh]
  );

  return { data, loading, refresh, toggle };
}
