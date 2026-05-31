import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontFamily, radius, spacing } from "../lib/theme";
import { useResponsive } from "../lib/useResponsive";
import { SafeAreaView } from "../platform";
import { Icon } from "./Icon";
import { Puck } from "./Puck";
import { Wordmark } from "./Wordmark";

/**
 * App shell — adaptive across canvases (M-MobileFit).
 *
 * **Desktop / iPad / wide browser (≥ 768pt):** the master-detail split
 * the desktop guide's screen atlas specifies — title bar across the
 * top, 220px conversation sidebar on the left, content pane on the
 * right. This is the correct idiom for a wide canvas and the default.
 *
 * **Phone (< 768pt):** a single-column layout with a bottom tab bar.
 * The fixed sidebar is an iPad/desktop idiom; on a 393pt iPhone it
 * squeezed the content pane to ~60% and clipped copy mid-word. On a
 * phone there is one context at a time — the conversation list moves
 * to its own "Conversations" tab and the content pane goes full width
 * (soul §3 precondition 1, canvas-fit). The top chrome insets below the
 * status bar / Dynamic Island and the tab bar insets above the home
 * indicator (precondition 2, safe-area) via SafeAreaView.
 *
 * When wrapped in a real native shell (Tauri / iOS), those shells
 * provide the OS chrome; on web we draw our own to look approximately
 * right inside HA's ingress iframe and a standalone browser tab.
 */

export type Section = "conversations" | "voices" | "surfaces" | "settings";

/**
 * On macOS the native shell (AppDelegate) installs a behind-window
 * NSVisualEffectView backdrop and clears the RN host layer (A2 point 4).
 * To reveal that vibrancy under the sidebar — and ONLY the sidebar — the
 * desktop shell turns its root + sidebar transparent on macOS while the
 * titlebar and content pane keep opaque fills. iOS/web are untouched
 * (Platform.OS is never "macos" there), so this is a no-op off macOS.
 */
const isMacNative = Platform.OS === "macos";

type Props = {
  section: Section;
  onPickSection: (s: Section) => void;
  /** Start a new conversation: lands on the Conversations surface with
   *  the talk button ready. Wired to the desktop "+New conversation"
   *  row and the phone header "＋" action. */
  onNewConversation: () => void;
  title: string;
  toolbarRight?: React.ReactNode;
  children: React.ReactNode;
};

export function AppShell(props: Props) {
  const { isPhone } = useResponsive();
  return isPhone ? <PhoneShell {...props} /> : <DesktopShell {...props} />;
}

// ─── Desktop / iPad — master-detail split ───────────────────────────

