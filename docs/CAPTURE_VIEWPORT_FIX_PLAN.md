# Capture Viewport Fix Plan

Status: draft scaffold only.

Goal: fix TradingView MCP CDP screenshot quality by forcing a landscape desktop viewport before capture.

Problem: current `method: cdp` uses Chrome DevTools `Page.captureScreenshot` against the current TradingView Desktop viewport. If the app window is portrait/mobile-shaped, the captured image includes large black bars and a compressed chart.

Target file:

```text
src/core/capture.js
```

Expected implementation:

- before `Page.captureScreenshot`, call `Emulation.setDeviceMetricsOverride`
- use a desktop landscape viewport, preferably 1920x1080
- set `deviceScaleFactor: 1`
- set `mobile: false`
- capture the screenshot
- call `Emulation.clearDeviceMetricsOverride` in `finally`
- keep `method: api` untouched

Required proof before merge:

- before/after capture comparison
- BTCUSDT 15M test capture
- no huge black bars
- chart fills most of image
- symbol/timeframe/price scale readable

Guardrails:

- no broker calls
- no trading decisions
- no auto-trading
- no evidence session mutation
