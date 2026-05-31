/**
 * Storage — web impl (Promise-wrapped localStorage).
 *
 * Browser localStorage is synchronous; we wrap each call in a
 * Promise so consumers (and the .native.ts AsyncStorage twin) share
 * one async surface. The Promise.resolve overhead is microseconds
 * and the API parity is worth more than the saved tick.
 *
 * Catches localStorage exceptions (Safari private mode, quota
 * exceeded) and surfaces them as nulls / no-ops — same posture as the
 * legacy client.ts:62-72 device-id flow we lifted from.
 */

import type { StorageAdapter } from "./types";

export const storage: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      // Safari private mode + Storage-disabled browsers throw on read.
      // Treat as "key absent" — consumers regenerate UUIDs etc.
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded / private mode: silently drop. Consumers
      // already handle the "value didn't persist" case.
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort
    }
  },
};
