/**
 * Window/profile MCP tools.
 *
 * - tv_resize_window: best-effort macOS-only resize of the TradingView
 *   Desktop window using a named profile. Used for startup hygiene so the
 *   visible chart isn't stuck in a portrait/mobile layout. Screenshot
 *   correctness does NOT depend on this — clientSnapshot exports the
 *   composited chart canvas regardless of window size.
 * - tv_list_profiles: enumerate WINDOW_PROFILES so callers can pick.
 */
import { z } from 'zod';
import { jsonResult } from './_format.js';
import { resizeTradingViewWindow, listProfiles, DEFAULT_WINDOW_PROFILE } from '../core/window.js';

export function registerWindowTools(server) {
  server.tool(
    'tv_resize_window',
    'Best-effort macOS resize of the TradingView Desktop window to a named profile. Profiles include macbook (built-in display, default), monitor (external), ipad and iphone (responsive testing). Returns success:false with a reason on permission errors or non-macOS — never throws.',
    {
      profile: z.string().optional().describe(`Profile name (default ${DEFAULT_WINDOW_PROFILE}). One of: macbook, monitor, ipad, iphone, desktop.`),
    },
    async ({ profile }) => {
      try {
        const r = await resizeTradingViewWindow(profile || DEFAULT_WINDOW_PROFILE);
        return jsonResult(r);
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'tv_list_profiles',
    'List all named window/viewport profiles. Useful when picking a profile for tv_resize_window or for capture_screenshot fallback viewport.',
    {},
    async () => {
      try {
        return jsonResult({ profiles: listProfiles(), default: DEFAULT_WINDOW_PROFILE });
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