function DesktopShell({
  section,
  onPickSection,
  onNewConversation,
  title,
  toolbarRight,
  children,
}: Props) {
  return (
    <View style={[styles.app, isMacNative && styles.appMac]}>
      {/* edges=['top'] is a no-op on macOS/web (zero inset) and insets
          correctly under an iPad status bar. */}
      <SafeAreaView edges={["top"]} style={styles.titlebar}>
        <Wordmark />
      </SafeAreaView>
      <View style={styles.body}>
        <Sidebar
          section={section}
          onPickSection={onPickSection}
          onNewConversation={onNewConversation}
        />
        <View style={[styles.main, isMacNative && styles.mainMac]}>
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
  onNewConversation,
}: {
  section: Section;
  onPickSection: (s: Section) => void;
  onNewConversation: () => void;
}) {
  return (
    <View style={[styles.sidebar, isMacNative && styles.sidebarMac]}>
      <Pressable
        style={({ pressed }) => [styles.newButton, pressed && styles.newButtonPressed]}
        onPress={onNewConversation}
        accessibilityRole="button"
        accessibilityLabel="New conversation"
        accessibilityHint="Start a new conversation and open the talk button."
      >
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
          label="Voices"
          count={6}
          selected={section === "voices"}
          onPress={() => onPickSection("voices")}
        />
        {/* M23 Decision 2 — Surfaces gives up the gear glyph so
            Settings can claim it. ◇ reads as a generic surface /
            slot icon without competing for "configuration" affordance. */}
        <SidebarFlatItem
          icon={<Text style={styles.surfaceIcon}>◇</Text>}
          label="Surfaces"
          selected={section === "surfaces"}
          onPress={() => onPickSection("surfaces")}
        />
        <SidebarFlatItem
          icon={<Text style={styles.gearIcon}>⚙</Text>}
          label="Settings"
          selected={section === "settings"}
          onPress={() => onPickSection("settings")}
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

// ─── Phone — single column + bottom tab bar ─────────────────────────

const TABS: Array<{ key: Section; label: string }> = [
  { key: "conversations", label: "Conversations" },
  { key: "voices", label: "Voices" },
  { key: "surfaces", label: "Surfaces" },
  { key: "settings", label: "Settings" },
];

function PhoneShell({
  section,
  onPickSection,
  onNewConversation,
  toolbarRight,
  children,
}: Props) {
  return (
    <View style={styles.app}>
      {/* Top chrome insets below the status bar / Dynamic Island so the
          wordmark no longer collides with the OS clock (soul §3.2). */}
      <SafeAreaView edges={["top"]} style={styles.phoneHeaderSafe}>
        <View style={styles.phoneHeader}>
          <Wordmark />
          <View style={styles.phoneHeaderRight}>
            {toolbarRight}
            <Pressable
              onPress={onNewConversation}
              hitSlop={8}
              style={({ pressed }) => [
                styles.phoneNewButton,
                pressed && styles.phoneNewButtonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              accessibilityHint="Start a new conversation and open the talk button."
            >
              <Text style={styles.phoneNewPlus}>＋</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.content}>{children}</View>

      {/* Bottom tab bar insets above the home indicator (soul §3.2). One
          context at a time — the conversation list is the Conversations
          tab, not a competing sidebar. */}
      <SafeAreaView edges={["bottom"]} style={styles.tabBarSafe}>
        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <TabItem
              key={tab.key}
              label={tab.label}
              section={tab.key}
              selected={section === tab.key}
              onPress={() => onPickSection(tab.key)}
            />
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

function TabItem({
  label,
  section,
  selected,
  onPress,
}: {
  label: string;
  section: Section;
  selected: boolean;
  onPress: () => void;
}) {
  const tint = selected ? colors.sysAccent : colors.textMuted;
  return (
    <Pressable
      onPress={onPress}
      style={styles.tabItem}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <TabGlyph section={section} tint={tint} />
      <Text style={[styles.tabLabel, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Tab glyphs are SF-Symbol-equivalent monochrome icons on iOS (Marina
 *  v3 #1), system-tinted so the active tab picks up the iOS accent:
 *  Conversations → bubble, Surfaces → radiowaves, Settings → gear. The
 *  Voices tab keeps the brand puck — the one sanctioned custom glyph. */
function TabGlyph({ section, tint }: { section: Section; tint: string }) {
  if (section === "voices") return <Puck size={16} />;
  const name =
    section === "conversations"
      ? "conversations"
      : section === "surfaces"
        ? "surfaces"
        : "settings";
  return <Icon name={name} size={22} color={tint} />;
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // macOS: let the native NSVisualEffectView backdrop show through.
  appMac: {
    backgroundColor: "transparent",
  },
  titlebar: {
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
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
  // macOS: drop the flat translucent fill so the native sidebar-material
  // vibrancy (installed behind the RN host in AppDelegate) is revealed
  // under this column. Selection fills + the hairline border remain.
  sidebarMac: {
    backgroundColor: "transparent",
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
  newButtonPressed: { backgroundColor: colors.bgHover },
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
  surfaceIcon: {
    fontSize: 13,
    color: colors.textMuted,
  },

  main: {
    flex: 1,
    minWidth: 0,
  },
  // macOS: keep the content pane opaque so vibrancy stays scoped to the
  // sidebar column (the titlebar already carries an opaque elevated bg).
  mainMac: {
    backgroundColor: colors.bg,
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
  content: { flex: 1, minWidth: 0 },

  // ─── Phone chrome ───
  phoneHeaderSafe: {
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
  },
  phoneHeader: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  phoneHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  phoneNewButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
  },
  phoneNewButtonPressed: { backgroundColor: colors.bgHover },
  phoneNewPlus: {
    fontSize: 22,
    color: colors.sysAccent,
    lineHeight: 26,
  },
  tabBarSafe: {
    backgroundColor: colors.bgElevated,
    borderTopWidth: 0.5,
    borderTopColor: colors.rule,
  },
  tabBar: {
    flexDirection: "row",
    minHeight: 49,
    alignItems: "stretch",
  },
  tabItem: {
    flex: 1,
    minHeight: 49,
    paddingTop: 6,
    paddingBottom: 4,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabGlyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  tabLabel: {
    fontFamily: fontFamily.ui,
    fontSize: 10,
    fontWeight: "500",
  },
});
