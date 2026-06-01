/**
 * Core screenshot/capture logic.
 */
import { getClient, evaluate, getChartCollection } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

export async function captureScreenshot({ region, filename, method } = {}) {
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
  let clip = undefined;

  if (region === 'chart') {
    // Wait for TV canvas to paint before capturing — avoids "0 width" CDP error
    // after symbol/timeframe navigation when the chart hasn't repainted yet.
    const POLL_INTERVAL_MS = 100;
    const TIMEOUT_MS = 5000;
    const start = Date.now();
    let bounds = null;
    while (Date.now() - start < TIMEOUT_MS) {
      bounds = await evaluate(`
        (function() {
          var candidates = Array.from(document.querySelectorAll('[data-name="pane-canvas"]'));
          var el = candidates.find(function(c) {
            var r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (!el) el = document.querySelector('.chart-gui-wrapper canvas');
          if (!el) el = document.querySelector('[class*="chart-container"]');
          if (!el) el = document.querySelector('canvas');
          if (!el) return null;
          var rect = el.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        })()
      `);
      if (bounds && bounds.width > 0 && bounds.height > 0) break;
      bounds = null;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!bounds) {
      throw new Error('Chart canvas did not paint within 5000ms');
    }
    clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: 1 };
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
  };
}
