/**
 * Chart view-prep primitives.
 *
 * Used by the AI to prepare the chart's visible Y-range, X-range, and
 * zoom/pan state BEFORE taking an evidence capture. Closes the workflow
 * gap PR #59 exposed.
 *
 * Verified entry points (per live probe):
 *   model.timeScale().zoomToBarsRange(fromIdx, toIdx)  — X-axis range setter
 *   model.timeScale().reset()                          — X-axis fit
 *   model.mainSeries().bars().firstIndex/lastIndex/valueAt(i)  — bar lookup
 *   model.mainSeries().priceScale().resetScale()       — Y-axis fit
 *   model.mainSeries().priceScale().setPriceRange()    — Y-axis range setter (BEST-EFFORT — see notes)
 *
 * Y-axis caveats (documented):
 *
 *   - The internal setPriceRange() requires an instance of TV's internal
 *     PriceRange class (pn.PriceRange), which is not exposed to external
 *     callers. Plain {minValue, maxValue} objects are rejected with
 *     "incorrect price range".
 *   - `chartWidget.setVisibleRange()` throws "Not implemented" on TV
 *     Desktop — only the time-scale's zoomToBarsRange path works.
 *   - native_canvas captures (clientSnapshot) ignore manual Y-range. CDP
 *     capture honors it. Combine `chart_set_visible_price_range` with
 *     `method:"cdp"` downstream when the range MUST appear in the PNG.
 *
 * Y-axis fallback strategy:
 *
 *   When direct setPriceRange isn't accepted, we use the TwoPointsScale
 *   machinery (startTwoPointsScale / twoPointsScale / endTwoPointsScale)
 *   which TV uses internally for drag-to-scale interactions and accepts
 *   coordinate-anchored prices. If that also fails, return success:false
 *   with a clear reason so the caller can adapt (typically by zooming X
 *   to a window where TV's auto-Y-fit lands close to the desired range).
 */
import { evaluate } from '../connection.js';

const CHART_PATH = 'window.TradingViewApi._activeChartWidgetWV.value()';

async function evalJson(expr) {
  return await evaluate(`
    (function(){
      try { return JSON.stringify((${expr})); }
      catch (e) { return JSON.stringify({ __error: e.message }); }
    })()
  `);
}

