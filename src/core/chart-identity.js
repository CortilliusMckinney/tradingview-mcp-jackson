/**
 * chart-identity.js — WHICH INSTRUMENT THE CHART WAS ACTUALLY SHOWING.
 *
 * ═══ WHY THIS MODULE EXISTS ═══
 *
 * Every value this provider emits comes off the ACTIVE CHART's main series. Nothing in the result
 * said which instrument that chart was on, so a consumer could not attribute the numbers to an
 * instrument without trusting the request it had just made. `getQuote` made that worse: it accepts
 * an optional `symbol`, echoes it back in the result, and reads the price from the active chart
 * regardless — so `quote_get({symbol:'EURUSD'})` on a Gold chart returns EURUSD beside GOLD's
 * price. That echo is the caller's assertion, not an observation.
 *
 * ★★ AN IDENTITY IS ONLY INDEPENDENT IF THE CALLER CANNOT REACH IT. Two structural guarantees:
 *
 *   1. `ACTIVE_CHART_IDENTITY_FN` TAKES THE CHART API AND NOTHING ELSE. There is no symbol
 *      parameter, so there is no channel through which a request value could become identity —
 *      not by fallback, not by default, not by a later edit that "just adds one more argument".
 *   2. `jsStringLiteral` makes the caller's symbol INERT DATA in the generated page source. Without
 *      it the caller is writing JavaScript that runs BEFORE this helper does, and can redefine
 *      `symbolExt` itself — at which point the "independent" identity is whatever the caller said.
 *
 * ⛔ THE SECOND GUARANTEE IS A PRECONDITION OF THE FIRST, NOT A SEPARATE CONCERN. Shipping the
 *    identity read without the serialization fix would state provider-bound identity while the
 *    caller could still forge it.
 */

/** The one value of `observed_from` this provider may state: it was read off the active chart. */
export const OBSERVED_FROM_ACTIVE_CHART = 'active_chart';

/**
 * ★★ THE PAGE-SIDE IDENTITY READ. One parameter: the chart API.
 *
 * ⛔ NO REQUEST SYMBOL, EVER. The signature is the enforcement — a caller value cannot be laundered
 *    into identity through a function that has nowhere to put it. A structural test fails if this
 *    expression ever mentions the request variable.
 *
 * ⛔ NO DEFAULTS AND NO GUESSES. A field TradingView does not expose becomes `null`. Inventing
 *    `'OANDA'` or echoing the requested symbol would make the absence of knowledge look like
 *    knowledge, which is the failure this whole field exists to prevent.
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
    observed_from: '${OBSERVED_FROM_ACTIVE_CHART}'
  };
})`;

/**
 * Emit a COMPLETE, correctly escaped JavaScript string literal for an arbitrary value.
 *
 * ⛔⛔ NOT QUOTE-ESCAPING. `String(v).replace(/'/g, "\\'")` — the idiom used elsewhere in this
 *     repository — still leaves a backslash, a newline or a line separator as a way out of the
 *     literal. It is the weak variant and a mutant implementing it is killed by the test suite.
 *
 * ★ `JSON.stringify` produces a valid JS string literal for every string, escaping quotes,
 *   backslashes, newlines, CR, tab and NUL. U+2028 and U+2029 are legal RAW inside JSON strings
 *   but were illegal raw inside JS string literals before ES2019 — modern engines accept them, but
 *   the page's engine is not ours to assume, so they are escaped explicitly.
 *
 * ⛔ THE VALUE IS NOT ALTERED. No trim, no case fold, no normalisation: only its REPRESENTATION in
 *   the generated source changes. The caller's exact bytes must still be echoed back, because that
 *   is the existing contract — they simply must not be able to execute.
 */
/**
 * ⛔ THIS MODULE MUST NOT CONTAIN THE CHARACTERS IT ESCAPES. A raw U+2028 or U+2029 sitting in a
 *    source file is precisely the hazard being defended against, and a file carrying one can be
 *    silently corrupted by any tool in the editing path. So the two separators and the escape
 *    sequences are BUILT from code points rather than typed, and the file stays free of both.
 */
const BACKSLASH = String.fromCharCode(92);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function jsStringLiteral(value) {
  return JSON.stringify(String(value ?? ''))
    .split(LINE_SEPARATOR).join(BACKSLASH + 'u2028')
    .split(PARAGRAPH_SEPARATOR).join(BACKSLASH + 'u2029');
}
