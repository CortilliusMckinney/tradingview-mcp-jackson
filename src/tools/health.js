import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/health.js';

export function registerHealthTools(server) {
  server.tool('tv_health_check', 'Check CDP connection to TradingView and return current chart state', {}, async () => {
    try { return jsonResult(await core.healthCheck()); }
    catch (err) { return jsonResult({ success: false, error: err.message, hint: 'TradingView is not running with CDP enabled. Use the tv_launch tool to start it automatically.' }, true); }
  });

  server.tool('tv_discover', 'Report which known TradingView API paths are available and their methods', {}, async () => {
    try { return jsonResult(await core.discover()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_ui_state', 'Get current UI state: which panels are open, what buttons are visible/enabled/disabled', {}, async () => {
    try { return jsonResult(await core.uiState()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tv_launch', 'Launch TradingView Desktop with Chrome DevTools Protocol (remote debugging) enabled. Auto-detects install location on Mac, Windows, and Linux. After CDP is responsive, makes a best-effort attempt to resize the TV window to a usable landscape (macbook profile by default) so the visible chart is not stuck in mobile/mini layout. Capture correctness does NOT depend on this resize succeeding.', {
    port: z.coerce.number().optional().describe('CDP port (default 9222)'),
    kill_existing: z.coerce.boolean().optional().describe('Kill existing TradingView instances first (default true)'),
    window_profile: z.string().optional().describe('Window profile for the post-launch resize. Default macbook. Other options: monitor, desktop, ipad, iphone. See tv_list_profiles.'),
    skip_window_resize: z.coerce.boolean().optional().describe('Skip the post-launch window-resize hygiene step (default false). Capture correctness is unaffected either way.'),
  }, async ({ port, kill_existing, window_profile, skip_window_resize }) => {
    try { return jsonResult(await core.launch({ port, kill_existing, window_profile, skip_window_resize })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
