/**
 * observation.js — what the provider OBSERVED, as distinct from what the caller ASKED FOR.
 *
 * ⛔ DEPENDENCY-FREE ON PURPOSE. These are the exact source strings injected into the page, so a
 *    test can evaluate the bytes production sends without a browser, a CDP connection, or a stub of
 *    the data layer. Living beside `evaluate`'s importers would have made that impossible and left
 *    the only interesting logic in this provider permanently untested.
 */

/**
 * ★★ THE ACTIVE CHART'S OWN IDENTITY — read from the chart, never from the caller.
 *
 * ⛔ WHY THIS EXISTS. `getQuote` takes an optional `symbol` argument and copies it straight into the
 *    result (`var sym = '<arg>'; if (!sym) sym = api.symbol();`, core/data.js:249-251) while the
 *    price it returns always comes from the ACTIVE chart's bar series (:254-258). So
 *    quote_get({symbol:'EURUSD'}) against a Gold chart answers "EURUSD" with GOLD's price. A
 *    consumer that types evidence from that field is typing the CALLER'S ASSERTION, and can
 *    authorise one instrument's price as another's. `getOhlcv` and `getStudyValues` return no
 *    identity at all, so their output cannot be attributed to any instrument.
 *
 * ⛔ DERIVED ONLY FROM `api.symbolExt()` / `api.symbol()` — the same source `symbolInfo()` in
 *    core/chart.js already uses. It never reads the tool argument, and it is evaluated INSIDE the
 *    same page call that reads the data, so the identity and the data describe one observation.
 *
 * Emits nulls rather than guesses: an absent identity is a fact a consumer can fail closed on; a
 * fabricated one is not.
 */
export const ACTIVE_CHART_IDENTITY_FN = `(function (api) {
  var ext = {};
  try { ext = api.symbolExt() || {}; } catch (e) {}
  var live = null;
  try { live = api.symbol(); } catch (e) {}
  return {
    symbol: ext.symbol || live || null,
    full_name: ext.full_name || null,
    exchange: ext.exchange || null,
    type: ext.type || null,
    observed_from: 'active_chart'
  };
})`;

/**
 * ★★ WHEN THE PROVIDER ACTUALLY READ THE VALUE.
 *
 * ⛔ NOT a market-event time, and deliberately not named as one. TradingView exposes no update
 *    timestamp for the evolving last price on the bar series, so the strongest TRUTHFUL source
 *    available is the moment the page executed this read. `observed_at_basis` says exactly that,
 *    so a consumer can decide what it is worth instead of assuming.
 *
 * ⛔ This does NOT replace `time`. `time` is the OPEN of the bar the value came from and keeps that
 *    meaning. A bar's opening timestamp is not the observation time of its still-evolving close,
 *    and conflating them asserts a price at a moment it was not seen.
 */
export const OBSERVED_AT_FN = `(function () {
  return { observed_at_ms: Date.now(), observed_at_basis: 'provider_retrieval' };
})`;
