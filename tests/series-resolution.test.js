// series-resolution.test.js — WHAT TIMEFRAME ARE THESE BARS? Executed, not assumed.
//
// ═══ THE LIVE FAILURE THIS ANSWERS ═══
//
// 2026-09-16 integrated gold smoke. The owner asked "what is the current regime on gold?" — naming
// NO timeframe — while the chart was on 4H. The consumer had no provider statement of the series
// cadence, so it sized the contract from its own routing default and refused:
//
//   "bars are 14400000 ms apart on a 3600000 ms timeframe — observations are missing between them"
//
// The bars were fine. The expectation was invented. This file proves the provider now STATES the
// cadence, from the same observation that produced the bars.
//
// ⛔⛔ THE TESTS RUN THE REAL EMITTED PAGE SOURCE. `getOhlcv` builds one expression and hands it to
//     `evaluate`; a test that only inspects the returned payload cannot see whether the resolution
//     was read in that same call or smuggled in from somewhere else. So the captured expression is
//     executed in `node:vm` against a fake chart API — the same technique chart-identity.test.js
//     uses, and for the same reason.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import { SERIES_RESOLUTION_FN } from '../src/core/series-resolution.js';
import { MAPPING_SOURCE_IDENTITIES } from '../src/core/feed-status.js';

const DATA_SRC = readFileSync(new URL('../src/core/data.js', import.meta.url), 'utf8');
const RES_SRC = readFileSync(new URL('../src/core/series-resolution.js', import.meta.url), 'utf8');
const GOOD_BUNDLE = MAPPING_SOURCE_IDENTITIES[0];

const resolutionFn = eval(SERIES_RESOLUTION_FN);   // eslint-disable-line no-eval
const GOLD_EXT = { symbol: 'XAUUSD', full_name: 'OANDA:XAUUSD', exchange: 'OANDA', type: 'forex' };
const BARS = [[1700000000, 4000, 4010, 3990, 4005, 12]];

/**
 * A chart API whose resolution accessor the test controls.
 *
 * ⛔ ABSENCE HAS ITS OWN CHANNEL — `noResolution: true` — and is NOT expressed as
 *    `resolution: undefined`. Passing `undefined` to a defaulted destructure yields THE DEFAULT,
 *    so the "missing accessor" case silently became the happy path and the test asserted the
 *    opposite of what it claimed. That is a real recurring defect class, caught here.
 */
function makeChartApi({ resolution = () => '240', noResolution = false, ...overrides } = {}) {
  const series = {
    bars: () => ({ lastIndex: () => 0, firstIndex: () => 0, size: () => 1, valueAt: (i) => BARS[i] }),
    status: () => 3,
  };
  const api = {
    symbolExt: () => ({ ...GOLD_EXT }),
    symbol: () => 'XAUUSD',
    _chartWidget: { model: () => ({ mainSeries: () => series }) },
    ...overrides,
  };
  if (!noResolution) api.resolution = resolution;
  return api;
}

/** ⛔ A vm-returned object carries the SANDBOX realm's prototype — re-home before comparing. */
const hostRealm = (o) => (o === null || typeof o !== 'object' ? o : { ...o });

function runPageSource(source, chartApi) {
  const sandbox = {
    document: { querySelector: () => null },
    performance: { getEntriesByType: () => [{ name: GOOD_BUNDLE }] },
  };
  sandbox.window = { TradingViewApi: { _activeChartWidgetWV: { value: () => chartApi } } };
  vm.createContext(sandbox);
  return vm.runInContext(source, sandbox, { timeout: 2000 });
}

let lastInput = null;
let nextPayload = null;
let evalCount = 0;
mock.module('../src/connection.js', {
  namedExports: {
    KNOWN_PATHS: {
      chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
      mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
    },
    async evaluate(expr) { evalCount += 1; lastInput = expr; return typeof nextPayload === 'function' ? nextPayload() : nextPayload; },
    async evaluateAsync() { return null; },
  },
});
const { getOhlcv } = await import('../src/core/data.js');
const providerBars = () => [{ time: 1700000000, open: 4000, high: 4010, low: 3990, close: 4005, volume: 12 }];
const IDENT = { ...GOLD_EXT, observed_from: 'active_chart' };

/** The REAL expression getOhlcv emits, captured from the one evaluate it performs. */
async function emittedOhlcvSource({ summary = false } = {}) {
  nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars' };
  await getOhlcv({ count: 1, summary });
  return lastInput;
}