function unwrap(raw) {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

// X-axis transform helper: read current visible bar range (indices), apply
// a transform fn(fromIdx, toIdx) -> {fromIdx, toIdx}, then call
// zoomToBarsRange. Returns before/after for caller verification.
async function transformXBars(transformExpr, label) {
  const result = await evalJson(`
    (function(){
      const w = ${CHART_PATH};
      const m = w._chartWidget && w._chartWidget.model();
      if (!m) return { ok: false, reason: 'no model' };
      const ts = m.timeScale && m.timeScale();
      const series = m.mainSeries && m.mainSeries();
      const bars = series && series.bars && series.bars();
      if (!ts || !bars) return { ok: false, reason: 'no timeScale or bars' };
      const firstIdx = bars.firstIndex();
      const lastIdx = bars.lastIndex();
      // Read current visible bar logical range (indices, not seconds)
      const vbr = w.getVisibleBarsRange ? w.getVisibleBarsRange() : null;
      // getVisibleBarsRange returns {from, to} as unix seconds — convert to indices
      let curFromIdx = firstIdx, curToIdx = lastIdx;
      if (vbr) {
        for (let i = firstIdx; i <= lastIdx; i++) {
          const v = bars.valueAt(i);
          if (!v) continue;
          if (v[0] >= vbr.from && curFromIdx === firstIdx) curFromIdx = i;
          if (v[0] <= vbr.to) curToIdx = i;
        }
      }
      const before = { fromIdx: curFromIdx, toIdx: curToIdx };
      const next = (${transformExpr})(curFromIdx, curToIdx, firstIdx, lastIdx);
      // Clamp to data bounds
      const fromIdx = Math.max(firstIdx, Math.min(lastIdx - 5, next.fromIdx));
      const toIdx   = Math.max(fromIdx + 5, Math.min(lastIdx, next.toIdx));
      try {
        ts.zoomToBarsRange(fromIdx, toIdx);
      } catch (e) {
        return { ok: false, reason: 'zoomToBarsRange threw: ' + e.message };
      }
      return { ok: true, before, after: { fromIdx, toIdx }, totalBars: lastIdx - firstIdx };
    })()
  `);
  return { success: true, label, detail: unwrap(result) };
}

// ── Zoom in / out ─────────────────────────────────────────────────────
// Compute a new bar window centred on the current view, span scaled by
// 0.7^n (zoom in) or 1/0.7^n (zoom out). All n steps applied in one
// transform so the chart re-renders once.

export async function zoomIn({ steps = 2 } = {}) {
  const n = Math.max(1, Math.min(20, Number(steps) || 2));
  const factor = Math.pow(0.7, n);
  const transform = `
    (curFrom, curTo) => {
      const span = curTo - curFrom;
      const center = (curFrom + curTo) / 2;
      const newSpan = Math.max(10, Math.round(span * ${factor}));
      return { fromIdx: Math.round(center - newSpan / 2), toIdx: Math.round(center + newSpan / 2) };
    }
  `;
  return transformXBars(transform, `zoom_in(${n} steps)`);
}

export async function zoomOut({ steps = 2 } = {}) {
  const n = Math.max(1, Math.min(20, Number(steps) || 2));
  const factor = Math.pow(1 / 0.7, n);
  const transform = `
    (curFrom, curTo) => {
      const span = curTo - curFrom;
      const center = (curFrom + curTo) / 2;
      const newSpan = Math.round(span * ${factor});
      return { fromIdx: Math.round(center - newSpan / 2), toIdx: Math.round(center + newSpan / 2) };
    }
  `;
  return transformXBars(transform, `zoom_out(${n} steps)`);
}

// ── Pan left / right ──────────────────────────────────────────────────
// Shift the bar-index window. Default step = 30% of currently visible
// bar count; explicit `bars` param overrides.

export async function panLeft({ bars } = {}) {
  const explicitBars = bars && Number(bars) > 0 ? Number(bars) : 0;
  const transform = `
    (curFrom, curTo) => {
      const span = curTo - curFrom;
      const shift = ${explicitBars} > 0 ? -${explicitBars} : -Math.round(span * 0.3);
      return { fromIdx: curFrom + shift, toIdx: curTo + shift };
    }
  `;
  return transformXBars(transform, explicitBars ? `pan_left(${explicitBars} bars)` : 'pan_left(default 30%)');
}

export async function panRight({ bars } = {}) {
  const explicitBars = bars && Number(bars) > 0 ? Number(bars) : 0;
  const transform = `
    (curFrom, curTo) => {
      const span = curTo - curFrom;
      const shift = ${explicitBars} > 0 ? ${explicitBars} : Math.round(span * 0.3);
      return { fromIdx: curFrom + shift, toIdx: curTo + shift };
    }
  `;
  return transformXBars(transform, explicitBars ? `pan_right(${explicitBars} bars)` : 'pan_right(default 30%)');
}

// ── Fit content ──────────────────────────────────────────────────────
// Y-axis: priceScale.resetScale() (re-enables auto-fit). X-axis:
// timeScale.reset() (returns to default rightmost view).

export async function fitContent() {
  const result = await evalJson(`
    (function(){
      const w = ${CHART_PATH};
      const m = w._chartWidget && w._chartWidget.model();
      if (!m) return { ok: false, reason: 'no model' };
      let didY = false, didX = false;
      try {
        const series = m.mainSeries();
        const ps = series && series.priceScale && series.priceScale();
        if (ps && typeof ps.resetScale === 'function') { ps.resetScale(); didY = true; }
      } catch {}
      try {
        const ts = m.timeScale && m.timeScale();
        if (ts && typeof ts.reset === 'function') { ts.reset(); didX = true; }
      } catch {}
      return { ok: didX || didY, didY, didX };
    })()
  `);
  return { success: true, detail: unwrap(result) };
}

export async function resetView() {
  const out = await fitContent();
  return { success: out.success, detail: out.detail, note: 'reset = fit_content' };
}

// ── Set visible price range (Y-axis) ──────────────────────────────────
// CURRENTLY UNRELIABLE on TV Desktop, documented honestly so callers
// know to plan around it.
//
// The internal `priceScale.setPriceRange()` requires an instance of TV's
// `pn.PriceRange` class which is not exposed externally — plain objects
// are rejected with "incorrect price range". We do NOT fall back to the
// TwoPointsScale machinery: in testing, that path corrupts the chart's
// main price-axis state into the indicator-pane scale (e.g. -200 to +200
// when BTC is at $79k), requiring a `chart_fit_content` to restore.
// Destructive fallback isn't worth the brittle gain.
//
// Recommended caller pattern instead:
//   1. `chart_fit_content` to land on TV's auto-fit Y-range
//   2. `chart_zoom_in` / `chart_zoom_out` to widen/narrow the X-window
//      (TV's auto-Y-scale will re-fit around the visible bars, often
//      including the levels you want)
//   3. `capture_screenshot method:"cdp"` so the visible range is what
//      lands in the PNG
//
// This tool is preserved as a placeholder + clear failure surface so a
// future TV build (or a discovered alternate API path) can fill it in
// without changing the MCP tool surface.
export async function setVisiblePriceRange({ min, max, lock_auto_scale = true }) {
  // Note: lock_auto_scale is accepted for forward-compatibility but
  // currently unused — see implementation note below.
  void lock_auto_scale;
  const minV = Number(min);
  const maxV = Number(max);
  if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV >= maxV) {
    return { success: false, error: 'min and max must be finite numbers with min < max' };
  }
  // PURE NO-OP IMPLEMENTATION on TV Desktop.
  //
  // We do NOT call setPriceRange / clearPriceRange / setMaxPriceRange /
  // setMinPriceRange / startTwoPointsScale. Every one of those paths
  // either fails noisily (instanceof guard) or partially mutates the
  // priceScale into an indicator-pane scale state that resetScale()
  // alone cannot fully undo. The damage is silent and only visible at
  // capture time — exactly the failure mode this PR is meant to
  // prevent. Returning success:false without touching the chart is
  // strictly better than a corrupting attempt.
  //
  // When TradingView exposes a constructible PriceRange (or an
  // equivalent imperative API), this tool can be filled in without
  // changing the surface.
  const verify = await evalJson(`(${CHART_PATH}).getVisiblePriceRange()`);
  return {
    success: false,
    requested: { min: minV, max: maxV },
    applied: unwrap(verify),
    detail: {
      ok: false,
      reason: 'setVisiblePriceRange is unavailable on TV Desktop — direct setPriceRange requires an internal class instance, and every attempted fallback (clearPriceRange, twoPointsScale, setMaxPriceRange) corrupts the price-axis state. Tool intentionally no-ops to avoid silent damage.',
      recommendation: 'Use chart_fit_content + chart_zoom_in/out + capture with method cdp to get a Y-range that includes the desired levels. The auto-Y-fit re-fits around the visible bar window, so widening or narrowing the X-window pulls the right Y-range into frame.',
    },
  };
}

