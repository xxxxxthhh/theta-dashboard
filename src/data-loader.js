'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPECTED_IBKR_PUBLISHER = 'tianhaos-mac-mini';

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

function failSnapshot(message) {
  throw new Error(`Invalid published IBKR snapshot: ${message}`);
}

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function assertFiniteNumber(value, label, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    failSnapshot(`${label} must be a finite${positive ? ' positive' : ''} number`);
  }
}

function assertTicker(value, label) {
  if (!/^[A-Z0-9.-]+$/.test(String(value || ''))) {
    failSnapshot(`${label} is missing or invalid`);
  }
}

function validatePublishedIbkrSnapshot(snapshot, options = {}) {
  const expectedPublisher = options.expectedPublisher || EXPECTED_IBKR_PUBLISHER;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    failSnapshot('root must be an object');
  }
  if (snapshot.schemaVersion !== 2) failSnapshot('schemaVersion must be 2');
  if (snapshot.source !== 'ibkr-flex') failSnapshot('source must be ibkr-flex');
  if (snapshot.publisherId !== expectedPublisher) {
    failSnapshot(`publisherId must be ${expectedPublisher}`);
  }
  if (!isYmd(snapshot.brokerAsOf)) failSnapshot('brokerAsOf must be YYYY-MM-DD');
  if (!/^[0-9a-f]{64}$/.test(String(snapshot.stateSha256 || ''))) {
    failSnapshot('stateSha256 is missing or invalid');
  }

  const broker = snapshot.broker;
  const accountRisk = snapshot.accountRisk;
  const riskReport = snapshot.riskReport;
  if (!broker || typeof broker !== 'object') failSnapshot('broker is missing');
  if (!accountRisk || typeof accountRisk !== 'object') failSnapshot('accountRisk is missing');
  if (!riskReport || typeof riskReport !== 'object') failSnapshot('riskReport is missing');

  const authority = broker.positionAuthority;
  if (broker.source !== 'ibkr-flex'
    || broker.asOfDate !== snapshot.brokerAsOf
    || authority?.mode !== 'ibkr-only'
    || authority?.source !== 'ibkr-flex'
    || authority?.asOfDate !== snapshot.brokerAsOf
    || authority?.manualOverridesAllowed !== false) {
    failSnapshot('broker authority must be broker-only and bound to brokerAsOf');
  }
  if (accountRisk.stateSource !== 'ibkr-flex'
    || accountRisk.snapshotAsOf !== snapshot.brokerAsOf
    || accountRisk.activityAsOf !== snapshot.brokerAsOf
    || accountRisk.positionAuthority?.mode !== 'ibkr-only'
    || accountRisk.positionAuthority?.source !== 'ibkr-flex'
    || accountRisk.positionAuthority?.asOfDate !== snapshot.brokerAsOf
    || accountRisk.positionAuthority?.manualOverridesAllowed !== false
    || accountRisk.positionsReconciled !== true
    || accountRisk.syncGate?.pass !== true
    || accountRisk.syncRunStatus !== 'success') {
    failSnapshot('accountRisk is not a reconciled successful broker-only sync');
  }
  if (!Number.isInteger(accountRisk.syncRunId) || accountRisk.syncRunId <= 0) {
    failSnapshot('accountRisk.syncRunId must be a positive integer');
  }
  if (!Array.isArray(broker.normalizationIssues) || broker.normalizationIssues.length !== 0) {
    failSnapshot('broker normalizationIssues must be an empty array');
  }
  if (!Array.isArray(broker.stocks) || !Array.isArray(broker.options)) {
    failSnapshot('broker stocks/options must be arrays');
  }

  assertFiniteNumber(broker.cash, 'broker.cash');
  for (const [index, stock] of broker.stocks.entries()) {
    assertTicker(stock?.ticker, `broker.stocks[${index}].ticker`);
    if (stock.source !== 'ibkr-flex') failSnapshot(`broker.stocks[${index}].source must be ibkr-flex`);
    assertFiniteNumber(stock.shares, `broker.stocks[${index}].shares`, { positive: true });
    assertFiniteNumber(stock.costBasis, `broker.stocks[${index}].costBasis`);
    assertFiniteNumber(stock.spot, `broker.stocks[${index}].spot`, { positive: true });
  }
  for (const [index, option] of broker.options.entries()) {
    assertTicker(option?.ticker, `broker.options[${index}].ticker`);
    if (option.source !== 'ibkr-flex') failSnapshot(`broker.options[${index}].source must be ibkr-flex`);
    if (option.side !== 'short' || !(option.quantity < 0)) {
      failSnapshot(`broker.options[${index}] is not a supported short option`);
    }
    if (!['call', 'put'].includes(option.optionType)) {
      failSnapshot(`broker.options[${index}].optionType is unsupported`);
    }
    if (!isYmd(option.expiry)) failSnapshot(`broker.options[${index}].expiry must be YYYY-MM-DD`);
    assertFiniteNumber(option.strike, `broker.options[${index}].strike`, { positive: true });
    assertFiniteNumber(option.multiplier, `broker.options[${index}].multiplier`, { positive: true });
    assertFiniteNumber(option.contracts, `broker.options[${index}].contracts`, { positive: true });
    assertFiniteNumber(option.costBasisPrice, `broker.options[${index}].costBasisPrice`);
    assertFiniteNumber(option.markPrice, `broker.options[${index}].markPrice`);
    if (option.multiplier !== 100 || !Number.isInteger(option.contracts)) {
      failSnapshot(`broker.options[${index}] must use whole 100-share contracts`);
    }
  }

  const identityInput = JSON.stringify({
    brokerAsOf: snapshot.brokerAsOf,
    broker,
    accountRisk,
    riskReport,
  });
  const computedSha = crypto.createHash('sha256').update(identityInput).digest('hex');
  if (computedSha !== snapshot.stateSha256) failSnapshot('stateSha256 does not match snapshot content');
  return snapshot;
}

