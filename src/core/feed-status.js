/**
 * feed-status.js — TradingView's OWN data-mode fact for the active main series.
 *
 * ═══ WHAT THIS ANSWERS, AND WHY IT IS NOT observed_at_ms ═══
 *
 * `observed_at_ms` says when THIS PROCESS read the value. It says nothing about whether the values
 * it read are real-time or fifteen minutes stale. Those are different facts, and a consumer that
 * authorizes a live-market claim needs the second one. This file supplies only the second.
 *
 * ═══ WHERE THE SEMANTICS COME FROM ═══
 *
 * Recovered read-only from TradingView's own loaded source (2026-09-15).
 *
 *   module 551340 defines the enum:
 *     0 Offline · 1 Resolving · 2 Loading · 3 Ready · 4 InvalidSymbol · 5 Snapshot · 6 EOD
 *     7 Pulse · 8 Delayed · 9 DelayedSteaming · 10 NoBars · 11 Replay · 12 Error
 *     13 CalculationError · 14 UnsupportedResolution        (`DelayedSteaming` is TradingView's typo)
 *
 *   and the same bundle exports the translation as `SERIES_STATUS_TEXT`:
 *     Ready→"realtime"  Delayed→"delayed"  DelayedSteaming→"delayed_streaming"
 *     EOD/Pulse→"endofday"  Snapshot→"snapshot"  Replay→"replay"  …
 *
 * ★ `Ready` IS NOT MERELY "LOADED". TradingView translates it to "realtime", and
 *   `seriesReadyStatuses = Set([Ready, EOD, Pulse, Delayed, DelayedSteaming, Replay])` shows these
 *   are mutually exclusive TERMINAL states in one slot — a delayed series settles on Delayed or
 *   DelayedSteaming, never on Ready. So Ready is a positive assertion of real-time, not an absence.
 *
 * ⛔ TRADINGVIEW'S OWN MAPPER IS NOT CALLABLE. `SERIES_STATUS_TEXT` is a webpack module export with
 *    no page-global binding; reaching it would mean manipulating `self.webpackChunktradingview`,
 *    which mutates application state. So the mapping is restated here — and therefore has to be
 *    GATED, because a restated undocumented ordinal is only true for the build it was read from.
 */

/** Ordinal → TradingView's own data-mode string. Restated from `SERIES_STATUS_TEXT`. */
export const SERIES_STATUS_TEXT = Object.freeze({
  0: 'connecting', 1: 'loading', 2: 'loading', 3: 'realtime', 4: 'invalid',
  5: 'snapshot', 6: 'endofday', 7: 'endofday', 8: 'delayed', 9: 'delayed_streaming',
  10: 'forbidden', 11: 'replay', 12: 'error', 13: 'calculation_error',
  14: 'unsupported_resolution',
});

/**
 * ⛔⛔ THE VERSION GATE — the whole reason this is safe to restate.
 *
 * These ordinals are TradingView's internal representation. Nothing stops a future build from
 * renumbering them, and a renumbering would silently turn `delayed` into `realtime` — the single
 * worst failure this provider could produce. So the mapping is admitted ONLY when the page has
 * loaded the exact content-hashed bundle the mapping was read out of.
 *
 * ★ NARROWEST HONEST ALLOWLIST. Eleven loaded bundles export `SERIES_STATUS_TEXT`, but the enum
 *   AND the string table were both verified by hand in exactly ONE of them. The other ten are not
 *   listed, because "it probably contains the same thing" is not verification.
 *
 * ⛔ EXACT FULL-URL MATCH ONLY — never a prefix, substring, chunk number or host test. The content
 *    hash IS the identity; matching `12354.` would accept every future rebuild of that chunk, which
 *    is precisely the drift this gate exists to refuse.
 *
 * ⚠ OPERATIONAL CONSEQUENCE, STATED: when TradingView ships a new build this stops matching and
 *   `feed_status` disappears. Downstream that means live-market claims fail closed again until the
 *   mapping is re-verified against the new bundle. That is the intended direction of failure, but
 *   it is a real maintenance obligation, not a free win.
 */
export const MAPPING_SOURCE_IDENTITIES = Object.freeze([
  'https://static.tradingview.com/static/bundles/12354.9131e8ea353621b427de.js',
]);

/**
 * The page-side expression. Returns `{ feed_status }` or `{}` — never a guess.
 *
 * ⛔ IT TAKES THE SERIES IT IS GIVEN. The caller passes the SAME `mainSeries()` object it read the
 *    values from, so the status and the values describe one observation. A second lookup here would
 *    let the two drift apart, which is the join this contract exists to forbid.
 */
export const FEED_STATUS_FN = `(function (series, allowed) {
  try {
    var urls = performance.getEntriesByType('resource').map(function (e) { return e.name; });
    var ok = false;
    for (var i = 0; i < allowed.length; i++) { if (urls.indexOf(allowed[i]) >= 0) { ok = true; break; } }
    if (!ok) return {};                       // unrecognised build ⇒ say nothing
    var raw = series.status();
    if (typeof raw !== 'number') return {};   // malformed ⇒ say nothing
    var TEXT = ${JSON.stringify(SERIES_STATUS_TEXT)};
    var s = TEXT[raw];
    if (typeof s !== 'string') return {};     // unmapped ordinal ⇒ say nothing
    return { feed_status: s };
  } catch (e) { return {}; }
})`;
