// chart-identity.test.js — CAN THE CALLER FORGE THE IDENTITY? Executed, not assumed.
//
// ═══ THE TWO CLAIMS UNDER TEST ═══
//
//   1. Every market-evidence producer states WHICH CHART it read, observed from the chart API.
//   2. The caller cannot reach that observation — not by echo, not by fallback, and not by
//      executing JavaScript ahead of it.
//
// ⛔⛔ CLAIM 2 IS WHY THIS FILE EXECUTES THE REAL EMITTED SOURCE. Mocking `evaluate` means the
//     injected page code never runs, so an injection hole would be invisible to every test that
//     only inspects the returned payload. The attacks below run through `node:vm` against the
//     exact bytes `quotePageExpression()` produces, and each is FIRST PROVEN TO WORK against a
//     faithful reproduction of the pre-fix expression — a security test that cannot fail is not a
//     security test.
//
// ⛔ HOSTILE CHARACTERS ARE BUILT FROM CODE POINTS, never typed. A source file carrying a raw NUL
//    or line separator is itself the hazard, and tooling in the editing path silently mangles
//    them — which happened while writing this file.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

import { ACTIVE_CHART_IDENTITY_FN, jsStringLiteral, OBSERVED_FROM_ACTIVE_CHART } from '../src/core/chart-identity.js';
import { MAPPING_SOURCE_IDENTITIES } from '../src/core/feed-status.js';

const IDENTITY_SRC = readFileSync(new URL('../src/core/chart-identity.js', import.meta.url), 'utf8');
const DATA_SRC = readFileSync(new URL('../src/core/data.js', import.meta.url), 'utf8');
const GOOD_BUNDLE = MAPPING_SOURCE_IDENTITIES[0];

const CH = {
  NUL: String.fromCharCode(0), TAB: String.fromCharCode(9), LF: String.fromCharCode(10),
  CR: String.fromCharCode(13), QUOTE: String.fromCharCode(39), BACKSLASH: String.fromCharCode(92),
  LS: String.fromCharCode(0x2028), PS: String.fromCharCode(0x2029),
};

const identityFn = eval(ACTIVE_CHART_IDENTITY_FN);          // eslint-disable-line no-eval
const GOLD_EXT = { symbol: 'XAUUSD', full_name: 'OANDA:XAUUSD', exchange: 'OANDA', type: 'forex' };
const GOLD_IDENTITY = { ...GOLD_EXT, observed_from: 'active_chart' };
const goldApi = () => ({ symbolExt: () => ({ ...GOLD_EXT }), symbol: () => 'XAUUSD' });

const BARS = [[1700000000, 4000, 4010, 3990, 4005, 12]];
function makeChartApi(overrides = {}) {
  const series = {
    bars: () => ({ lastIndex: () => 0, firstIndex: () => 0, size: () => 1, valueAt: (i) => BARS[i] }),
    status: () => 3,
  };
  return {
    symbolExt: () => ({ ...GOLD_EXT }),
    symbol: () => 'XAUUSD',
    _chartWidget: { model: () => ({ mainSeries: () => series }) },
    ...overrides,
  };
}
/**
 * ⛔ A vm-RETURNED OBJECT IS NOT deepStrictEqual TO AN IDENTICAL HOST OBJECT. It carries the
 *    SANDBOX realm's Object.prototype, so strict deep equality refuses it while printing two
 *    identical-looking objects. Re-home it before comparing — the values are what is under test,
 *    not which realm minted the wrapper.
 */
const hostRealm = (o) => (o === null || typeof o !== 'object' ? o : { ...o });

function runPageSource(source, chartApi) {
  const sandbox = {
    document: { querySelector: () => null },
    performance: { getEntriesByType: () => [{ name: GOOD_BUNDLE }] },
  };
  sandbox.window = { TradingViewApi: { _activeChartWidgetWV: { value: () => chartApi } } };
  vm.createContext(sandbox);
  return { result: vm.runInContext(source, sandbox, { timeout: 2000 }), sandbox };
}