function mapPublishedIbkrSnapshot(snapshot, historicalData, options = {}) {
  validatePublishedIbkrSnapshot(snapshot, options);
  const stockByTicker = new Map(snapshot.broker.stocks.map((stock) => [stock.ticker, stock]));
  const shortCallContracts = new Map();
  for (const option of snapshot.broker.options) {
    if (option.optionType !== 'call') continue;
    shortCallContracts.set(
      option.ticker,
      (shortCallContracts.get(option.ticker) || 0) + option.contracts
    );
  }
  for (const [ticker, contracts] of shortCallContracts) {
    const shares = stockByTicker.get(ticker)?.shares || 0;
    if (contracts * 100 > shares) {
      failSnapshot(`short calls for ${ticker} are not fully covered; dashboard cannot label them CC`);
    }
  }

  const openPositions = snapshot.broker.options.map((option) => {
    const premium = Math.abs(option.costBasisPrice) * option.multiplier * option.contracts;
    const unrealized = (Math.abs(option.costBasisPrice) - option.markPrice)
      * option.multiplier * option.contracts;
    return {
      ticker: option.ticker,
      type: option.optionType === 'call' ? 'CC' : 'CSP',
      strike: option.strike,
      expiry: option.expiry,
      premium: +premium.toFixed(2),
      contracts: option.contracts,
      markPrice: option.markPrice,
      unrealizedDollar: +unrealized.toFixed(2),
      source: 'ibkr-flex',
    };
  });

  const idlePositions = snapshot.broker.stocks.map((stock) => {
    const covered = shortCallContracts.get(stock.ticker) || 0;
    const availableLots = Math.floor(stock.shares / 100) - covered;
    let note = '';
    if (covered > 0) note = `${covered} 张 CC 占用`;
    else if (stock.shares < 100) note = '不足 100 股';
    return {
      ticker: stock.ticker,
      shares: stock.shares,
      costBasis: stock.costBasis,
      brokerSpot: stock.spot,
      canSellCC: availableLots > 0,
      note,
      source: 'ibkr-flex',
    };
  });

  return {
    ...historicalData,
    historicalUpdatedAt: historicalData.updatedAt,
    updatedAt: snapshot.brokerAsOf,
    currentPositionSource: 'ibkr-flex',
    publisherId: snapshot.publisherId,
    brokerAsOf: snapshot.brokerAsOf,
    brokerGeneratedAt: snapshot.generatedAt,
    brokerSyncRunId: snapshot.accountRisk.syncRunId,
    positionAuthority: snapshot.broker.positionAuthority,
    positionsReconciled: true,
    cash: snapshot.broker.cash,
    netLiquidation: snapshot.accountRisk.netLiquidation,
    t4: snapshot.riskReport.t4,
    openPositions,
    idlePositions,
  };
}

