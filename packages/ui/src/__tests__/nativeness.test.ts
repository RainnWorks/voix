/**
 * B3 — Behavioural-nativeness regression tests.
 *
 * A1 shipped three iOS-native behaviours (haptics on the TalkButton,
 * pull-to-refresh on both lists, swipe-to-delete on Conversation rows).
 * These are touch/Taptic affordances that NEVER fire in the simulator and
 * are easy to silently regress — a refactor that drops a `refreshControl`
 * prop or a misplaced `haptics.talkPressIn()` call breaks the feel without
 * breaking the build, and Tom only notices on-device.
 *
 * Static source-grep is the right tool here, not react-test-renderer:
 *   - The native modules these features lean on (`react-native-haptic-feedback`,
 *     `react-native-swipe-list-view`) are deps of `clients/app`, NOT of
 *     `@voix/ui`, so they aren't in this package's node_modules — rendering
 *     the components would require mocking the whole native bridge.
 *   - The wiring we care about (which handler fires which haptic, which prop
 *     carries the RefreshControl) is statically present in the source. Reading
 *     the file is both cleaner and more robust than a render harness that has
 *     to fake the Taptic Engine.
 *
 * Each assertion below maps to a concrete behaviour and a concrete file from
 * the A1 report (docs/phase-6/verify-results/A1-ios-nativeness-report.md). If
 * a feature is moved or renamed, update the path here in the same change — a
 * failing assertion here means the native behaviour is at risk, not that the
 * test is wrong.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

// `import.meta.dir` is the dir of THIS file (packages/ui/src/__tests__).
// Walk up four levels to the monorepo root so paths read naturally below.
const ROOT = resolve(import.meta.dir, "../../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// A1 changed these exact files (see the report's "What shipped" table).
const TALK_BUTTON = "packages/ui/src/conversations/TalkButton.tsx";
const HAPTICS_NATIVE = "packages/ui/src/platform/haptics.native.ts";
const CONVERSATION_LIST = "packages/ui/src/conversations/ConversationList.tsx";
const VOICE_LIST = "packages/ui/src/voices/VoiceList.tsx";
const SWIPEABLE_ROW_NATIVE = "packages/ui/src/components/SwipeableRow.native.tsx";
const UI_API = "packages/ui/src/lib/api.ts";
const DAEMON_HISTORY_API = "voix-backend/src/api/history.ts";
const APP_PACKAGE_JSON = "clients/app/package.json";

/** Deps of the RN shell (where the native pods/JS libs are declared). */
function appDeps(): Record<string, string> {
  const pkg = JSON.parse(read(APP_PACKAGE_JSON)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

describe("B3 nativeness — 1. TalkButton fires Haptics on press", () => {
  // A1's haptics ride a platform shim: TalkButton imports `haptics` from the
  // platform barrel (web/macOS no-op, .native drives the Taptic bridge), so
  // we assert BOTH ends — the handler calls the shim, and the .native sibling
  // actually drives `react-native-haptic-feedback`'s trigger().
  const src = read(TALK_BUTTON);
  const native = read(HAPTICS_NATIVE);

  test("react-native-haptic-feedback is a dependency of the app shell", () => {
    expect(appDeps()).toHaveProperty("react-native-haptic-feedback");
  });

  test("TalkButton imports the haptics shim from the platform barrel", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bhaptics\b[^}]*\}\s*from\s*["']\.\.\/platform["']/);
  });

  test("press-in handler is wired to onPressIn and fires talkPressIn()", () => {
    // The press-in haptic must fire from the depress handler, the instant
    // the button is grabbed (before the async auth/WS work).
    expect(src).toMatch(/onPressIn=\{handlePressIn\}/);
    const handler = src.slice(src.indexOf("const handlePressIn"));
    expect(handler).toContain("haptics.talkPressIn()");
  });

  test("session-open success thunk fires talkSessionOpen()", () => {
    expect(src).toContain("haptics.talkSessionOpen()");
  });

  test("the .native haptics shim drives react-native-haptic-feedback's trigger()", () => {
    expect(native).toMatch(
      /import\s*\{[^}]*\btrigger\b[^}]*\}\s*from\s*["']react-native-haptic-feedback["']/,
    );
    expect(native).toMatch(/trigger\(\s*["']impactMedium["']/);
    expect(native).toMatch(/trigger\(\s*["']notificationSuccess["']/);
  });
});

describe("B3 nativeness — 2. Conversation list wires refreshControl (pull-to-refresh)", () => {
  const src = read(CONVERSATION_LIST);

  test("imports RefreshControl from react-native", () => {
    expect(src).toContain("RefreshControl");
  });

  test("passes a refreshControl prop to its scroll surface", () => {
    // Non-null React element handed to refreshControl=. We assert the prop is
    // wired (not just that RefreshControl is imported) so a refactor that drops
    // the prop fails here even if the import lingers.
    expect(src).toMatch(/refreshControl=\{/);
    expect(src).toMatch(/<RefreshControl/);
  });
});

describe("B3 nativeness — 3. Voice list wires refreshControl (pull-to-refresh)", () => {
  const src = read(VOICE_LIST);

  test("imports RefreshControl from react-native", () => {
    expect(src).toContain("RefreshControl");
  });

  test("passes a refreshControl prop to its scroll surface", () => {
    expect(src).toMatch(/refreshControl=\{/);
    expect(src).toMatch(/<RefreshControl/);
  });
});

describe("B3 nativeness — 4. Conversation rows support swipe-to-delete", () => {
  const native = read(SWIPEABLE_ROW_NATIVE);
  const list = read(CONVERSATION_LIST);

  test("react-native-swipe-list-view is a dependency of the app shell", () => {
    expect(appDeps()).toHaveProperty("react-native-swipe-list-view");
  });

  test("SwipeableRow.native imports SwipeRow from react-native-swipe-list-view", () => {
    expect(native).toMatch(
      /import\s*\{[^}]*\bSwipeRow\b[^}]*\}\s*from\s*["']react-native-swipe-list-view["']/,
    );
    expect(native).toContain("<SwipeRow");
  });

  test("the swipe action exposes a destructive Delete that fires onDelete", () => {
    expect(native).toMatch(/onDelete/);
    expect(native).toMatch(/onPress=\{onDelete\}/);
  });

  test("ConversationList wraps each row in SwipeableRow wired to a delete handler", () => {
    expect(list).toContain('from "../components/SwipeableRow"');
    expect(list).toMatch(/<SwipeableRow/);
    expect(list).toMatch(/onDelete=\{[^}]*onDeleteEntry/);
  });
});

describe("B3 nativeness — 5. historyApi.delete exists (UI + daemon)", () => {
  const api = read(UI_API);
  const daemon = read(DAEMON_HISTORY_API);

  test("historyApi is exported from the UI api module", () => {
    expect(api).toMatch(/export\s+const\s+historyApi\b/);
  });

  test("historyApi exposes a delete() that issues DELETE /api/history/:id", () => {
    // Grab the historyApi object body and assert the delete member targets the
    // history endpoint with the DELETE method.
    const start = api.indexOf("export const historyApi");
    const body = api.slice(start);
    expect(body).toMatch(/\bdelete:\s*\(/);
    expect(body).toMatch(/api\/history\//);
    expect(body).toMatch(/method:\s*["']DELETE["']/);
  });

  test("daemon exposes DELETE /api/history/:id backing the UI call", () => {
    // If A1's UI delete had no daemon endpoint it would 404 at runtime; assert
    // the route + the store-level deletion it calls.
    expect(daemon).toMatch(/\.delete\(\s*["']\/api\/history\/:id["']/);
    expect(daemon).toContain("deleteHistoryEntry");
  });
});
