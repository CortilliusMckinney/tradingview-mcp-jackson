/**
 * TradingView Desktop window/profile management.
 *
 * Provides:
 *  - WINDOW_PROFILES — named viewport + OS-window bounds presets used by
 *    capture and startup hygiene.
 *  - resizeTradingViewWindow(profileName) — best-effort macOS-only resize
 *    of the TradingView Desktop app window via AppleScript. Used to keep
 *    the visible app in a usable landscape layout regardless of where TV
 *    happens to open. Screenshot correctness does NOT depend on this; the
 *    primary capture path (clientSnapshot in core/capture.js) is viewport-
 *    independent. This is purely for human visibility into the running
 *    chart.
 *
 * Profile types:
 *  - Evidence (default): used by formal capture sessions. Default to
 *    `macbook` for OS-window bounds; CDP-fallback viewport defaults to
 *    `desktop` (1920x1080).
 *  - Responsive testing (ipad / iphone): viewport-only; for layout
 *    inspection. Not a substitute for evidence captures.
 */

import { execFileSync } from 'child_process';

// Window profiles. `viewport` drives CDP fallback emulation. `osBounds`
// drives the macOS-only window resize. A profile may have one or both.
export const WINDOW_PROFILES = {
  // Evidence profiles — desktop landscape
  desktop: {
    viewport: { width: 1920, height: 1080 },
    description: 'Generic desktop landscape — used for CDP-fallback viewport override',
  },
  macbook: {
    osBounds: { position: [0, 34], size: [1260, 880] },
    viewport: { width: 1260, height: 880 },
    description: 'MacBook built-in display profile — fits a 1288x946 logical resolution (HiDPI 2576x1892 scaled @ 200%) with a small inset to avoid OS-level clamping. Earlier 1722x1083 value was for a different display configuration; macOS truncated it to fit.',
  },
  monitor: {
    osBounds: { position: [697, 168], size: [2189, 1244] },
    viewport: { width: 2189, height: 1244 },
    description: 'External monitor profile — confirmed working window size on attached display',
  },
  // Responsive-testing profiles — viewport only, no OS resize
  ipad: {
    viewport: { width: 1366, height: 1024 },
    description: 'iPad responsive layout test — DO NOT use for formal evidence captures',
  },
  iphone: {
    viewport: { width: 430, height: 932 },
    description: 'iPhone responsive layout test — DO NOT use for formal evidence captures',
  },
};

export const DEFAULT_WINDOW_PROFILE = 'macbook';
export const DEFAULT_VIEWPORT_PROFILE = 'desktop';

export function getProfile(name) {
  return WINDOW_PROFILES[name] || null;
}

export function getViewportFromProfile(name) {
  const p = WINDOW_PROFILES[name];
  return p?.viewport || null;
}

/**
 * Best-effort TradingView Desktop window resize on macOS.
 * Returns { success, profile, position, size } on success or
 * { success: false, reason } on any failure (permission denied, wrong OS,
 * unknown profile, etc.). Never throws — caller should treat failure as
 * informational, not fatal. Screenshot correctness must NOT depend on
 * this succeeding.
 */
export async function resizeTradingViewWindow(profileName = DEFAULT_WINDOW_PROFILE) {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      reason: `window resize is currently macOS-only (got platform: ${process.platform})`,
    };
  }
  const profile = WINDOW_PROFILES[profileName];
  if (!profile) {
    return { success: false, reason: `unknown profile: ${profileName}` };
  }
  if (!profile.osBounds) {
    return {
      success: false,
      reason: `profile '${profileName}' has no osBounds — viewport-only profile, cannot resize window`,
    };
  }
  const [x, y] = profile.osBounds.position;
  const [w, h] = profile.osBounds.size;
  // AppleScript via osascript using multiple -e args — each -e is one line
  // of the script. Avoids the multi-line single-arg parsing problem where
  // the entire script gets treated as one token. Requires macOS
  // Accessibility permission for whatever process invoked node.
  const lines = [
    'tell application "System Events"',
    '  if not (exists (process "TradingView")) then return "tv_not_running"',
    '  tell process "TradingView"',
    '    if (count of windows) = 0 then return "no_windows"',
    `    set position of window 1 to {${x}, ${y}}`,
    `    set size of window 1 to {${w}, ${h}}`,
    '  end tell',
    'end tell',
    'return "ok"',
  ];
  const args = lines.flatMap(line => ['-e', line]);
  try {
    // 15s timeout: first-use Accessibility permission prompt can stall the
    // script for several seconds while macOS surfaces the dialog. After
    // permission is granted once, subsequent calls return in <100ms.
    const out = execFileSync('osascript', args, {
      timeout: 15000,
      encoding: 'utf8',
    }).trim();
    if (out === 'ok') {
      return {
        success: true,
        profile: profileName,
        position: profile.osBounds.position,
        size: profile.osBounds.size,
      };
    }
    return {
      success: false,
      reason: `osascript returned non-ok: ${out}`,
      profile: profileName,
    };
  } catch (err) {
    // Most common failure: macOS Accessibility permission missing for the
    // process running node (Terminal.app, Cursor.app, claude-gui, etc.).
    // Surface a hint without hard-failing.
    return {
      success: false,
      reason:
        'osascript failed (commonly: macOS Accessibility permission missing for the process running this MCP — System Settings → Privacy & Security → Accessibility). Original error: ' +
        (err.message || String(err)).slice(0, 240),
      profile: profileName,
    };
  }
}

/**
 * Convenience listing for tools that want to enumerate available profiles
 * without exposing the implementation object directly.
 */
export function listProfiles() {
  return Object.entries(WINDOW_PROFILES).map(([name, p]) => ({
    name,
    description: p.description,
    viewport: p.viewport || null,
    osBounds: p.osBounds || null,
  }));
}
