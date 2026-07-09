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
  // 抓取自检透传（best-effort）：字段不存在（旧格式）则忽略，供告警条区分抓取失败/滞后。
  if (Array.isArray(marketData.missing)) data.priceMissing = marketData.missing;
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
  getCandidateDataDirs,
  resolveDataFile,
  enrichPortfolioWithMarketData,
};