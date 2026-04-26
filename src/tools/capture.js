import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server) {
  server.tool('capture_screenshot', 'Take a screenshot of the TradingView chart', {
    region: z.string().optional().describe('Region to capture: full, chart, strategy_tester (default full)'),
    filename: z.string().optional().describe('Custom filename (without extension)'),
    method: z.string().optional().describe('Capture method: cdp (Page.captureScreenshot) or api (chartWidgetCollection.takeScreenshot) (default cdp)'),
    viewport: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).optional().describe('Optional viewport override for the capture (default 1920x1080 desktop landscape). Forces TV out of responsive/mobile layout when the desktop window is portrait-shaped.'),
  }, async ({ region, filename, method, viewport }) => {
    try { return jsonResult(await core.captureScreenshot({ region, filename, method, viewport })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
