/**
 * Chart view-prep MCP tools.
 *
 * Companion to existing chart tools (chart_set_symbol, chart_set_timeframe,
 * chart_set_visible_range). Adds the missing primitives the AI needs to
 * frame the chart before evidence captures: zoom, pan, fit/reset, and
 * explicit visible-price-range / visible-time-range setters.
 *
 * The PR #59 workflow gap motivates these: drawn levels can be off-frame
 * if the chart isn't framed to the thesis envelope before capture. With
 * these tools the AI can prepare the view so trigger / invalidation /
 * target / WAIT label all land inside the frame.
 *
 * View-prep only — no broker, no trade, no automation, no session
 * artifact mutation. User remains the final decision-maker on every
 * trading call.
 */
import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/chart-view.js';

export function registerChartViewTools(server) {
  server.tool(
    'chart_zoom_in',
    'Zoom the chart in (fewer bars visible). Useful for focusing on recent price action before a capture.',
    {
      steps: z.coerce.number().int().min(1).max(20).optional().describe('Number of zoom steps (default 2). Each step ~30% tighter.'),
    },
    async ({ steps }) => {
      try { return jsonResult(await core.zoomIn({ steps })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'chart_zoom_out',
    'Zoom the chart out (more bars visible). Useful for showing more structural context before a capture.',
    {
      steps: z.coerce.number().int().min(1).max(20).optional().describe('Number of zoom steps (default 2).'),
    },
    async ({ steps }) => {
      try { return jsonResult(await core.zoomOut({ steps })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'chart_pan_left',
    'Pan the chart view to the left (older bars). Default step = 30% of currently visible bar count.',
    {
      bars: z.coerce.number().int().min(1).optional().describe('Number of bars to scroll left. Omit for default 30% of visible window.'),
    },
    async ({ bars }) => {
      try { return jsonResult(await core.panLeft({ bars })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'chart_pan_right',
    'Pan the chart view to the right (newer bars / toward present). Default step = 30% of currently visible bar count.',
    {
      bars: z.coerce.number().int().min(1).optional().describe('Number of bars to scroll right. Omit for default 30% of visible window.'),
    },
    async ({ bars }) => {
      try { return jsonResult(await core.panRight({ bars })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'chart_fit_content',
    'Auto-fit the chart so visible price action fills the frame and the time axis returns to TV default. Equivalent to clicking the fit-content button in TV.',
    {},
    async () => {
      try { return jsonResult(await core.fitContent()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'chart_reset_view',
    'Reset the chart view to defaults (currently identical to chart_fit_content; named for caller intent).',
    {},
    async () => {
      try { return jsonResult(await core.resetView()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  // chart_set_visible_price_range — INTENTIONALLY NOT REGISTERED.
  //
  // The Y-axis (price) range setter cannot be implemented safely on TV
  // Desktop right now. TV's internal `setPriceRange` requires a private
  // `PriceRange` class instance that is not externally constructible.
  // Every alternative path explored in development (`twoPointsScale`,
  // `clearPriceRange + setPriceRange`, `setMaxPriceRange / setMinPriceRange`)
  // silently corrupts the price-axis state into the indicator-pane
  // scale, requiring a full TF / symbol switch to recover. The corruption
  // is only visible at capture time.
  //
  // We do NOT advertise this tool on the MCP surface. Advertising a
  // tool that silently no-ops would confuse future AI sessions and
  // create fake confidence in capture-prep workflows. The core function
  // (`core.setVisiblePriceRange`) remains as a documented stub so a
  // future TV build with a constructible PriceRange (or an equivalent
  // imperative API) can wire it up without changing the surface.
  //
  // Recommended workaround for callers needing specific levels in-frame:
  //   1. chart_fit_content
  //   2. chart_zoom_in / chart_zoom_out to widen / narrow the X-window
  //      until TV's auto-Y-fit pulls the desired levels into the visible
  //      range
  //   3. capture_screenshot method:"cdp" so the visible range is what
  //      lands in the captured PNG

  server.tool(
    'chart_set_visible_time_range',
    'Set the chart X-axis to a specific date range (unix seconds). Equivalent to existing chart_set_visible_range, included here for symmetry with chart_set_visible_price_range.',
    {
      from: z.coerce.number().describe('Start of range (unix timestamp in seconds).'),
      to: z.coerce.number().describe('End of range (unix timestamp in seconds).'),
    },
    async ({ from, to }) => {
      try { return jsonResult(await core.setVisibleTimeRange({ from, to })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );
}
