/**
 * Storage — RN impl (AsyncStorage).
 *
 * Wraps `@react-native-async-storage/async-storage` in the shared
 * `StorageAdapter` interface. Async on iOS (UserDefaults via a worker
 * thread) and macOS (SQLite via the RN-macOS 0.78+ backend).
 *
 * Errors get swallowed to mirror the web impl's posture — Safari
 * private mode + quota-exceeded already give us null returns there.
 * Consumers handle the "value didn't persist" case (e.g. device-id
 * regeneration).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StorageAdapter } from "./types";

export const storage: StorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // best-effort
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // best-effort
    }
  },
};
