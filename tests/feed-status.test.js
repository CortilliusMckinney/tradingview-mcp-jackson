/**
 * Feed-status provenance (Blocker E1).
 *
 * Two layers, deliberately separated:
 *   1. FEED_STATUS_FN — the exact source string injected into the page. Evaluated here against fake
 *      series/performance objects, so the mapping and the version gate are tested as the bytes
 *      production ships, not as a Node re-implementation of them.
 *   2. The wiring in data.js — that the fact reaches both OHLCV shapes, never reaches the tools it
 *      must not, and cannot be influenced by a caller argument.
 *
 * Run: node --test --experimental-test-module-mocks tests/feed-status.test.js
 */
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SERIES_STATUS_TEXT, MAPPING_SOURCE_IDENTITIES, FEED_STATUS_FN } from '../src/core/feed-status.js';

// ── layer 1: the injected page function, evaluated verbatim ─────────────────
const pageFn = eval(FEED_STATUS_FN);                       // eslint-disable-line no-eval
const GOOD = MAPPING_SOURCE_IDENTITIES[0];
const series = (status) => ({ status: () => status });
const withResources = (urls, fn) => {
  const real = globalThis.performance;
  globalThis.performance = { getEntriesByType: () => urls.map((name) => ({ name })) };
  try { return fn(); } finally { globalThis.performance = real; }
};
const ask = (status, urls = [GOOD]) => withResources(urls, () => pageFn(series(status), MAPPING_SOURCE_IDENTITIES));

describe('A-D · TradingView source-defined semantics', () => {
  it('A · Ready(3) is realtime — TradingView translates it, we do not label it', () => {
    assert.deepEqual(ask(3), { feed_status: 'realtime' });
  });
  it('B · Delayed(8) is delayed', () => assert.deepEqual(ask(8), { feed_status: 'delayed' }));
  it('C · DelayedSteaming(9) is delayed_streaming', () => {
    assert.deepEqual(ask(9), { feed_status: 'delayed_streaming' });
  });
  it('D · the rest of the recovered vocabulary maps exactly', () => {
    const expected = {
      0: 'connecting', 1: 'loading', 2: 'loading', 4: 'invalid', 5: 'snapshot',
      6: 'endofday', 7: 'endofday', 10: 'forbidden', 11: 'replay', 12: 'error',
      13: 'calculation_error', 14: 'unsupported_resolution',
    };
    for (const [ord, text] of Object.entries(expected)) {
      assert.deepEqual(ask(Number(ord)), { feed_status: text }, `ordinal ${ord}`);
    }
  });
  it('D2 · no delayed ordinal is ever reported as realtime', () => {
    for (const ord of [5, 6, 7, 8, 9]) {
      assert.notEqual(ask(ord).feed_status, 'realtime', `ordinal ${ord} must not read realtime`);
    }
  });
});

describe('E-G · absence beats a guess', () => {
  it('E · an unmapped ordinal emits NOTHING', () => {
    for (const ord of [15, 99, -1]) assert.deepEqual(ask(ord), {}, `ordinal ${ord}`);
  });
  it('F · a known ordinal under an UNRECOGNISED build emits NOTHING', () => {
    // ⛔ THE VERSION GATE. Same status 3 that yields realtime above.
    assert.deepEqual(ask(3, ['https://static.tradingview.com/static/bundles/12354.DIFFERENTHASH.js']), {});
    assert.deepEqual(ask(3, []), {});
  });
  it('F2 · the gate is EXACT — no prefix, substring or chunk-number match', () => {
    for (const near of [
      'https://static.tradingview.com/static/bundles/12354.js',
      'https://static.tradingview.com/static/bundles/12354.9131e8ea353621b427de.js.map',
      'http://static.tradingview.com/static/bundles/12354.9131e8ea353621b427de.js',
      GOOD.slice(0, -3),
    ]) assert.deepEqual(ask(3, [near]), {}, near);
    assert.deepEqual(ask(3, ['https://unrelated.example/x.js', GOOD]), { feed_status: 'realtime' },
      'but the exact URL among others still counts');
  });
  it('G · malformed or missing status emits NOTHING', () => {
    for (const bad of ['3', null, undefined, NaN, {}, []]) {
      assert.deepEqual(withResources([GOOD], () => pageFn(series(bad), MAPPING_SOURCE_IDENTITIES)), {}, String(bad));
    }
    assert.deepEqual(withResources([GOOD], () => pageFn({}, MAPPING_SOURCE_IDENTITIES)), {}, 'no status() at all');
  });
  it('G2 · NaN is not silently mapped', () => assert.deepEqual(ask(NaN), {}));
});

