'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  mapPublishedIbkrSnapshot,
  validatePublishedIbkrSnapshot,
  enrichPortfolioWithMarketData,
} = require('../src/data-loader');

function finalize(snapshot) {
  snapshot.stateSha256 = crypto.createHash('sha256').update(JSON.stringify({
    brokerAsOf: snapshot.brokerAsOf,
    broker: snapshot.broker,
    accountRisk: snapshot.accountRisk,
    riskReport: snapshot.riskReport,
  })).digest('hex');
  return snapshot;
}

function fixture() {
  const authority = {
    mode: 'ibkr-only',
    source: 'ibkr-flex',
    asOfDate: '2026-08-18',
    manualOverridesAllowed: false,
  };
  return finalize({
    schemaVersion: 2,
    source: 'ibkr-flex',
    publisherId: 'tianhaos-mac-mini',
    brokerAsOf: '2026-08-18',
    generatedAt: '2026-08-19T05:49:01.861Z',
    stateSha256: null,
    broker: {
      source: 'ibkr-flex',
      asOfDate: '2026-08-18',
      cash: 33036.01,
      normalizationIssues: [],
      positionAuthority: authority,
      stocks: [
        { ticker: 'RKLB', shares: 100, spot: 79.16, costBasis: 83.85, source: 'ibkr-flex' },
        { ticker: 'PDD', shares: 35, spot: 87.27, costBasis: 99.19, source: 'ibkr-flex' },
      ],
      options: [
        {
          ticker: 'RKLB', optionType: 'call', strike: 100, expiry: '2026-08-28',
          multiplier: 100, quantity: -1, markPrice: 0.27, costBasisPrice: 0.74,
          source: 'ibkr-flex', side: 'short', contracts: 1,
        },
        {
          ticker: 'ORCL', optionType: 'put', strike: 150, expiry: '2026-08-21',
          multiplier: 100, quantity: -1, markPrice: 7.98, costBasisPrice: 2.19,
          source: 'ibkr-flex', side: 'short', contracts: 1,
        },
      ],
    },
    accountRisk: {
      stateSource: 'ibkr-flex',
      snapshotAsOf: '2026-08-18',
      activityAsOf: '2026-08-18',
      positionAuthority: authority,
      positionsReconciled: true,
      syncRunStatus: 'success',
      syncRunId: 48,
      syncGate: { pass: true, reasons: [] },
      netLiquidation: 40115.28,
    },
    riskReport: { t4: { status: 'block', canOpen: false } },
  });
}

const historical = {
  updatedAt: '2026-07-24',
  cash: 0,
  openPositions: [{ ticker: 'OLD', type: 'CSP' }],
  idlePositions: [{ ticker: 'OLD', shares: 100 }],
  closedTrades: [{ ticker: 'PDD', premium: 100 }],
  weeklyData: [{ week: '7/24', realized: 100 }],
};

test('broker-only snapshot replaces current positions while preserving history', () => {
  const data = mapPublishedIbkrSnapshot(fixture(), historical);

  assert.equal(data.updatedAt, '2026-08-18');
  assert.equal(data.historicalUpdatedAt, '2026-07-24');
  assert.equal(data.currentPositionSource, 'ibkr-flex');
  assert.equal(data.cash, 33036.01);
  assert.deepEqual(data.closedTrades, historical.closedTrades);
  assert.deepEqual(data.openPositions.map((position) => [position.ticker, position.type]), [
    ['RKLB', 'CC'],
    ['ORCL', 'CSP'],
  ]);
  assert.equal(data.openPositions[0].premium, 74);
  assert.equal(data.openPositions[0].unrealizedDollar, 47);
  assert.equal(data.idlePositions.find((position) => position.ticker === 'RKLB').canSellCC, false);
  assert.equal(data.idlePositions.find((position) => position.ticker === 'PDD').note, '不足 100 股');
});

test('snapshot validation fails closed on authority drift or content tampering', () => {
  const invalidAuthority = fixture();
  invalidAuthority.broker.positionAuthority.manualOverridesAllowed = true;
  finalize(invalidAuthority);
  assert.throws(
    () => validatePublishedIbkrSnapshot(invalidAuthority),
    /broker authority/
  );

  const tampered = fixture();
  tampered.broker.cash += 1;
  assert.throws(
    () => validatePublishedIbkrSnapshot(tampered),
    /stateSha256/
  );
});

test('market enrichment rejects mixed broker and market sessions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-dashboard-market-'));
  const marketPath = path.join(dir, 'market_data.json');
  fs.writeFileSync(marketPath, JSON.stringify({
    latestDate: '2026-08-19',
    prices: {},
  }));

  assert.throws(
    () => enrichPortfolioWithMarketData({ brokerAsOf: '2026-08-18' }, marketPath),
    /does not match brokerAsOf/
  );
});

test('market enrichment derives missing tickers from current broker positions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-dashboard-market-'));
  const marketPath = path.join(dir, 'market_data.json');
  fs.writeFileSync(marketPath, JSON.stringify({
    latestDate: '2026-08-18',
    prices: {
      ORCL: { close: 142, date: '2026-08-18' },
    },
    missing: [],
    stale: [],
  }));
  const data = {
    brokerAsOf: '2026-08-18',
    openPositions: [
      { ticker: 'ORCL', type: 'CSP', strike: 150 },
      { ticker: 'META', type: 'CSP', strike: 550 },
    ],
    idlePositions: [],
  };

  enrichPortfolioWithMarketData(data, marketPath);
  assert.deepEqual(data.priceMissing, ['META']);
});
