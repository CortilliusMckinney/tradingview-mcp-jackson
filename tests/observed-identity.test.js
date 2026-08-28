// observed-identity.test.js — the provider must state what it OBSERVED, not what it was ASKED.
//
// ═══ WHY THIS FILE EXISTS ═══
//
// The consumer (AI-GUI #905) types market evidence from provider output. Two properties of that
// output decide whether a claim can be attributed at all:
//
//   1. WHICH INSTRUMENT the provider actually read. `getQuote` takes an optional `symbol` and copies
//      it straight into the result (core/data.js: `var sym = '<arg>'; if (!sym) sym = api.symbol();`)
//      while the price always comes from the ACTIVE chart's bar series. So a Gold chart answers
//      "EURUSD" with GOLD's price when asked to. `getOhlcv` and `getStudyValues` returned no
//      identity at all, so nothing they produced could be attributed to any instrument.
//   2. WHEN the value was observed. `time` is the OPEN of the bar the evolving last price sits in —
//      not when that price was seen.
//
// ⛔ HOW THIS IS TESTED. The interesting logic runs INSIDE the page, inside an `evaluate()` template
//    string, so importing the module and stubbing CDP would exercise none of it. The injected
//    functions therefore live in core/observation.js as exported SOURCE STRINGS, and these tests
//    `eval` those exact bytes against a fake TradingView api. What the test runs is what production
//    sends. The wiring — that data.js actually injects them, and never uses the caller's argument
//    for identity — is bound by assertions on the module source, with comments stripped so no
//    assertion can be satisfied by prose describing the line it polices.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⛔ GUARDED ON PURPOSE. At the pre-fix baseline core/observation.js does not exist, and a bare
//    import would abort the whole file with MODULE_NOT_FOUND — a RED that says only 'a file is
//    missing'. Loading it optionally lets every assertion below run against the unmodified
//    provider and report exactly WHICH observed facts it fails to state.
let ACTIVE_CHART_IDENTITY_FN = null;
let OBSERVED_AT_FN = null;
try {
  ({ ACTIVE_CHART_IDENTITY_FN, OBSERVED_AT_FN } = await import('../src/core/observation.js'));
} catch { /* absent before the fix — that IS the finding */ }

