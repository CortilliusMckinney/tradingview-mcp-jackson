# Investigation — TV auto-resize unreliable in real startup flow

PR #3 wired auto-resize into `core/launch.js`. PR #4 fixed the macbook profile to
1260x880. Direct `tv_launch` tests passed. But in the real GUI start-trading flow,
TradingView still opens in a mini/mobile window.

This document captures the root cause + proposed fix shape **before** implementation,
per the PR-first workflow.

## Findings

### Q1 — Does `start-trading.sh` call `tv_launch`? **NO.**

`start-trading.sh` launches TradingView Desktop directly via macOS `open`:

```bash
pkill -f "TradingView"
sleep 15
open -a "TradingView" --args --remote-debugging-port=9222 --remote-allow-origins='*'
```

It bypasses the MCP `core/launch.js` path entirely. The auto-resize wired into
`launch()` by PR #3 is **dead code in the real startup flow.**

### Q2 — Attach vs fresh launch? **Attach.**

After `start-trading.sh` opens TV directly, the MCP `connection.js` connects to
`http://localhost:9222` and attaches to the running browser. `launch()` is never
invoked → `resizeTradingViewWindow` is never called.

### Q3 — Resize timing too early? **N/A** in real flow.

Inside `launch()` resize fires at CDP-ready + 1500 ms. That timing is fine but
irrelevant because `launch()` isn't on the real startup path.

### Q4 — Does TV restore mini-window bounds? **Likely yes — secondary.**

macOS `open -a TradingView` reopens at the last-saved window state. If TV was
previously closed in mini layout, mini comes back. Without an explicit resize
firing, mini sticks.

### Q5 — What process does AppleScript resize? **`process "TradingView"` window 1.**

Confirmed via `src/core/window.js`:

```applescript
tell process "TradingView"
  set position of window 1 to {0, 34}
  set size of window 1 to {1260, 880}
end tell
```

Mechanism works — Accessibility permission already granted on this machine.
It just isn't being called by `start-trading.sh`.

## Root cause

`start-trading.sh` launches TradingView outside the MCP launch flow. PR #3 wired
resize into `launch()`, but `launch()` is never invoked in the real startup.

## Proposed fix shape

1. **New MCP tool `tv_ensure_window_profile(profile, max_retries, retry_delay_ms)`**
   - Resize via existing `resizeTradingViewWindow`.
   - Verify actual bounds via `osascript` (`get position` / `get size of window 1`).
   - Retry on mismatch up to `max_retries`.
   - Return rich response:
     - `requested_position`
     - `requested_size`
     - `actual_position`
     - `actual_size`
     - `matched_profile` — `true` only if actual matches requested within tolerance
     - `attempts`
2. **Refactor `core/launch.js`** to use the same verify-and-retry helper internally,
   so `launch()` and `tv_ensure_window_profile` behave identically.
3. **Add `bin/tv-ensure-profile.mjs`** — standalone Node script that imports the
   helper and runs it without requiring the MCP server. Writes JSON result to
   stdout. Lets shell scripts call resize without spinning up the MCP transport.
4. **Update `start-trading.sh`** — after CDP target found + chart navigated, call:

   ```bash
   node tradingview-mcp-jackson/bin/tv-ensure-profile.mjs macbook
   ```

   and log the JSON result. This is the integration the real startup flow has
   been missing.

## Out of scope

- No changes to capture logic.
- No changes to drawing logic.
- No changes to Evidence Viewer.
- No changes to Trade Desk response formatting.
- No broker calls. No trading decisions.

## Acceptance test

1. Quit TradingView completely.
2. Run `AUTO_MORNING_BRIEF=false ./start-trading.sh`.
3. TradingView opens at macbook profile: position `{0, 34}`, size `{1260, 880}`.
4. Not mini/mobile.
5. `tv-ensure-profile.mjs` JSON output (and `tv_ensure_window_profile` MCP response
   if invoked) reports `actual_size: [1260, 880]` and `matched_profile: true`.
6. Restart GUI again — still works.