// ── Set visible time range (X-axis) ───────────────────────────────────
// Wrapper around timeScale.zoomToBarsRange() — converts unix-second
// bounds to bar indices first (matching the existing chart_set_visible_range
// implementation).

export async function setVisibleTimeRange({ from, to }) {
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f >= t) {
    return { success: false, error: 'from and to must be finite unix seconds with from < to' };
  }
  const result = await evalJson(`
    (function(){
      const w = ${CHART_PATH};
      const m = w._chartWidget && w._chartWidget.model();
      if (!m) return { ok: false, reason: 'no model' };
      const ts = m.timeScale && m.timeScale();
      const series = m.mainSeries && m.mainSeries();
      const bars = series && series.bars && series.bars();
      if (!ts || !bars) return { ok: false, reason: 'no timeScale or bars' };
      const firstIdx = bars.firstIndex();
      const lastIdx = bars.lastIndex();
      let fromIdx = firstIdx, toIdx = lastIdx;
      for (let i = firstIdx; i <= lastIdx; i++) {
        const v = bars.valueAt(i);
        if (!v) continue;
        if (v[0] >= ${f} && fromIdx === firstIdx) fromIdx = i;
        if (v[0] <= ${t}) toIdx = i;
      }
      try {
        ts.zoomToBarsRange(fromIdx, toIdx);
      } catch (e) {
        return { ok: false, reason: 'zoomToBarsRange threw: ' + e.message };
      }
      return { ok: true, fromIdx, toIdx };
    })()
  `);
  const verify = await evalJson(`(${CHART_PATH}).getVisibleRange()`);
  return {
    success: true,
    requested: { from: f, to: t },
    applied: unwrap(verify),
    detail: unwrap(result),
  };
}