const requireFn = (fn, what) => {
  assert.ok(typeof fn === 'string' && fn.length > 0,
    `the provider states no ${what}: core/observation.js does not export it`);
  return fn;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_SRC = readFileSync(path.join(ROOT, 'src/core/data.js'), 'utf8');
const CODE = DATA_SRC.split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const identityOf = (api) => eval(requireFn(ACTIVE_CHART_IDENTITY_FN, 'active-chart identity'))(api);  // eslint-disable-line no-eval
const observation = () => eval(requireFn(OBSERVED_AT_FN, 'observation time'))();                      // eslint-disable-line no-eval

/** A TradingView chart api showing Gold. The caller's argument is deliberately NOT a parameter. */
const goldChart = () => ({
  symbolExt: () => ({
    symbol: 'XAUUSD', full_name: 'OANDA:XAUUSD', exchange: 'OANDA',
    type: 'forex', description: 'Gold Spot / U.S. Dollar',
  }),
  symbol: () => 'OANDA:XAUUSD',
});

describe('active-chart identity comes from the chart', () => {
  test('★★★ a Gold chart yields Gold identity, with venue', () => {
    const id = identityOf(goldChart());
    assert.equal(id.symbol, 'XAUUSD');
    assert.equal(id.full_name, 'OANDA:XAUUSD');
    assert.equal(id.exchange, 'OANDA');
    assert.equal(id.observed_from, 'active_chart');
  });

  test('⛔ the identity function CANNOT read a caller argument — it takes only the api', () => {
    // Structural, not incidental: there is no parameter through which a request could arrive.
    const fn = eval(requireFn(ACTIVE_CHART_IDENTITY_FN, 'active-chart identity'));  // eslint-disable-line no-eval
    assert.equal(fn.length, 1, 'exactly one parameter: the chart api');
    assert.ok(!/symbol\s*\|\|\s*''/.test(ACTIVE_CHART_IDENTITY_FN), 'no caller-argument interpolation');
    assert.ok(!ACTIVE_CHART_IDENTITY_FN.includes('${'), 'nothing is interpolated into it at all');
  });

  test('⛔ a chart that cannot state its identity yields NULLS, never a guess', () => {
    const blind = { symbolExt: () => { throw new Error('no ext'); }, symbol: () => { throw new Error('no sym'); } };
    const id = identityOf(blind);
    assert.equal(id.symbol, null);
    assert.equal(id.full_name, null);
    assert.equal(id.exchange, null);
  });

  test('a partial chart degrades to what it does know', () => {
    const partial = { symbolExt: () => { throw new Error('x'); }, symbol: () => 'OANDA:XAUUSD' };
    const id = identityOf(partial);
    assert.equal(id.symbol, 'OANDA:XAUUSD');
    assert.equal(id.full_name, null, 'no full_name is stated, so none is invented');
  });
});

describe('observation time is distinct from bar-open time', () => {
  test('★★★ observed_at is a retrieval time and SAYS so', () => {
    const before = Date.now();
    const o = observation();
    const after = Date.now();
    assert.equal(typeof o.observed_at_ms, 'number');
    assert.ok(o.observed_at_ms >= before && o.observed_at_ms <= after, 'taken at read time');
    assert.equal(o.observed_at_basis, 'provider_retrieval');
  });

  test('⛔ it is NOT labelled a market or provider-event time', () => {
    // The honest limit: TradingView exposes no update timestamp for the evolving last price, so
    // calling this a market observation would claim precision the provider does not supply.
    const basis = String(observation().observed_at_basis);
    assert.ok(!/market|exchange|event/i.test(basis),
      `'${basis}' must not imply a market-event time the provider cannot supply`);
    assert.match(basis, /retriev/i, 'it must say what it actually is');
  });
});

describe('the wiring — data.js actually emits these, from the api and not the argument', () => {
  test('★★★ all three read tools inject the identity function', () => {
    const injections = CODE.match(/\(\$\{ACTIVE_CHART_IDENTITY_FN\}\)\(api\)/g) ?? [];
    assert.equal(injections.length, 3, 'quote, ohlcv and study must each emit observed identity');
  });

  test('★★★ the identity is always applied to `api`, never to the caller symbol', () => {
    assert.ok(!/ACTIVE_CHART_IDENTITY_FN\}\)\(\s*sym/.test(CODE), 'never applied to the caller symbol');
    assert.ok(!/ACTIVE_CHART_IDENTITY_FN\}\)\(\s*symbol/.test(CODE), 'never applied to the argument');
  });

  test('★★★ quote emits observed_at and declares its `time` as bar-open', () => {
    // ★ FOUND BY MUTATION. Matching only `quote.observed_at_ms =` let two mutants live:
    //   assigning `quote.time` (the bar open) to it, and assigning `undefined`. An assertion that
    //   a field is WRITTEN says nothing about what is written into it.
    assert.match(CODE, /quote\.observed_at_ms\s*=\s*obs\.observed_at_ms\s*;/,
      'observed_at_ms must come from the observation function');
    assert.match(CODE, /quote\.observed_at_basis\s*=\s*obs\.observed_at_basis\s*;/,
      'and the basis must come from the same call, so the two cannot disagree');
    assert.ok(!/observed_at_ms\s*=\s*quote\.time/.test(CODE),
      'the bar-open time must never be assigned as the observation time');
    assert.ok(!/observed_at_(ms|basis)\s*=\s*(undefined|null)\s*;/.test(CODE),
      'and it must not be silently emptied');
    assert.match(CODE, /quote\.time_basis\s*=\s*'bar_open'/);
    assert.match(CODE, /quote\.time\s*=\s*last\[0\]/, 'and `time` still means the bar open — unchanged');
  });

  test('★★★ ohlcv declares which shape it returned', () => {
    assert.match(CODE, /shape:\s*'series'/, 'the full bar form');
    assert.match(CODE, /shape:\s*'summary'/, 'and the summary projection');
  });

  test('⛔ the summary CARRIES the series identity — it does not compute a new one', () => {
    // ★ FOUND BY MUTATION. One `assert.match` passed while the SUMMARY branch was mutated,
    //   because the identical string still appeared in the full-series return below it. Both
    //   shapes are projections of a single observation, so BOTH must carry it.
    const carried = CODE.match(/active_chart:\s*data\.active_chart/g) ?? [];
    assert.equal(carried.length, 2,
      'summary AND series must each carry the observed identity rather than recompute one');
    assert.ok(!/active_chart:\s*\{\s*symbol:\s*'/.test(CODE),
      'no literal identity may be constructed anywhere in the result path');
  });

  test('⛔ no fabricated bars: the summary never invents a series', () => {
    assert.ok(!/bars:\s*\[\s*\]/.test(CODE), 'no empty-series placeholder');
    assert.ok(!/last_5_bars.*=.*bars\.slice\(-5\).*shape:\s*'series'/s.test(CODE),
      'the truncated projection is never labelled a full series');
  });

  test('★★★ study returns identity alongside its readings', () => {
    assert.match(CODE, /active_chart:\s*data\?\.active_chart/);
    assert.match(CODE, /studies:\s*data\?\.studies\s*\|\|\s*\[\]/);
  });

  test('⛔ the caller argument still only reaches the legacy `symbol` field', () => {
    // It is not removed — that would break callers — but it must not be the identity anyone types.
    // ⛔ UPDATED WITH THE INJECTION FIX. This used to assert the RAW interpolation was present —
    //    `var sym = '${symbol}'` — which is exactly the vulnerability. The caller value still
    //    reaches the legacy field, but now as a SERIALIZED literal that cannot execute.
    assert.match(CODE, /var sym = \$\{jsStringLiteral\(symbol\)\}/, 'the legacy echo is still there…');
    assert.match(CODE, /var quote = \{ symbol: sym \}/, '…and still populates `symbol`');
    assert.ok(!/active_chart[^\n]*sym\b/.test(CODE), 'but never the observed identity');
  });
});
