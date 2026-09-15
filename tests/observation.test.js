/**
 * Provider-retrieval observation timestamp — unit tests.
 * No TradingView connection needed: `../src/connection.js` is module-mocked, so the REAL
 * `src/core/data.js` readers run against a controlled retrieval.
 *
 * Run: node --test --experimental-test-module-mocks tests/observation.test.js
 */
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// ── the controlled retrieval ────────────────────────────────────────────────
// A VIRTUAL clock that only advances INSIDE the retrieval. This is what makes "the stamp is taken
// after the read" a measurable fact rather than a claim about source order: an implementation that
// stamped before `await evaluate(...)` would record BEFORE_MS, and every G/M2 assertion below
// would fail.
const BEFORE_MS = 1_000;
const RETRIEVAL_MS = 500;
const AFTER_MS = BEFORE_MS + RETRIEVAL_MS;        // 1_500 — the only honest answer

// A bar-OPEN coordinate, deliberately nothing like the retrieval instant.
const BAR_OPEN_MS = 1_789_491_600_000;
const BAR_OPEN_S = BAR_OPEN_MS / 1000;

let virtualNow;
let nextPayload;
let evaluateCalls;

mock.module('../src/connection.js', {
  namedExports: {
    // ⛔ PRODUCTION-SHAPED ON PURPOSE. This was 'BARS', which does not end in `.bars()`; data.js
    //    derives the main-series path from this constant and refuses a shape it cannot derive from,
    //    so the old fake could not satisfy the module's own precondition. A fixture that cannot be
    //    loaded by the code it exercises proves nothing about it.
    KNOWN_PATHS: {
      chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
      mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
    },
    async evaluate() {
      evaluateCalls += 1;
      virtualNow += RETRIEVAL_MS;                  // the read takes time
      return typeof nextPayload === 'function' ? nextPayload() : nextPayload;
    },
    async evaluateAsync() { return null; },
  },
});

const data = await import('../src/core/data.js');
const observation = await import('../src/core/observation.js');
const { OBSERVED_AT_BASIS } = observation;

// ⛔ TIME IS MOCKED AT THE AMBIENT SOURCE, NOT VIA A PRODUCTION SETTER. `observation.js`
//    deliberately exports no clock mutator — see the immutability suite at the bottom of this file.
let realDateNow;
beforeEach(() => {
  virtualNow = BEFORE_MS;
  evaluateCalls = 0;
  realDateNow = Date.now;
  Date.now = () => virtualNow;
});
afterEach(() => { Date.now = realDateNow; });

const QUOTE = Object.freeze({
  symbol: 'OANDA:XAUUSD', time: BAR_OPEN_S, open: 4295.7, high: 4299.1, low: 4290.4,
  close: 4297.5, last: 4297.5, volume: 33317, description: 'Gold', exchange: 'OANDA',
  type: 'commodity',
});
const BARS = Object.freeze({
  bars: [
    { time: BAR_OPEN_S - 14400, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: BAR_OPEN_S, open: 1.5, high: 3, low: 1, close: 2.5, volume: 20 },
  ],
  total_bars: 2, source: 'direct_bars',
});

describe('A/B — a qualifying provider read states its retrieval instant', () => {
  it('quote_get emits a finite observed_at_ms with the provider_retrieval basis', async () => {
    nextPayload = { ...QUOTE };
    const r = await data.getQuote({});
    assert.equal(r.success, true);
    assert.ok(Number.isFinite(r.observed_at_ms), 'observed_at_ms must be a finite number');
    assert.equal(r.observed_at_basis, 'provider_retrieval');
    assert.equal(r.observed_at_basis, OBSERVED_AT_BASIS, 'basis comes from the one exported token');
  });

  it('data_get_ohlcv emits the pair in BOTH the full and summary shapes', async () => {
    nextPayload = () => structuredClone(BARS);
    const full = await data.getOhlcv({ count: 2 });
    assert.ok(Number.isFinite(full.observed_at_ms));
    assert.equal(full.observed_at_basis, 'provider_retrieval');
    const summary = await data.getOhlcv({ count: 2, summary: true });
    assert.ok(Number.isFinite(summary.observed_at_ms), 'the summary shape must carry it too');
    assert.equal(summary.observed_at_basis, 'provider_retrieval');
  });

  it('data_get_study_values emits the pair', async () => {
    nextPayload = [{ name: 'Average True Range', values: { ATR: '36.187' } }];
    const r = await data.getStudyValues();
    assert.ok(Number.isFinite(r.observed_at_ms));
    assert.equal(r.observed_at_basis, 'provider_retrieval');
  });
});

describe('C/G — the instant is the RETRIEVAL, never the bar and never the request', () => {
  it('quote_get: observed_at_ms is the post-retrieval instant, not the bar-open time', async () => {
    nextPayload = { ...QUOTE };
    const r = await data.getQuote({});
    // ⛔ THE KILL SHOT FOR `observed_at_ms = payload.time`.
    assert.equal(r.observed_at_ms, AFTER_MS);
    assert.notEqual(r.observed_at_ms, BAR_OPEN_MS);
    assert.notEqual(r.observed_at_ms, BAR_OPEN_S);
    // ...and the bar coordinate is still reported, untouched, under its own name.
    assert.equal(r.time, BAR_OPEN_S, 'the bar-open coordinate keeps its own field and value');
  });

  it('quote_get: the stamp is taken AFTER the read resolves, not before it is issued', async () => {
    nextPayload = { ...QUOTE };
    const r = await data.getQuote({});
    assert.equal(evaluateCalls, 1);
    assert.equal(r.observed_at_ms, AFTER_MS, 'must be post-retrieval');
    assert.notEqual(r.observed_at_ms, BEFORE_MS, 'a pre-request stamp is a lie about when it was read');
  });

  it('data_get_ohlcv: bar times and the observation instant stay independent', async () => {
    nextPayload = () => structuredClone(BARS);
    const r = await data.getOhlcv({ count: 2 });
    assert.equal(r.observed_at_ms, AFTER_MS);
    for (const b of r.bars) assert.notEqual(r.observed_at_ms, b.time);
  });
});

