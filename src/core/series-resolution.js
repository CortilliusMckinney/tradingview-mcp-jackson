/**
 * series-resolution.js — WHAT TIMEFRAME THE BARS ACTUALLY ARE, stated by the provider.
 *
 * ═══ THE FACT THIS SUPPLIES, AND WHY NOTHING ELSE COULD ═══
 *
 * A consumer verifying a market-series claim has to know the cadence the series is SUPPOSED to
 * have before it can judge whether the gaps between bars are correct. Until this file existed
 * there was no provider answer to that question, so the consumer sized the contract from its own
 * routing default — and a 4H chart read under an implicit 1H default refused every claim, which
 * is exactly the live failure this file was written for (2026-09-16 gold smoke:
 * "bars are 14400000 ms apart on a 3600000 ms timeframe").
 *
 * ⛔ THE GAPS CANNOT SUPPLY IT. Deriving the expected cadence from the same gaps that are being
 *    checked against it makes the check vacuous — it would confirm every series, including one
 *    with bars genuinely missing. The expectation must come from OUTSIDE the measurement.
 *
 * ⛔ A SECOND EVALUATE CANNOT SUPPLY IT EITHER. `chart_get_state` already returns `resolution`,
 *    but it is a separate page call: between it and the bars the owner can change the chart's
 *    timeframe and nothing would detect the switch. That is the identical hazard
 *    `ACTIVE_CHART_IDENTITY_FN` exists to prevent for the SYMBOL, one field over. So this is read
 *    inside the bars' own synchronous evaluate, beside the identity and the feed status, and all
 *    four describe one chart state.
 *
 * ═══ WHY THIS NEEDS NO VERSION GATE (unlike feed-status) ═══
 *
 * `feed_status` restates an UNDOCUMENTED internal ordinal, so it is admitted only for the exact
 * bundle it was read from. `resolution()` is a public chart-widget accessor already relied on in
 * production by `chart.js` getState, and its value is passed through verbatim. There is no
 * restated mapping here that a future build could silently invalidate.
 *
 * ⛔⛔ AND IT IS PASSED THROUGH BYTE-FOR-BYTE, ON PURPOSE. TradingView's own vocabulary ("60",
 *    "240", "1D") is the provider's fact. Normalising it to "1H"/"4H" here would make this module
 *    the author of a vocabulary the consumer must then trust; the consumer owns that translation.
 *
 *    ★ AND THAT INCLUDES WHITESPACE. An earlier revision emitted `raw.trim()`, which read as
 *      harmless tidying and was not: it silently converted a NONCANONICAL provider statement
 *      (" 240 ") into the exact canonical token (" 240 " -> "240") the consumer may later
 *      authorize. Canonicalisation IS normalisation, and doing it here would hide a malformed
 *      provider answer behind a well-formed one. `trim()` therefore survives ONLY as the
 *      blank-detection PREDICATE below; the value emitted is always the provider's own bytes.
 *      Whether " 240 " is recognised or refused is the consumer's decision to make, on the
 *      evidence it was actually given.
 */

/**
 * ★★ THE PAGE-SIDE RESOLUTION READ. One parameter: the chart API.
 *
 * ⛔ NO CALLER CHANNEL, EVER. The signature is the enforcement — exactly as in
 *    `ACTIVE_CHART_IDENTITY_FN`. A request value cannot be laundered into a provider fact through
 *    a function that has nowhere to put it, not by fallback and not by a later edit that "just
 *    adds one more argument".
 *
 * ⛔ SAY NOTHING RATHER THAN GUESS. Missing accessor, throw, non-string, or blank all return `{}`
 *    — the field is then ABSENT from the payload. Absence is a fact the consumer can fail closed
 *    on; a manufactured "60" is a lie it cannot detect.
 */
export const SERIES_RESOLUTION_FN = `(function (api) {
  try {
    if (!api || typeof api.resolution !== 'function') return {};
    var raw = api.resolution();
    if (typeof raw !== 'string') return {};       // absent / numeric / object ⇒ say nothing
    if (raw.trim() === '') return {};             // blank ⇒ say nothing. TRIM IS THE PREDICATE ONLY.
    return { resolution: raw };                   // ⛔ THE PROVIDER'S BYTES, UNALTERED.
  } catch (e) { return {}; }
})`;
