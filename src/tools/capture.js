import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server) {
  server.tool('capture_screenshot', 'Take a screenshot of the TradingView chart', {
    region: z.string().optional().describe('Region to capture: full, chart, strategy_tester (default full)'),
    filename: z.string().optional().describe('Custom filename (without extension)'),
    method: z.string().optional().describe('Capture method: native (TradingView clientSnapshot — composited canvas at TV\'s export resolution, viewport-independent, DEFAULT), cdp (Page.captureScreenshot fallback with viewport override), or api (triggers TradingView UI flow only). Default: native first, falls back to cdp if native fails.'),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).optional().describe('Explicit viewport override for the CDP fallback (only used when native fails or method:"cdp"). Takes precedence over `profile`.'),
    profile: z.string().optional().describe('Named profile from tv_list_profiles to use for the CDP fallback viewport. Common: desktop (default 1920x1080), macbook, monitor, ipad, iphone. Native path ignores this — clientSnapshot exports at TV\'s own resolution.'),
  }, async ({ region, filename, method, viewport, profile }) => {
    try { return jsonResult(await core.captureScreenshot({ region, filename, method, viewport, profile })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}

// TODO (future PR — chart navigation): Add explicit MCP tools so an AI can
// prepare the chart before capture without driving TV's UI.
//   - chart_zoom_in / chart_zoom_out
//   - chart_pan_left / chart_pan_right
//   - chart_fit_content / chart_reset_view
// Today, symbol/timeframe changes are already supported via existing
// chart tools; visual range and zoom are not. Out of scope for PR #1.