// ── layer 2: the wiring ─────────────────────────────────────────────────────
let nextPayload; let lastInput;
mock.module('../src/connection.js', {
  namedExports: {
    KNOWN_PATHS: { chartApi: 'API', mainSeriesBars: 'BARS' },
    async evaluate(expr) { lastInput = expr; return typeof nextPayload === 'function' ? nextPayload() : nextPayload; },
    async evaluateAsync() { return null; },
  },
});
const data = await import('../src/core/data.js');
let realNow; beforeEach(() => { realNow = Date.now; Date.now = () => 1_700_000_000_000; });
afterEach(() => { Date.now = realNow; });

const QUOTE = { symbol: 'OANDA:XAUUSD', exchange: 'OANDA', time: 1_789_491_600, last: 4296.3, close: 4296.3, feed_status: 'realtime' };
const BARS = { bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 }], total_bars: 1, source: 'direct_bars', feed_status: 'realtime' };

describe('H-M · wiring', () => {
  it('H · the status is read in the SAME evaluate as the values', () => {
    // The injected expression must contain both the bar read and the feed-status call.
    nextPayload = { ...QUOTE };
    return data.getQuote({}).then(() => {
      assert.match(lastInput, /BARS/, 'the values come from the bar series');
      assert.match(lastInput, /performance\.getEntriesByType/, 'and the gate runs in the same expression');
      assert.match(lastInput, /mainSeries\(\)/);
      assert.equal((lastInput.match(/mainSeries\(\)/g) || []).length >= 1, true);
    });
  });
  it('I · a caller symbol argument cannot alter feed_status', async () => {
    nextPayload = { ...QUOTE, symbol: 'BTCUSD' };
    const r = await data.getQuote({ symbol: 'BTCUSD' });
    assert.equal(r.feed_status, 'realtime', 'still the series fact');
    assert.equal(r.symbol, 'BTCUSD', 'and the pre-existing echo behaviour is untouched');
    assert.equal(lastInput.includes("var sym = 'BTCUSD'"), true);
  });

  it('I2 · the value is the PAGE\'s, provably — a caller argument cannot override it', async () => {
    // ⛔ THE HOLE THIS CLOSES. The test above passes even if Node derived 'realtime' from the
    //    caller argument, because the page happened to say 'realtime' too. A mutant doing exactly
    //    that survived the battery. Here the page says DELAYED while a caller symbol is present:
    //    anything keyed on the argument would answer 'realtime' and fail.
    nextPayload = { ...QUOTE, symbol: 'BTCUSD', feed_status: 'delayed' };
    const r = await data.getQuote({ symbol: 'BTCUSD' });
    assert.equal(r.feed_status, 'delayed', 'the page is the only source');
  });

  it('I3 · with a caller symbol and a silent page, nothing is manufactured', async () => {
    const q = { ...QUOTE, symbol: 'BTCUSD' }; delete q.feed_status;
    nextPayload = q;
    assert.equal('feed_status' in (await data.getQuote({ symbol: 'BTCUSD' })), false);
  });
  it('H2 · the OHLCV values expression carries the gate itself, not a second read', async () => {
    // ⛔ THE HOLE THIS CLOSES. Mocking `evaluate` means the injected page code never executes, so a
    //    mutation INSIDE it is invisible to any result assertion — a mutant that computed the status
    //    in a second, discarded call survived the whole battery. The only place that mutation is
    //    observable is the bytes we send, which is what this inspects.
    nextPayload = () => structuredClone(BARS);
    await data.getOhlcv({ count: 1 });
    // FEED_STATUS_FN already opens with '(', so the emitted text is `var __fs = ((function …`.
    assert.match(lastInput, /var __fs = \(+function/, 'the status must be assigned FROM the gate');
    assert.equal(/__fs\s*=\s*\{\s*\}/.test(lastInput), false, 'never stubbed out');
    assert.match(lastInput, /Object\.assign\(\{bars:[\s\S]*?__fs\)/, 'and merged into the values result');
    assert.equal((lastInput.match(/performance\.getEntriesByType/g) || []).length, 1,
      'exactly one gate, in the same expression as the values');
  });

  it('I4 · nothing in the injected bytes ASSIGNS feed_status — it can only come from the gate', async () => {
    // The gate returns an object literal (`feed_status:`), so any `feed_status =` in the expression
    // is host-side manufacture. Kills a mutant deriving it from the caller's symbol argument.
    for (const run of [
      async () => { nextPayload = { ...QUOTE }; await data.getQuote({ symbol: 'BTCUSD' }); },
      async () => { nextPayload = () => structuredClone(BARS); await data.getOhlcv({ count: 1 }); },
    ]) {
      await run();
      assert.equal(/feed_status\s*=/.test(lastInput), false,
        `feed_status must never be assigned in the injected expression: ${lastInput.slice(0, 80)}`);
    }
  });

  it('J · both OHLCV shapes retain it', async () => {
    nextPayload = () => structuredClone(BARS);
    assert.equal((await data.getOhlcv({ count: 1 })).feed_status, 'realtime');
    assert.equal((await data.getOhlcv({ count: 1, summary: true })).feed_status, 'realtime');
  });
  it('J2 · when the page says nothing, neither shape invents it', async () => {
    nextPayload = () => { const b = structuredClone(BARS); delete b.feed_status; return b; };
    assert.equal('feed_status' in (await data.getOhlcv({ count: 1 })), false);
    assert.equal('feed_status' in (await data.getOhlcv({ count: 1, summary: true })), false);
    nextPayload = (() => { const q = { ...QUOTE }; delete q.feed_status; return q; });
    assert.equal('feed_status' in (await data.getQuote({})), false);
  });
  it('K · non-target tools do not gain it', async () => {
    nextPayload = [{ name: 'ATR', values: { ATR: '1' } }];
    const sv = await data.getStudyValues();
    assert.equal('feed_status' in sv, false, 'getStudyValues is out of scope for E1');
    assert.equal(/performance\.getEntriesByType/.test(lastInput), false, 'and its expression carries no gate');
    nextPayload = { name: 'RSI', inputs: {}, visible: true };
    assert.equal('feed_status' in (await data.getIndicator({ entity_id: 'x' })), false);
  });
  it('L · the existing contract is untouched', async () => {
    nextPayload = { ...QUOTE };
    const r = await data.getQuote({});
    assert.equal(r.time, 1_789_491_600, 'bar time unchanged');
    assert.equal(r.observed_at_ms, 1_700_000_000_000, 'observation time unchanged');
    assert.equal(r.observed_at_basis, 'provider_retrieval');
    assert.equal(r.symbol, 'OANDA:XAUUSD');
    nextPayload = () => structuredClone(BARS);
    assert.equal((await data.getOhlcv({ count: 1 })).source, 'direct_bars', 'source is a separate fact');
  });
  it('M · a failed retrieval is not rescued by a readable status', async () => {
    nextPayload = { feed_status: 'realtime' };                       // no price at all
    await assert.rejects(() => data.getQuote({}), /Could not retrieve quote/);
    nextPayload = { bars: [], total_bars: 0, source: 'direct_bars', feed_status: 'realtime' };
    await assert.rejects(() => data.getOhlcv({ count: 1 }), /Could not extract OHLCV data/);
  });
});

describe('the mapping table itself', () => {
  it('contains no invented vocabulary — "live" is a consumer word, not a provider one', () => {
    const vals = new Set(Object.values(SERIES_STATUS_TEXT));
    assert.equal(vals.has('live'), false);
    assert.equal(vals.has('realtime'), true);
  });
  it('the allowlist is exact full URLs, not patterns', () => {
    for (const u of MAPPING_SOURCE_IDENTITIES) {
      assert.match(u, /^https:\/\/static\.tradingview\.com\/static\/bundles\/.+\.js$/);
      assert.equal(/[*?]/.test(u), false, 'no wildcards');
    }
  });
});
