/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

// Default landscape desktop viewport for CDP captures.
// Forces TradingView to render its full desktop layout instead of a
// portrait/mobile-shaped responsive layout (which produced black-bar
// letterboxed captures with a compressed chart band — see
// docs/CAPTURE_VIEWPORT_FIX_PLAN.md).
const DEFAULT_CAPTURE_VIEWPORT = { width: 1920, height: 1080 };

// Time to let TradingView re-layout after a device-metrics override before
// we capture. TV's responsive layout swap + chart canvas redraw is fast but
// not synchronous; without this wait the capture can land mid-relayout.
const VIEWPORT_SETTLE_MS = 350;

export async function captureScreenshot({ region, filename, method, viewport } = {}) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fname = filename || `tv_${region}_${ts}`;
  const filePath = join(SCREENSHOT_DIR, `${fname}.png`);

  if (method === 'api') {
    try {
      const colPath = await getChartCollection();
      await evaluate(`${colPath}.takeScreenshot()`);
      return {
        success: true, method: 'api',
        note: 'takeScreenshot() triggered — TradingView will save/show the screenshot via its own UI',
      };
    } catch {
      // Fall through to CDP method
    }
  }

  const client = await getClient();

  // Force a desktop landscape viewport before the capture. The TradingView
  // Desktop app is launched with --remote-debugging-port and connects via
  // CDP at whatever window size the user happens to have it in; without
  // this override, captures of a narrow/portrait window produce
  // letterboxed images with a tiny middle chart band.
  const vp = {
    width: Number(viewport?.width) > 0 ? Number(viewport.width) : DEFAULT_CAPTURE_VIEWPORT.width,
    height: Number(viewport?.height) > 0 ? Number(viewport.height) : DEFAULT_CAPTURE_VIEWPORT.height,
  };

  let overrideApplied = false;
  try {
    await client.Emulation.setDeviceMetricsOverride({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    overrideApplied = true;
    // Allow TradingView to re-layout into desktop mode and the chart canvas
    // to redraw at the new dimensions before we snapshot.
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
    writeFileSync(filePath, Buffer.from(data, 'base64'));

    return {
      success: true, method: 'cdp', file_path: filePath, region,
      size_bytes: Buffer.from(data, 'base64').length,
      viewport: vp,
    };
  } finally {
    // Always clear the override, even if capture errors out — leaving an
    // emulation override in place would skew every subsequent rendering
    // operation against this CDP target until the TV app restarts.
    if (overrideApplied) {
      try { await client.Emulation.clearDeviceMetricsOverride(); } catch { /* best effort */ }
    }
  }
}