describe('Provider-stated series resolution', () => {
  it('1 · ★★★ the resolution is read in the SAME evaluate as the bars, identity and feed status', async () => {
    const src = await emittedOhlcvSource();
    const r = hostRealm(runPageSource(src, makeChartApi({ resolution: () => '240' })));
    // one page call produced ALL FOUR facts — that is the binding, and it is what a second
    // evaluate could never establish
    assert.equal(r.resolution, '240', 'the resolution came out of the bars own evaluate');
    assert.equal(r.bars.length, 1, 'and so did the bars');
    assert.equal(r.feed_status, 'realtime', 'and the feed status');
    assert.deepEqual(hostRealm(r.active_chart), IDENT, 'and the instrument identity');
  });

  it('2 · a 1H provider resolution survives exactly, unchanged', async () => {
    const r = runPageSource(await emittedOhlcvSource(), makeChartApi({ resolution: () => '60' }));
    assert.equal(r.resolution, '60', 'passed through raw — no vocabulary translation here');
  });

  it('3 · a 4H provider resolution survives exactly, unchanged', async () => {
    const r = runPageSource(await emittedOhlcvSource(), makeChartApi({ resolution: () => '240' }));
    assert.equal(r.resolution, '240');
  });

  it('4 · ⛔ a MISSING resolution is ABSENT, never filled from a default', async () => {
    const r = hostRealm(runPageSource(await emittedOhlcvSource(), makeChartApi({ noResolution: true })));
    assert.equal('resolution' in r, false, 'absence is a fact the consumer can fail closed on');
    assert.equal(r.bars.length, 1, 'and the bars are still returned — this is not an error path');
  });

  it('5 · ⛔ a THROWING or MALFORMED resolution manufactures no authority', async () => {
    for (const [label, acc] of [
      ['throws', () => { throw new Error('boom'); }],
      ['numeric', () => 240],
      ['null', () => null],
      ['object', () => ({ value: '240' })],
      ['blank', () => '   '],
    ]) {
      const r = hostRealm(runPageSource(await emittedOhlcvSource(), makeChartApi({ resolution: acc })));
      assert.equal('resolution' in r, false, `${label} must yield no resolution field`);
    }
  });

  it('5b · ⛔⛔ a NONCANONICAL provider string survives BYTE-FOR-BYTE — no trim, no tidying', async () => {
    // ★ THE BOUNDARY, AND WHY WHITESPACE IS NOT A DETAIL. An earlier revision emitted `raw.trim()`.
    //   That reads as harmless tidying and is not: it converts a NONCANONICAL provider statement
    //   into the exact canonical token the consumer may later authorize, so a malformed provider
    //   answer would arrive wearing a well-formed one's clothes. The consumer owns resolution
    //   vocabulary; this provider states what it was actually told.
    const SP = String.fromCharCode(32), TAB = String.fromCharCode(9), LF = String.fromCharCode(10);
    for (const raw of [SP + '240' + SP, TAB + '60' + LF, '240' + SP, SP + '1D']) {
      const r = hostRealm(runPageSource(await emittedOhlcvSource(), makeChartApi({ resolution: () => raw })));
      assert.equal(r.resolution, raw, `provider bytes ${JSON.stringify(raw)} must survive unaltered`);
      assert.notEqual(r.resolution, raw.trim(), 'a trimmed value would be this module inventing a token');
    }
  });

  it('5c · ⛔ but a WHITESPACE-ONLY string is still absence, not a value', async () => {
    const SP = String.fromCharCode(32), TAB = String.fromCharCode(9), LF = String.fromCharCode(10);
    for (const blank of [SP + SP, TAB, LF, SP + TAB + LF]) {
      const r = hostRealm(runPageSource(await emittedOhlcvSource(), makeChartApi({ resolution: () => blank })));
      assert.equal('resolution' in r, false, 'blank states nothing — trim is the PREDICATE, not a transform');
    }
  });

  it('6 · ⛔⛔ the CALLER cannot supply or override the resolution — structural', () => {
    // The signature is the enforcement: one parameter, the chart API. A request value has nowhere
    // to go. Same guarantee, and same mechanism, as ACTIVE_CHART_IDENTITY_FN.
    assert.equal(resolutionFn.length, 1, 'exactly one parameter: the chart API');
    assert.equal(/\bcount\b|\bsymbol\b|\brequest\b|\bsummary\b/.test(SERIES_RESOLUTION_FN), false,
      'the page expression must not mention any caller-supplied name');
    // ...and the call site passes only `api`
    assert.match(DATA_SRC, /\(\$\{SERIES_RESOLUTION_FN\}\)\(api\)/,
      'the call site may pass the chart API and nothing else');
  });

  it('7 · ⛔ EXACTLY ONE page evaluation — a second read would be a second observation', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: IDENT, resolution: '240' };
    evalCount = 0;
    const r = await getOhlcv({ count: 1 });
    assert.equal(evalCount, 1, 'the full path must perform exactly ONE page evaluation');
    assert.equal(r.resolution, '240');
    // ★ COUNT THE INVOCATION, NOT THE TEXT. `api.resolution` appears twice in the emitted source
    //   (the typeof guard and the call itself), so counting the identifier measured nothing about
    //   how many observations were taken. Running the real source with a counting accessor does.
    let reads = 0;
    const counting = makeChartApi({ resolution: () => { reads += 1; return '240'; } });
    const page = hostRealm(runPageSource(lastInput, counting));
    assert.equal(reads, 1, 'the page call must read the resolution exactly ONCE');
    assert.equal(page.resolution, '240');
  });

  it('8 · the SUMMARY projection carries the resolution of ITS observation, with no re-read', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: IDENT, resolution: '240' };
    evalCount = 0;
    const r = await getOhlcv({ count: 1, summary: true });
    assert.equal(r.resolution, '240', 'the summary states the same cadence as the bars it projected');
    assert.equal(evalCount, 1, 'the summary is a host-side projection — it may not evaluate again');
  });

  it('9 · ⛔ an absent provider resolution stays absent through BOTH shapes', async () => {
    for (const summary of [false, true]) {
      nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: IDENT };
      const r = await getOhlcv({ count: 1, summary });
      assert.equal('resolution' in r, false, `summary=${summary}: no default may appear host-side either`);
    }
  });

  it('10 · no instrument, venue or timeframe vocabulary is hard-coded in the provider fact', () => {
    const code = RES_SRC.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*')).join('\n');
    for (const lit of ['XAUUSD', 'OANDA', 'gold', '1H', '4H', '60', '240']) {
      assert.equal(code.includes(lit), false, `the provider fact must not hard-code "${lit}"`);
    }
  });
});
