/**
 * useProviders — caches a registry-lookup for one provider kind across
 * the editor's lifetime so opening a voice doesn't re-fetch on every
 * render.
 *
 * M-Arch Wave A #13. The voice editor used to hardcode its provider
 * picker options as static arrays
 * ([{value: "openai", label: "OpenAI"}, ...]); after Wave A #2 opened
 * `voice.postProcessProvider` to `string`, the editor instead asks
 * the daemon which provider names are registered via
 * `GET /api/providers?kind=…`.
 *
 * Cache shape: process-global Map keyed by kind. First read for a
 * given kind kicks the fetch; subsequent reads return the cached
 * array immediately. Errors are surfaced once and don't re-fetch
 * automatically (callers can manually `refetch()` if a stale state
 * matters; today no caller does).
 */

import { useEffect, useState } from "react";
import { type ProviderKind, providersApi } from "./api";

type CacheEntry =
  | { state: "loading"; promise: Promise<string[]> }
  | { state: "ready"; providers: string[] }
  | { state: "error"; message: string };

const cache = new Map<ProviderKind, CacheEntry>();

function fetchAndCache(kind: ProviderKind): Promise<string[]> {
  const existing = cache.get(kind);
  if (existing?.state === "loading") return existing.promise;
  if (existing?.state === "ready") return Promise.resolve(existing.providers);
  // "error" or absent → fetch fresh.
  const promise = providersApi
    .list(kind)
    .then((providers) => {
      cache.set(kind, { state: "ready", providers });
      return providers;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      cache.set(kind, { state: "error", message });
      throw err;
    });
  cache.set(kind, { state: "loading", promise });
  return promise;
}

export type UseProvidersResult = {
  providers: string[];
  loading: boolean;
  error: string | null;
};

export function useProviders(kind: ProviderKind): UseProvidersResult {
  const existing = cache.get(kind);
  const [providers, setProviders] = useState<string[]>(
    existing?.state === "ready" ? existing.providers : [],
  );
  const [loading, setLoading] = useState<boolean>(existing?.state !== "ready");
  const [error, setError] = useState<string | null>(
    existing?.state === "error" ? existing.message : null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(cache.get(kind)?.state !== "ready");
    fetchAndCache(kind)
      .then((p) => {
        if (cancelled) return;
        setProviders(p);
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return { providers, loading, error };
}

/** Test-only: reset the module cache. Not exported from the package's
 *  public surface; lives here so unit tests can scope state. */
export function _resetProvidersCache(): void {
  cache.clear();
}