describe('D/M4 — a clock does not create validity', () => {
  it('a retrieval that produced nothing throws and emits no observation metadata', async () => {
    nextPayload = null;
    await assert.rejects(() => data.getQuote({}), /Could not retrieve quote/);
  });

  it('an empty OHLCV retrieval throws rather than returning a stamped empty result', async () => {
    nextPayload = { bars: [], total_bars: 0, source: 'direct_bars' };
    await assert.rejects(() => data.getOhlcv({ count: 2 }), /Could not extract OHLCV data/);
  });

  it('a quote with no price is refused even though the clock ran', async () => {
    nextPayload = { symbol: 'OANDA:XAUUSD', time: BAR_OPEN_S };   // no last, no close
    await assert.rejects(() => data.getQuote({}), /Could not retrieve quote/);
  });
});

describe('E/F — nothing else about the payload changes', () => {
  it('every pre-existing quote field survives byte-identically', async () => {
    nextPayload = { ...QUOTE };
    const r = await data.getQuote({});
    for (const [k, v] of Object.entries(QUOTE)) assert.deepEqual(r[k], v, `field ${k} changed`);
    const added = Object.keys(r).filter((k) => !(k in QUOTE) && k !== 'success');
    assert.deepEqual(added.sort(), ['observed_at_basis', 'observed_at_ms'],
      'exactly two fields are added and nothing else');
  });

  it('symbol/instrument output behaviour is unchanged — including the caller echo', async () => {
    // The provider still echoes a caller-named symbol. That is the CONSUMER's problem to refuse,
    // and this change must not silently alter it — a fix hiding inside a timestamp PR would be
    // unreviewable.
    nextPayload = { ...QUOTE, symbol: 'BTCUSD' };
    const r = await data.getQuote({ symbol: 'BTCUSD' });
    assert.equal(r.symbol, 'BTCUSD');
    assert.equal(r.exchange, 'OANDA');
    assert.equal(r.description, 'Gold');
  });
});

describe('H — only the intended reads are stamped', () => {
  it('a non-observation reader gains no evidence semantics', async () => {
    nextPayload = { name: 'RSI', inputs: {}, visible: true };
    const r = await data.getIndicator({ entity_id: 'abc' });
    assert.equal('observed_at_ms' in r, false, 'getIndicator must not be stamped');
    assert.equal('observed_at_basis' in r, false);
  });

  it('getDepth is not stamped even on its SUCCESS path', async () => {
    // ★ The success path matters, not the throw path — a reader that never returns proves nothing
    //   about whether it would have been stamped. (Caught by this test failing on my first
    //   fixture, which drove getDepth down its `!found` throw instead.)
    nextPayload = { found: true, bids: [{ price: 1, size: 2 }], asks: [{ price: 2, size: 3 }], spread: 1 };
    const r = await data.getDepth();
    assert.equal(r.success, true, 'the success path really was taken');
    assert.equal('observed_at_ms' in r, false);
    assert.equal('observed_at_basis' in r, false);
  });
});

describe('M3 — the basis is a literal, and half a pair is not a pair', () => {
  it('the exported basis token is exactly the string the consumer validates', () => {
    assert.equal(OBSERVED_AT_BASIS, 'provider_retrieval');
  });

  it('withObservation refuses a non-finite instant rather than emitting a damaged pair', async () => {
    const { withObservation } = await import('../src/core/observation.js');
    assert.throws(() => withObservation({ success: true }, undefined), TypeError);
    assert.throws(() => withObservation({ success: true }, NaN), TypeError);
    assert.throws(() => withObservation({ success: true }, '1500'), TypeError);
  });
});

describe('immutability — the observation clock must stay non-replaceable', () => {
  const SRC = readFileSync(fileURLToPath(new URL('../src/core/observation.js', import.meta.url)), 'utf8');
  // Comments explain WHY there is no setter, so the structural checks read CODE, not prose.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('exports no mutable binding', () => {
    assert.equal(/export\s+(let|var)\b/.test(CODE), false,
      'an exported let/var is reassignable inside the module and invites a setter');
  });

  it('exports no setter/mutator at all', () => {
    // ⛔ ANCHORED AT THE START OF THE NAME. My first version made the verb prefix OPTIONAL, so it
    //    flagged `observationClock` — the READER — and would have passed only by deleting the
    //    thing it exists to protect. The property is "no export whose name is an act of
    //    replacement", so the verb has to be the first thing in the name.
    const exported = [...CODE.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
    const mutators = exported.filter((n) => /^(set|reset|override|replace|inject|swap|stub|mock)[A-Z_]/.test(n));
    assert.deepEqual(mutators, [], `no export may replace the clock; found: ${mutators.join(', ')}`);
  });

  it('the module surface is exactly the three intended exports', () => {
    assert.deepEqual(Object.keys(observation).sort(),
      ['OBSERVED_AT_BASIS', 'observationClock', 'withObservation']);
  });

  it('observationClock reads the ambient clock and cannot be swapped by an importer', () => {
    assert.equal(typeof observation.observationClock, 'function');
    const real = Date.now; Date.now = () => 424242;
    try { assert.equal(observation.observationClock(), 424242, 'it must read Date.now, not a captured copy'); }
    finally { Date.now = real; }
    assert.throws(() => { observation.observationClock = () => 0; }, TypeError,
      'an ESM namespace binding must be read-only');
  });
});
