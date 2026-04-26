/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

// TradingView-native export path. Uses the chart widget collection's own
// `clientSnapshot()` method, which returns a fully composited
// HTMLCanvasElement at TV's intended export resolution. Reading pixels via
// `canvas.toDataURL('image/png')` gives us a PNG that does not depend on
// the desktop window size, the visible viewport, or whether TV is
// maximized — TV builds the canvas internally before any of that matters.
//
// This is NOT a CDP viewport screenshot. It is the same code path TV's own
// "Take a snapshot" button uses to render the export image, just invoked
// directly without going through the UI. Per PR #56's annotation workflow
// spec: "TradingView owns the drawing + screenshot/export layer."
async function captureViaNativeCanvas(client, filePath) {
  const r = await client.Runtime.evaluate({
    expression: `
      (async () => {
        const c = window.TradingViewApi && window.TradingViewApi._chartWidgetCollection;
        if (!c || typeof c.clientSnapshot !== 'function') {
          return { ok: false, reason: 'clientSnapshot not available' };
        }
        let canvas;
        try { canvas = await c.clientSnapshot(); }
        catch (e) { return { ok: false, reason: 'clientSnapshot threw: ' + (e?.message || e) }; }
        if (!canvas || typeof canvas.toDataURL !== 'function') {
          return { ok: false, reason: 'clientSnapshot did not resolve to a canvas' };
        }
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
          return { ok: false, reason: 'toDataURL did not return a PNG' };
        }
        return { ok: true, dataUrl, width: canvas.width, height: canvas.height };
      })()
    `,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    return { ok: false, reason: 'CDP exception: ' + (r.exceptionDetails.text || 'unknown') };
  }
  const v = r.result?.value || {};
  if (!v.ok) return { ok: false, reason: v.reason || 'unknown native-capture failure' };
  const b64 = String(v.dataUrl).split(',')[1] || '';
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 1000) {
    return { ok: false, reason: 'PNG smaller than 1 KB — likely empty canvas' };
  }
  writeFileSync(filePath, buf);
  return {
    ok: true,
    file_path: filePath,
    size_bytes: buf.length,
    width: v.width,
    height: v.height,
  };
}

export async function captureScreenshot({ region, filename, method, viewport } = {}) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = filename || `tv_${region}_${ts}`;
  const filePath = join(SCREENSHOT_DIR, `${fname}.png`);

  // Existing `method:"api"` path — kept untouched. Triggers TV's own UI flow
  // (which lands the screenshot via clipboard or download dialog and does NOT
  // return data here). Preserved for callers that explicitly want the UI flow.
  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evaluate(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api',
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to native/CDP methods
    }
  }

  const client = await getClient();

  // PRIMARY: TradingView-native export via clientSnapshot. Independent of
  // viewport/window size. Falls through to CDP only if the native path
  // cannot run (TV API not loaded, canvas-less context, etc).
  if (method !== 'cdp') {
    const native = await captureViaNativeCanvas(client, filePath);
    if (native.ok) {
      return {
        success: true,
        method: 'native_canvas',
        file_path: native.file_path,
        size_bytes: native.size_bytes,
        dimensions: { width: native.width, height: native.height },
      };
    }
    if (method === 'native') {
      // User explicitly asked for native — surface the failure instead of
      // silently downgrading to CDP, which would defeat the entire reason
      // they picked native.
      return {
        success: false,
        method: 'native_canvas',
        error: native.reason,
      };
    }
    // Default path (no method specified): annotate the fallback so callers
    // can see it happened and adjust if needed.
  }

  // FALLBACK: CDP viewport screenshot with landscape viewport override.
  // Only reached when native is opted out (`method:"cdp"`) or unavailable.
  // The viewport override (Emulation.setDeviceMetricsOverride at 1920x1080)
  // is carried over from the PR #1 capture-quality fix so this fallback
  // doesn't regress to the small/letterboxed mess the original CDP path
  // produced when TV's window is narrow. Native canvas is still the
  // preferred path — this is a safety net.
  // Caller can override the fallback viewport via the `viewport` parameter
  // (threaded from the MCP tool surface). Default 1920x1080 landscape.
  const FALLBACK_VIEWPORT = {
    width: Number(viewport?.width) > 0 ? Number(viewport.width) : 1920,
    height: Number(viewport?.height) > 0 ? Number(viewport.height) : 1080,
  };
  const VIEWPORT_SETTLE_MS = 350;

  let overrideApplied = false;
  try {
    await client.Emulation.setDeviceMetricsOverride({
      width: FALLBACK_VIEWPORT.width,
      height: FALLBACK_VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    overrideApplied = true;
    await new Promise(r => setTimeout(r, VIEWPORT_SETTLE_MS));

    let clip = undefined;
    if (region === 'chart') {
      const bounds = await evaluate(`
        (function() {
          var el = document.querySelector('[data-name="pane-canvas"]')
            || document.querySelector('[class*="chart-container"]')
            || document.querySelector('canvas');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `);
      if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
    } else if (region === 'strategy_tester') {
      const bounds = await evaluate(`
        (function() {
          var el = document.querySelector('[data-name="backtesting"]')
            || document.querySelector('[class*="strategyReport"]');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `);
      if (bounds) clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
    }

    const params = { format: 'png' };
    if (clip) params.clip = clip;

    const { data } = await client.Page.captureScreenshot(params);
    const buf = Buffer.from(data, 'base64');
    writeFileSync(filePath, buf);

    return {
      success: true, method: 'cdp', file_path: filePath, region,
      size_bytes: buf.length,
      viewport: FALLBACK_VIEWPORT,
    };
  } finally {
    if (overrideApplied) {
      try { await client.Emulation.clearDeviceMetricsOverride(); } catch { /* best effort */ }
    }
  }
}