/** A faithful reproduction of the PRE-FIX expression: the caller bytes spliced in raw. */
function legacyQuoteExpression(build, symbol) {
  const safe = build('');
  const emptyLiteral = 'var sym = "";';
  assert.ok(safe.includes(emptyLiteral), 'the current expression must serialize the symbol');
  return safe.replace(emptyLiteral, 'var sym = ' + CH.QUOTE + symbol + CH.QUOTE + ';');
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
const { getOhlcv, getQuote, getStudyValues, quotePageExpression } = await import('../src/core/data.js');
const providerBars = () => [{ time: 1700000000, open: 4000, high: 4010, low: 3990, close: 4005, volume: 12 }];
const IDENT = { ...GOLD_IDENTITY };

describe('Provider-bound instrument identity', () => {
  it('1 · Gold chart, no request symbol -> Gold identity', () => {
    assert.deepEqual(identityFn(goldApi()), GOLD_IDENTITY);
  });

  it('2 · ⛔⛔ Gold chart, request EURUSD -> echo may say EURUSD, IDENTITY stays Gold', () => {
    // ★ THE ORIGINAL DEFECT. quote_get({symbol:"EURUSD"}) on a Gold chart returned EURUSD beside
    //   GOLD price, and nothing in the payload revealed the disagreement.
    const { result } = runPageSource(quotePageExpression('EURUSD'), makeChartApi());
    assert.equal(result.symbol, 'EURUSD', 'the legacy echo keeps the caller bytes');
    assert.deepEqual(hostRealm(result.active_chart), GOLD_IDENTITY, 'the observation says what the chart was');
    assert.equal(result.close, 4005, 'and the price is still the Gold chart price');
    assert.notEqual(result.symbol, result.active_chart.symbol,
      'the disagreement must be VISIBLE — that is the entire point of the field');
  });

  it('3 · OHLCV full output carries provider-bound identity', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: IDENT };
    const r = await getOhlcv({ count: 1 });
    assert.deepEqual(r.active_chart, IDENT);
    assert.equal(r.source, 'direct_bars');
  });

  it('4 · ⛔ OHLCV summary carries the EXACT identity of its observation, never a new one', async () => {
    const observed = { ...IDENT };
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: observed };
    evalCount = 0;
    const r = await getOhlcv({ count: 1, summary: true });
    assert.deepEqual(r.active_chart, observed, 'the summary states the same identity');
    // ⛔⛔ A SECOND READ WOULD BE A SECOND OBSERVATION. The summary is a host-side projection, so
    //    the ONLY way it could acquire a fresher identity is by evaluating the page again — and it
    //    would then describe a different chart than the bars it projected from. Counting evaluates
    //    is the assertion that catches that; comparing the values cannot, because a re-read on a
    //    still-Gold chart returns equal values and looks identical.
    assert.equal(evalCount, 1, 'the summary path must perform exactly ONE page evaluation');
    assert.equal(lastInput.match(/observed_from/g).length, 1,
      'and that one expression may contain exactly ONE identity read');
  });

  it('5 · study values carry provider-bound identity, and no feed status', async () => {
    nextPayload = { studies: [{ name: 'RSI', values: { RSI: '52' } }], active_chart: IDENT };
    const r = await getStudyValues();
    assert.deepEqual(r.active_chart, IDENT);
    assert.equal(r.study_count, 1);
    assert.equal('feed_status' in r, false, 'E1 did not qualify a data-mode for derived series');
  });

  it('6 · observed_from is stated, and is the only value this provider may state', () => {
    assert.equal(identityFn(goldApi()).observed_from, OBSERVED_FROM_ACTIVE_CHART);
    assert.equal(OBSERVED_FROM_ACTIVE_CHART, 'active_chart');
  });

  it('7 · ⛔ missing chart accessors produce NULL fields, never defaults', () => {
    const dead = { symbolExt: () => { throw new Error('gone'); }, symbol: () => { throw new Error('gone'); } };
    assert.deepEqual(identityFn(dead),
      { symbol: null, full_name: null, exchange: null, type: null, observed_from: 'active_chart' });
    const partial = { symbolExt: () => null, symbol: () => 'XAUUSD' };
    assert.deepEqual(identityFn(partial),
      { symbol: 'XAUUSD', full_name: null, exchange: null, type: null, observed_from: 'active_chart' });
  });

  it('7b · ⛔⛔ AN ABSENT IDENTITY STAYS NULL EVEN WHEN THE CALLER NAMED A SYMBOL', () => {
    // ★ THE HOLE A SURVIVING MUTANT REVEALED. A fallback that backfills active_chart.symbol from
    //   the caller echo whenever the chart states nothing is exactly the laundering this PR
    //   forbids — and it is INVISIBLE unless identity is absent AND a request symbol was supplied
    //   at the same time. Test 7 exercised the helper alone; only the full expression shows this.
    const blind = makeChartApi({
      symbolExt: () => { throw new Error('gone'); },
      symbol: () => { throw new Error('gone'); },
    });
    const { result } = runPageSource(quotePageExpression('EURUSD'), blind);
    assert.equal(result.symbol, 'EURUSD', 'the legacy echo still carries the caller bytes');
    assert.equal(result.active_chart.symbol, null, 'identity must stay NULL, never borrow the echo');
    assert.equal(result.active_chart.full_name, null);
    assert.equal(result.active_chart.exchange, null);
    assert.equal(result.active_chart.observed_from, 'active_chart',
      'an absent identity is still an OBSERVATION that found nothing');
  });

  it('8 · ⛔⛔ THE HELPER HAS NO CHANNEL FOR A REQUEST SYMBOL', () => {
    // ★ STRUCTURAL, because this is a property of the shape, not of one execution. A function with
    //   nowhere to put a caller value cannot launder one, now or after a later edit.
    const params = /\(function \(([^)]*)\)/.exec(ACTIVE_CHART_IDENTITY_FN)[1];
    assert.equal(params.trim(), 'api', 'the identity helper takes the chart api and nothing else');
    assert.equal(/\bsym\b|\bsymbolArg\b|\brequest/.test(ACTIVE_CHART_IDENTITY_FN), false,
      'and never mentions a request variable');
    // ⛔ CODE, NOT PROSE. The module's header reproduces the historical forgery payload, which
    //    necessarily names a venue and a symbol. What must not exist is a hard-coded instrument in
    //    the executable text, so comments are stripped before the check.
    const codeOnly = IDENTITY_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['OANDA', 'XAUUSD', 'EURUSD', 'BTCUSD']) {
      assert.equal(new RegExp('[' + CH.QUOTE + '"]' + forbidden + '[' + CH.QUOTE + '"]').test(codeOnly), false,
        'chart-identity.js must not hard-code ' + forbidden + ' in executable code');
    }
    assert.ok(codeOnly.includes('ACTIVE_CHART_IDENTITY_FN'), 'the comment strip must not have eaten the code');
    assert.equal(/active_chart\s*[:=][^;\n]*\bsym\b/.test(DATA_SRC), false,
      'active_chart must never be populated from the caller echo');
  });

  it('9 · ⛔⛔ THE CALLER SYMBOL CANNOT EXECUTE — proven against the pre-fix expression first', () => {
    const PAYLOAD = 'x' + CH.QUOTE + '; globalThis.__PWNED__ = true; var y=' + CH.QUOTE;
    const legacy = runPageSource(legacyQuoteExpression(quotePageExpression, PAYLOAD), makeChartApi());
    assert.equal(legacy.sandbox.__PWNED__, true,
      'the pre-fix expression must be demonstrably exploitable — otherwise this test is vacuous');
    const fixed = runPageSource(quotePageExpression(PAYLOAD), makeChartApi());
    assert.equal(fixed.sandbox.__PWNED__, undefined, 'no global side effect');
    assert.equal(fixed.result.symbol, PAYLOAD, 'and the echo is still byte-exact');
  });

  it('10 · ⛔⛔ THE HISTORICAL IDENTITY-FORGERY ATTACK, reproduced and refused', () => {
    const PAYLOAD = 'x' + CH.QUOTE + '; window.TradingViewApi._activeChartWidgetWV.value().symbolExt = '
      + 'function () { return { symbol: "EURUSD", full_name: "OANDA:EURUSD" }; }; var y=' + CH.QUOTE;

    const legacy = runPageSource(legacyQuoteExpression(quotePageExpression, PAYLOAD), makeChartApi());
    assert.equal(legacy.result.active_chart.full_name, 'OANDA:EURUSD',
      'the pre-fix expression must be demonstrably forgeable');
    assert.equal(legacy.result.close, 4005, 'while the bars stayed Gold — that is the whole danger');

    const api = makeChartApi();
    const fixed = runPageSource(quotePageExpression(PAYLOAD), api);
    assert.deepEqual(hostRealm(fixed.result.active_chart), GOLD_IDENTITY, 'Gold data keeps Gold identity');
    assert.equal(fixed.result.close, 4005);
    assert.equal(fixed.result.symbol, PAYLOAD, 'caller echo remains byte-exact');
    assert.equal(fixed.sandbox.__PWNED__, undefined);
    assert.equal(api.symbolExt().full_name, 'OANDA:XAUUSD', 'the chart api was not overwritten');
  });

  it('11 · ⛔ HOSTILE CHARACTER CLASSES ARE ALL INERT, and all echo byte-exact', () => {
    const cases = [
      CH.QUOTE + 'quote', '"dquote', 'back' + CH.BACKSLASH + 'slash',
      'new' + CH.LF + 'line', 'car' + CH.CR + 'riage', 'tab' + CH.TAB + 'here',
      'nul' + CH.NUL + 'byte', CH.LS + 'linesep', CH.PS + 'parasep',
      'semi;colon', '/*comment*/', '// line', '`template`', '${notInterpolated}',
      '</script>', CH.QUOTE + ');alert(1);(' + CH.QUOTE,
    ];
    for (const c of cases) {
      const { result, sandbox } = runPageSource(quotePageExpression(c), makeChartApi());
      assert.equal(result.symbol, c, 'echo must be byte-exact for ' + JSON.stringify(c));
      assert.deepEqual(hostRealm(result.active_chart), GOLD_IDENTITY, 'identity must survive ' + JSON.stringify(c));
      assert.equal(sandbox.__PWNED__, undefined);
    }
    // ⛔ THE WEAK VARIANT IS NOT ACCEPTABLE. Quote-only escaping leaves backslash and the line
    //    separators as ways out; assert the serializer is stronger than that.
    assert.equal(jsStringLiteral('a' + CH.BACKSLASH + 'b'), '"a' + CH.BACKSLASH + CH.BACKSLASH + 'b"');
    assert.ok(jsStringLiteral('a' + CH.LS + 'b').includes('u2028'), 'U+2028 must be escaped');
    assert.equal(jsStringLiteral('a' + CH.LS + 'b').includes(CH.LS), false, 'and must not survive raw');
  });

  it('12 · feed status is unchanged by this PR', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', feed_status: 'realtime', active_chart: IDENT };
    assert.equal((await getOhlcv({ count: 1 })).feed_status, 'realtime');
    assert.equal((await getOhlcv({ count: 1, summary: true })).feed_status, 'realtime');
    const { result } = runPageSource(quotePageExpression(''), makeChartApi());
    assert.equal(result.feed_status, 'realtime', 'and the quote still reads it from the same series');
  });

  it('13 · the Blocker C observation contract is unchanged', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', active_chart: IDENT };
    const r = await getOhlcv({ count: 1 });
    assert.equal(r.observed_at_basis, 'provider_retrieval');
    assert.equal(typeof r.observed_at_ms, 'number');
    // ⛔ THE PAGE MUST NOT STAMP THE TIME. Blocker C moved it host-side, after the awaited read.
    assert.equal(/observed_at_ms\s*:\s*Date\.now\(\)/.test(lastInput), false,
      'the old page-side OBSERVED_AT_FN must not be resurrected');
    assert.equal(DATA_SRC.includes('OBSERVED_AT_FN'), false);
  });

  it('14 · ⛔ ONE mainSeries OBJECT still serves bars, feed status AND identity', async () => {
    nextPayload = { bars: providerBars(), total_bars: 1, source: 'direct_bars', active_chart: IDENT };
    await getOhlcv({ count: 1 });
    const calls = lastInput.split('model().mainSeries()').length - 1;
    assert.equal(calls, 1, 'the expression must reach mainSeries() exactly once, saw ' + calls);
    assert.match(lastInput, /var series = /, 'captured into one variable');
    assert.match(lastInput, /\(series,/, 'feed status derives from that captured series');
  });
});
