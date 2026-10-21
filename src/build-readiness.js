'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveDataFile, loadPublishedIbkrPortfolio } = require('./data-loader');

const ROOT = path.resolve(__dirname, '..');

// This is orchestration only. The build's broker authority/hash checks and
// exact market/broker date guard still run on the same immutable checkout.
function assessReadiness({ brokerAsOf, marketAsOf, now = new Date(), calendar }) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid readiness clock');
  for (const [label, date] of Object.entries({ brokerAsOf, marketAsOf })) {
    if (!calendar.isValidYmd(date) || !calendar.isTradingDayYmd(date)) {
      throw new Error(`${label} must be a valid XNYS session date`);
    }
  }
  const expected = calendar.latestCompletedTradingDay(now);
  const previous = calendar.previousTradingDay(new Date(`${expected}T12:00:00Z`));
  // Session dates are ET dates. Its next calendar morning at 11:00 UTC is
  // 19:00 Singapore: 30 minutes after the collector's 05:30 ET retry deadline
  // in standard time (18:30 Singapore; 17:30 during daylight saving time).
  // Anchor to the completed session, so weekends/holidays cannot renew grace.
  const deadline = new Date(`${expected}T11:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 1);
  const dates = `broker=${brokerAsOf}, market=${marketAsOf}, expected=${expected}`;
  if (brokerAsOf === expected && marketAsOf === expected) {
    return { ready: true, message: `Ready: ${dates}` };
  }
  if ([brokerAsOf, marketAsOf].every(date => date === expected || date === previous)
    && now < deadline) {
    return {
      ready: false,
      message: `Deferred: ${dates}; waiting for upstream alignment until ${deadline.toISOString()}. No dashboard built or published.`,
    };
  }
  throw new Error(`Upstream data stale or inconsistent: ${dates}; alignment deadline=${deadline.toISOString()}. Check the collector and price-fetch runs.`);
}

function checkReadiness(root = ROOT, now = new Date()) {
  const brokerPath = resolveDataFile(root, path.join('published', 'ibkr-latest.json'), true);
  const marketPath = resolveDataFile(root, 'market_data.json', true);
  // Reuse the upstream XNYS calendar (including early closes and fail-closed
  // coverage). Resolve it from the same checkout as the broker snapshot.
  const dataDir = path.dirname(path.dirname(brokerPath));
  const calendar = require(path.join(dataDir, 'scripts', 'lib', 'market_time.js'));
  // Invalid authority, failed reconciliation, tampering or unsupported current
  // positions must fail even during the normal collection window.
  const data = loadPublishedIbkrPortfolio(brokerPath, {});
  const market = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
  return assessReadiness({ brokerAsOf: data.brokerAsOf, marketAsOf: market.latestDate, now, calendar });
}

function main(root = ROOT, now = new Date()) {
  try {
    const result = checkReadiness(root, now);
    console.log(result.message);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `ready=${result.ready}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${result.message}\n`);
    }
    if (!result.ready) console.log(`::notice::${result.message}`);
  } catch (error) {
    const message = `Dashboard readiness failed: ${error.message}`;
    console.error(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    }
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { assessReadiness, checkReadiness, main };
