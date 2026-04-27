import { register } from '../router.js';
import * as core from '../../core/capture.js';

register('screenshot', {
  description: 'Take a screenshot of the chart',
  options: {
    region: { type: 'string', short: 'r', description: 'Region: full, chart, strategy_tester' },
    output: { type: 'string', short: 'o', description: 'Custom filename (without .png)' },
    width:  { type: 'string', description: 'Viewport width override (default 1920)' },
    height: { type: 'string', description: 'Viewport height override (default 1080)' },
  },
  handler: (opts) => {
    const width = opts.width ? Number(opts.width) : null;
    const height = opts.height ? Number(opts.height) : null;
    const viewport = (width && height) ? { width, height } : undefined;
    return core.captureScreenshot({
      region: opts.region,
      filename: opts.output,
      viewport,
    });
  },
});
