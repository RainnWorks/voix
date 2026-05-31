/**
 * SettingsScreen — fourth sidebar Section (M23 Decision 2).
 *
 * Five blocks, top to bottom:
 *   1. Daemon connection — DaemonUrlInput (hidden on web)
 *   2. Default voice — picker that calls devicesApi.setVoice() on the
 *      first device. If no devices yet, disabled placeholder.
 *   3. Microphone permission — status row + "Open settings" CTA on deny
 *      (calls permissions.openMicrophoneSettings()).
 *   4. Accessibility — macOS only; mirrors MacAccessibilityBanner's
 *      data but shows the row whether trusted or not.
 *   5. About — app version + bundle id + protocol version + daemon
 *      version (probe; hide on 404).
 *
 * Web build keeps the screen but hides platform-only rows. Daemon URL +
 * Microphone status rows hide on web because the document was served
 * from the daemon and the browser handles mic prompts itself.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type NativeEventSubscription,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PROTOCOL_VERSION } from "@voix/protocol";
import { type Device, type Voice, devicesApi, voicesApi } from "../lib/api";
import { appInfo, permissions, storage, type PermissionResult } from "../platform";
import { colors, fontFamily, radius, spacing } from "../lib/theme";
import { DaemonUrlInput } from "./DaemonUrlInput";

const DEFAULT_VOICE_KEY = "voix.settings.default_voice_id";

export function SettingsScreen() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [defaultVoiceOverride, setDefaultVoiceOverride] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<PermissionResult | null>(null);
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string>("—");
  const [daemonVersion, setDaemonVersion] = useState<string | null>(null);

  // Bootstrap: pull voices + devices + persisted override + version
  // metadata in parallel so the section renders in one shot.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [v, d, override, ver, daemonVer] = await Promise.all([
        voicesApi.list().catch(() => [] as Voice[]),
        devicesApi.list().catch(() => [] as Device[]),
        storage.getItem(DEFAULT_VOICE_KEY),
        getAppVersion(),
        probeDaemonVersion(),
      ]);
      if (cancelled) return;
      setVoices(v);
      setDevices(d);
      setDefaultVoiceOverride(override);
      setAppVersion(ver);
      setDaemonVersion(daemonVer);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mic status — read on mount AND re-check whenever the app returns
  // to foreground (Risk 4 — onboarding loop trap, but the principle
  // also applies in Settings: user toggles iOS Settings → voix →
  // Microphone, comes back, expects the row to update).
  const refreshMicStatus = useCallback(() => {
    void permissions.getMicrophoneStatus().then((r) => setMicStatus(r));
  }, []);

  useEffect(() => {
    refreshMicStatus();
    let sub: NativeEventSubscription | undefined;
    if (Platform.OS !== "web") {
      sub = AppState.addEventListener("change", (state) => {
        if (state === "active") refreshMicStatus();
      });
    }
    return () => {
      sub?.remove();
    };
  }, [refreshMicStatus]);

  // macOS Accessibility status — read once on mount; we don't poll
  // because the banner already handles live updates.
  useEffect(() => {
    if (Platform.OS !== "macos") return;
    type VoixPasteModule = { isAccessibilityTrusted(): Promise<boolean> };
    const m = ((globalThis as Record<string, unknown>)["__voixPasteModule"] ??
      undefined) as VoixPasteModule | undefined;
    // Try to read from NativeModules without hard-deps here. The web
    // bundle can't import NativeModules, so we lazy-route through a
    // platform check.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RN = require("react-native") as {
      NativeModules: Record<string, unknown>;
    };
    const paste = (RN.NativeModules["VoixPaste"] ?? m) as VoixPasteModule | undefined;
    if (!paste) return;
    void paste.isAccessibilityTrusted().then((trusted) => setAccessibilityTrusted(trusted));
  }, []);

  const handleSetDefaultVoice = useCallback(
    async (voiceId: string) => {
      setDefaultVoiceOverride(voiceId);
      await storage.setItem(DEFAULT_VOICE_KEY, voiceId);
      const device = devices[0];
      if (device) {
        try {
          const updated = await devicesApi.setVoice(device.deviceId, voiceId);
          setDevices([updated, ...devices.slice(1)]);
        } catch {
          // Setting saved client-side; daemon will catch up next start.
        }
      }
    },
    [devices],
  );

  const handleReprompt = useCallback(async () => {
    const result = await permissions.requestMicrophone();
    setMicStatus(result);
    if (!result.ok) void permissions.openMicrophoneSettings();
  }, []);

  const handleOpenMicSettings = useCallback(async () => {
    await permissions.openMicrophoneSettings();
  }, []);

  const activeVoiceId = devices[0]?.voiceId;
  const showDaemonUrlRow = Platform.OS !== "web";
  const showMicRow = Platform.OS !== "web";
  const showAccessibilityRow = Platform.OS === "macos";

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {showDaemonUrlRow && (
        <Section title="Daemon connection">
          <Row
            label="URL"
            desc="Where the voix daemon is reachable. Edit if you've moved the daemon, or hit Reset to bring it back to the dev default."
            control={<DaemonUrlInput />}
          />
        </Section>
      )}

      <Section title="Default voice">
        {devices.length === 0 ? (
          <Row
            label="No surface yet"
            desc="Once a puck, phone, or browser tab connects, you can pick which voice it activates with."
            control={
              <Text style={styles.disabledText}>Available after first session.</Text>
            }
          />
        ) : (
          <Row
            label={voices.find((v) => v.id === (activeVoiceId ?? defaultVoiceOverride))?.name ?? "—"}
            desc="The voice the first surface activates with. Changing it both syncs to the surface now and persists your preference for next launch."
            control={
              <VoicePicker
                voices={voices}
                value={activeVoiceId ?? defaultVoiceOverride ?? ""}
                onChange={handleSetDefaultVoice}
              />
            }
          />
        )}
      </Section>

      {showMicRow && (
        <Section title="Microphone">
          <Row
            label={micStatusLabel(micStatus)}
            desc={micStatusDesc(micStatus)}
            control={
              <View style={styles.permControls}>
                {micStatus && !micStatus.ok && (
                  <Pressable
                    onPress={handleOpenMicSettings}
                    style={({ pressed }) => [
                      styles.btn,
                      pressed && styles.btnPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Open system Settings for microphone"
                    accessibilityHint="Opens the system Settings app so you can grant voix microphone access."
                  >
                    <Text style={styles.btnLabel}>Open settings</Text>
                  </Pressable>
                )}
                {(micStatus?.ok === false || micStatus === null) && (
                  <Pressable
                    onPress={handleReprompt}
                    style={({ pressed }) => [
                      styles.btnSecondary,
                      pressed && styles.btnPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Re-prompt for microphone permission"
                    accessibilityHint="Re-triggers the system permission dialog for microphone access."
                  >
                    <Text style={styles.btnSecondaryLabel}>Re-prompt</Text>
                  </Pressable>
                )}
              </View>
            }
          />
        </Section>
      )}

      {showAccessibilityRow && (
        <Section title="Accessibility (macOS)">
          <Row
            label={
              accessibilityTrusted === null
                ? "Checking…"
                : accessibilityTrusted
                  ? "Granted"
                  : "Not granted"
            }
            desc="voix needs Accessibility to paste the transcript into the focused app. Without it the transcript is copied to the clipboard so you can paste it yourself."
            control={
              !accessibilityTrusted && (
                <Pressable
                  onPress={() => {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const RN = require("react-native") as {
                      NativeModules: Record<string, unknown>;
                    };
                    const perms = RN.NativeModules["VoixAudioPermissions"] as
                      | { openAccessibilitySettings?: () => Promise<void> }
                      | undefined;
                    void perms?.openAccessibilitySettings?.();
                  }}
                  style={({ pressed }) => [
                    styles.btn,
                    pressed && styles.btnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Open macOS Accessibility settings"
                  accessibilityHint="Opens System Settings so you can grant voix Accessibility access to paste transcripts."
                >
                  <Text style={styles.btnLabel}>Open settings</Text>
                </Pressable>
              )
            }
          />
        </Section>
      )}

      <Section title="About">
        <Row
          label="voix"
          desc="Version + protocol metadata."
          control={
            <View style={styles.aboutBlock}>
              <Text style={styles.aboutLine}>
                <Text style={styles.aboutKey}>App </Text>
                <Text style={styles.aboutVal}>{appVersion}</Text>
              </Text>
              <Text style={styles.aboutLine}>
                <Text style={styles.aboutKey}>Platform </Text>
                <Text style={styles.aboutVal}>{Platform.OS}</Text>
              </Text>
              <Text style={styles.aboutLine}>
                <Text style={styles.aboutKey}>Protocol </Text>
                <Text style={styles.aboutVal}>v{PROTOCOL_VERSION}</Text>
              </Text>
              {daemonVersion && (
                <Text style={styles.aboutLine}>
                  <Text style={styles.aboutKey}>Daemon </Text>
                  <Text style={styles.aboutVal}>{daemonVersion}</Text>
                </Text>
              )}
            </View>
          }
        />
      </Section>
    </ScrollView>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({
  label,
  desc,
  control,
}: {
  label: string;
  desc: string;
  control: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{desc}</Text>
      </View>
      <View style={styles.rowRight}>{control}</View>
    </View>
  );
}

function VoicePicker({
  voices,
  value,
  onChange,
}: {
  voices: Voice[];
  value: string;
  onChange: (id: string) => void;
}) {
  // Lightweight chip picker — same vocabulary as the Voices screen.
  // Avoids importing platform picker components which behave
  // inconsistently across iOS / macOS / web.
  return (
    <View style={styles.chipWrap} accessibilityRole="radiogroup">
      {voices.length === 0 ? (
        <ActivityIndicator color={colors.sysAccent} />
      ) : (
        voices.map((v) => {
          const selected = v.id === value;
          return (
            <Pressable
              key={v.id}
              onPress={() => onChange(v.id)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && !selected && styles.chipPressed,
              ]}
              accessibilityRole="radio"
              accessibilityLabel={`Default voice: ${v.name}`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                {v.name}
              </Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function micStatusLabel(status: PermissionResult | null): string {
  if (!status) return "Checking…";
  if (status.ok) return "Allowed";
  switch (status.reason) {
    case "denied":
      return "Denied";
    case "restricted":
      return "Restricted";
    case "undetermined":
      return "Not asked yet";
    default:
      return "Unknown";
  }
}

function micStatusDesc(status: PermissionResult | null): string {
  if (!status) return "Reading current microphone permission…";
  if (status.ok) {
    return Platform.OS === "macos"
      ? "voix can hear you when you press ⌃⌥Space."
      : "voix can hear you when you hold the talk button.";
  }
  switch (status.reason) {
    case "denied":
      return "voix can't access the microphone. Open settings to allow it, then come back here.";
    case "restricted":
      return "Microphone access is restricted on this device (parental controls, MDM, etc.).";
    case "undetermined":
      return "voix hasn't asked yet. Tap Re-prompt to bring up the system dialog.";
    default:
      return "Status unclear; tap Re-prompt to try again.";
  }
}

async function getAppVersion(): Promise<string> {
  if (Platform.OS === "web") return "—";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DeviceInfo = require("react-native-device-info").default as {
      getVersion(): string;
      getBuildNumber(): string;
    };
    return `${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`;
  } catch {
    return "—";
  }
}

async function probeDaemonVersion(): Promise<string | null> {
  try {
    const base = await appInfo.getApiBase();
    const trimmed = base.endsWith("/") ? base : `${base}/`;
    const r = await fetch(`${trimmed}api/version`);
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: string };
    return j.version ?? null;
  } catch {
    return null;
  }
}

// ─── Styles ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, maxWidth: 720, alignSelf: "center", gap: spacing.xl },

  section: { gap: spacing.sm },
  sectionTitle: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionBody: { gap: 0 },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    gap: spacing.lg,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink,
  },
  rowDesc: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
  rowRight: { minWidth: 200, maxWidth: 360, alignItems: "stretch", gap: spacing.xs },

  disabledText: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },

  permControls: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  btn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.haBlueBg,
    borderColor: colors.haBlue,
    borderWidth: 0.5,
  },
  btnPressed: { opacity: 0.85 },
  btnLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    fontWeight: "600",
    color: colors.haBlueText,
  },
  btnSecondary: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    borderColor: colors.rule,
    borderWidth: 0.5,
  },
  btnSecondaryLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.sysAccent,
  },

  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSubtle,
    borderWidth: 0.5,
    borderColor: colors.rule,
  },
  chipSelected: {
    backgroundColor: colors.haBlueBg,
    borderColor: colors.haBlue,
  },
  chipPressed: { opacity: 0.7 },
  chipLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.ink,
  },
  chipLabelSelected: {
    color: colors.haBlueText,
    fontWeight: "600",
  },

  aboutBlock: { gap: 4 },
  aboutLine: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    color: colors.textBody,
  },
  aboutKey: { color: colors.textMuted },
  aboutVal: { color: colors.ink },
});
