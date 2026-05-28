import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, radius, spacing } from "../lib/theme";
import { Puck } from "./Puck";
import { Wordmark } from "./Wordmark";

/**
 * Sidebar + main-area shell, matching the desktop guide's screen
 * atlas pattern. Title bar across the top (system mac-ish, traffic
 * lights mocked), 200px sidebar on the left, main content on the
 * right.
 *
 * When this app gets wrapped in a real native shell (Tauri / iOS),
 * those shells provide the actual title bar — this component
 * collapses to just sidebar+main. For now we draw our own to look
 * approximately right inside HA's ingress iframe and the standalone
 * browser tab.
 */

export type Section = "conversations" | "modes" | "devices";

type Props = {
  section: Section;
  onPickSection: (s: Section) => void;
  title: string;
  toolbarRight?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell({ section, onPickSection, title, toolbarRight, children }: Props) {
  return (
    <View style={styles.app}>
      <View style={styles.titlebar}>
        <Wordmark />
      </View>
      <View style={styles.body}>
        <Sidebar section={section} onPickSection={onPickSection} />
        <View style={styles.main}>
          <View style={styles.toolbar}>
            <Text style={styles.toolbarTitle}>{title}</Text>
            <View style={styles.toolbarRight}>{toolbarRight}</View>
          </View>
          <View style={styles.content}>{children}</View>
        </View>
      </View>
    </View>
  );
}

function Sidebar({
  section,
  onPickSection,
}: {
  section: Section;
  onPickSection: (s: Section) => void;
}) {
  return (
    <View style={styles.sidebar}>
      <Pressable style={styles.newButton}>
        <Text style={styles.newButtonPlus}>＋</Text>
        <Text style={styles.newButtonText}>New conversation</Text>
        <Text style={styles.kbd}>⌘N</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Today</Text>
      <View style={styles.itemList}>
        <SessionItem
          name="Kitchen quick chat"
          meta="2 min ago · Realtime"
          selected={section === "conversations"}
          onPress={() => onPickSection("conversations")}
        />
      </View>

      <View style={styles.spacer} />

      <View style={styles.bottom}>
        <SidebarFlatItem
          icon={<Puck size={11} />}
          label="Modes"
          count={6}
          selected={section === "modes"}
          onPress={() => onPickSection("modes")}
        />
        <SidebarFlatItem
          icon={<Text style={styles.gearIcon}>⚙</Text>}
          label="Devices & settings"
          selected={section === "devices"}
          onPress={() => onPickSection("devices")}
        />
      </View>
    </View>
  );
}

function SessionItem({
  name,
  meta,
  selected,
  onPress,
}: {
  name: string;
  meta: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sessionItem,
        selected && styles.sessionItemSelected,
        pressed && !selected && styles.sessionItemPressed,
      ]}
    >
      <Text style={[styles.sessionName, selected && styles.onSelected]}>{name}</Text>
      <Text style={[styles.sessionMeta, selected && styles.onSelectedMuted]}>{meta}</Text>
    </Pressable>
  );
}

function SidebarFlatItem({
  icon,
  label,
  count,
  selected,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.flatItem,
        selected && styles.flatItemSelected,
        pressed && !selected && styles.flatItemPressed,
      ]}
    >
      {icon}
      <Text style={[styles.flatItemLabel, selected && styles.onSelected]}>{label}</Text>
      {count !== undefined && (
        <Text style={[styles.flatItemCount, selected && styles.onSelectedMuted]}>{count}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  titlebar: {
    height: 38,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    backgroundColor: colors.bgElevated,
  },
  body: {
    flex: 1,
    flexDirection: "row",
  },
  sidebar: {
    width: 220,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRightWidth: 0.5,
    borderRightColor: colors.rule,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginBottom: spacing.md,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: radius.md,
  },
  newButtonPlus: {
    fontSize: 13,
    color: colors.textMuted,
  },
  newButtonText: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 12,
    color: colors.ink,
  },
  kbd: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  sectionLabel: {
    paddingHorizontal: spacing.md,
    fontSize: 11,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontWeight: "500",
    marginBottom: spacing.xs,
    fontFamily: fontFamily.ui,
  },
  itemList: {},
  sessionItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginBottom: 2,
    gap: 2,
  },
  sessionItemSelected: { backgroundColor: colors.sysAccent },
  sessionItemPressed: { backgroundColor: colors.bgHover },
  sessionName: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
  },
  sessionMeta: {
    fontFamily: fontFamily.ui,
    fontSize: 11,
    color: colors.textMuted,
  },
  onSelected: { color: "#fff" },
  onSelectedMuted: { color: "rgba(255,255,255,0.85)" },
  spacer: { flex: 1 },
  bottom: {
    borderTopWidth: 0.5,
    borderTopColor: colors.ruleSoft,
    paddingVertical: spacing.sm,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  flatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginVertical: 1,
  },
  flatItemSelected: { backgroundColor: colors.sysAccent },
  flatItemPressed: { backgroundColor: colors.bgHover },
  flatItemLabel: {
    flex: 1,
    fontFamily: fontFamily.ui,
    fontSize: 13,
    color: colors.ink,
  },
  flatItemCount: {
    fontFamily: fontFamily.mono,
    fontSize: 10,
    color: colors.textMuted,
  },
  gearIcon: {
    fontSize: 13,
    color: colors.textMuted,
  },

  main: {
    flex: 1,
    minWidth: 0,
  },
  toolbar: {
    height: 38,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
  },
  toolbarTitle: {
    fontFamily: fontFamily.ui,
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink,
  },
  toolbarRight: { flexDirection: "row", alignItems: "center" },
  content: { flex: 1 },
});
