'use strict';
const fs = require('fs');
const path = require('path');

function getCandidateDataDirs(rootDir) {
  const dirs = [];
  if (process.env.THETA_DATA_DIR) dirs.push(path.resolve(rootDir, process.env.THETA_DATA_DIR));
  dirs.push(rootDir);
  dirs.push(path.resolve(rootDir, '..', 'theta-data'));

  return [...new Set(dirs)];
}

function resolveDataFile(rootDir, name, required) {
  for (const dir of getCandidateDataDirs(rootDir)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (!required) return null;

  throw new Error(
    `${name} not found. Checked: ${getCandidateDataDirs(rootDir).join(', ')}. ` +
    'Set THETA_DATA_DIR if the theta-data checkout is elsewhere.'
  );
}

function enrichOpenPositionWithMarketData(position, info) {
  position.lastPrice = info.close;
  position.priceDate = info.date;

  if (position.type === 'CC') {
    position.bufferDollar = +(position.strike - info.close).toFixed(2);
  } else if (position.type === 'CSP') {
    position.bufferDollar = +(info.close - position.strike).toFixed(2);
  }

  position.bufferPct = +(position.bufferDollar / info.close * 100).toFixed(2);
}

function enrichIdlePositionWithMarketData(position, info) {
  position.lastPrice = info.close;
  position.priceDate = info.date;
  position.costValue = +(position.shares * position.costBasis).toFixed(2);
  position.marketValue = +(position.shares * info.close).toFixed(2);
  position.unrealizedDollar = +(position.marketValue - position.costValue).toFixed(2);
  position.unrealizedPct = position.costValue === 0
    ? 0
    : +((position.unrealizedDollar / position.costValue) * 100).toFixed(2);
}

function enrichPortfolioWithMarketData(data, marketPath) {
  const marketData = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
  const prices = marketData.prices || {};

  let openEnriched = 0;
  for (const position of data.openPositions || []) {
    const info = prices[position.ticker];
    if (!info || typeof info.close !== 'number') continue;
    enrichOpenPositionWithMarketData(position, info);
    openEnriched++;
  }

  let idleEnriched = 0;
  for (const position of data.idlePositions || []) {
    const info = prices[position.ticker];
    if (!info || typeof info.close !== 'number') continue;
    enrichIdlePositionWithMarketData(position, info);
    idleEnriched++;
  }

  if (marketData.fetchedAt) data.marketDataAt = marketData.fetchedAt;

  return {
    marketDataAt: marketData.fetchedAt || null,
    openEnriched,
    idleEnriched,
  };
}

module.exports = {
  getCandidateDataDirs,
  resolveDataFile,
  enrichPortfolioWithMarketData,
};