function loadPublishedIbkrPortfolio(snapshotPath, historicalData, options = {}) {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Missing published IBKR snapshot at ${snapshotPath}`);
  }
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  return mapPublishedIbkrSnapshot(snapshot, historicalData, options);
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

  // buffer 轨迹：用与上面完全相同的公式，对每个历史点算 bufferPct。
  // 附加字段——旧格式 market_data（无 history）静默降级，不产出 bufferHistory。
  if (Array.isArray(info.history) && info.history.length) {
    // 有 openDate 时裁剪到「持有这张之后」，持仓前的标的价不算 buffer 风险。
    const points = info.history.filter((pt) =>
      pt && typeof pt.close === 'number' && pt.close !== 0 &&
      (!position.openDate || pt.date >= position.openDate)
    );
    const bufferHistory = points.map((pt) => {
      const dollar = position.type === 'CC' ? position.strike - pt.close : pt.close - position.strike;
      return { date: pt.date, bufferPct: +(dollar / pt.close * 100).toFixed(2) };
    });
    if (bufferHistory.length) position.bufferHistory = bufferHistory;
  }
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
  if (data.brokerAsOf && marketData.latestDate !== data.brokerAsOf) {
    throw new Error(
      `market_data latestDate ${marketData.latestDate || 'missing'} does not match brokerAsOf ${data.brokerAsOf}`
    );
  }
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
  // 抓取自检：不能只信 market_data 自报的旧 ticker scope；始终针对本次 broker
  // 当前持仓重新计算 missing，避免行情文件每天更新却漏掉新实盘标的。
  const requiredTickers = new Set([
    ...(data.openPositions || []).map((position) => position.ticker),
    ...(data.idlePositions || []).map((position) => position.ticker),
  ]);
  const derivedMissing = [...requiredTickers].filter((ticker) => !prices[ticker]);
  data.priceMissing = [...new Set([
    ...(Array.isArray(marketData.missing) ? marketData.missing : []),
    ...derivedMissing,
  ])].sort();
  if (Array.isArray(marketData.stale)) data.priceStale = marketData.stale;
  // 到期预结算「截至日」透传（best-effort）：用 fetch job 写的 ET 收盘日 latestDate，而非客户端 new Date()
  // （避免 viewer 时区把到期判早/晚一天）。旧格式无此字段则忽略，template 的预结算 section 自动降级隐藏。
  if (typeof marketData.latestDate === 'string') data.priceLatestDate = marketData.latestDate;
  // 波动率体检透传（best-effort）：RV vs IV 底。旧格式无此段则忽略，dashboard 自动隐藏 section。
  if (marketData.volCheck && typeof marketData.volCheck === 'object') data.volCheck = marketData.volCheck;
  // 财报日程透传（best-effort）：TICKER -> 'YYYY-MM-DD' 下次财报日。旧格式无此段则忽略，template 自动隐藏 section。
  if (marketData.earnings && typeof marketData.earnings === 'object') data.earnings = marketData.earnings;

  return {
    marketDataAt: marketData.fetchedAt || null,
    openEnriched,
    idleEnriched,
  };
}

module.exports = {
  EXPECTED_IBKR_PUBLISHER,
  getCandidateDataDirs,
  resolveDataFile,
  validatePublishedIbkrSnapshot,
  mapPublishedIbkrSnapshot,
  loadPublishedIbkrPortfolio,
  enrichPortfolioWithMarketData,
};
