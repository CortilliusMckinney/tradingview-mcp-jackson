/**
 * observation.js — the PROVIDER-RETRIEVAL observation stamp.
 *
 * ═══ WHAT THIS FIELD MEANS, AND WHAT IT DOES NOT ═══
 *
 * `observed_at_ms` is the epoch-millisecond instant at which THIS PROCESS completed the CDP
 * retrieval whose values are being returned. It is a fact about the READ, never about the market.
 *
 *   it IS      when Jackson finished reading the chart for this result
 *   it is NOT  bar open, candle close, exchange event time, requested time, model time,
 *              or the host's later receipt of the MCP frame
 *
 * ⛔⛔ THE BAR'S `time` IS A DIFFERENT FACT AND STAYS A DIFFERENT FIELD. `getQuote` returns
 *    `time = bars.valueAt(bars.lastIndex())[0]`, the OPEN coordinate of the newest bar — and that
 *    bar may still be forming, so its close can be read many minutes after it opened. Deriving the
 *    observation time from it would assert a read that never happened. Nothing here reads `time`.
 *
 * ═══ WHY THE PROVIDER IS THE ONLY HONEST PRODUCER ═══
 *
 * The consumer reconciles a MODEL-AUTHORED `asOf` against the HOST-CAPTURED observation within one
 * second. That number must therefore be visible to BOTH parties. The host observes the MCP stream
 * and cannot write into the payload the model receives, so a host clock is visible to only one side
 * of a two-sided check. This process is the single point that both the model and the host read the
 * same bytes from — so it is where the instant has to be stated.
 *
 * ═══ A CLOCK DOES NOT CREATE VALIDITY ═══
 *
 * Stamping happens only on a path that already completed a successful retrieval. Every failure
 * throws before `stamp()` is reached and is serialized by the caller as
 * `{ success: false, error }` — which carries no observation metadata and gains no freshness from
 * the fact that a clock exists.
 */

/** The only accepted basis token. The consumer validates this literal, not a shape. */
export const OBSERVED_AT_BASIS = 'provider_retrieval';

/**
 * Attach the retrieval instant to a result object.
 *
 * @param {object} data           the result body, already assembled from a COMPLETED retrieval
 * @param {number} observedAtMs   epoch ms captured AFTER the retrieval resolved
 *
 * ⛔ THE CALLER PASSES THE INSTANT; THIS FUNCTION DOES NOT READ A CLOCK. Reading `Date.now()` here
 *    would time the SERIALIZATION rather than the retrieval, and would silently absorb any work
 *    between the two — which is exactly the drift the field exists to exclude.
 */
export function withObservation(data, observedAtMs) {
  if (!Number.isFinite(observedAtMs)) {
    throw new TypeError('withObservation: observedAtMs must be a finite epoch-millisecond number');
  }
  return { ...data, observed_at_ms: observedAtMs, observed_at_basis: OBSERVED_AT_BASIS };
}

/**
 * The clock the qualifying readers stamp with. Injectable ONLY so tests can prove the instant is
 * taken after the retrieval rather than before it; production never overrides it.
 */
export let observationClock = () => Date.now();

/** @param {() => number} fn */
export function setObservationClockForTests(fn) { observationClock = fn; }
export function resetObservationClockForTests() { observationClock = () => Date.now(); }
