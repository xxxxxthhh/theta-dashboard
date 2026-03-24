'use strict';
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'portfolio_data.json');

function validatePortfolio(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Missing portfolio_data.json at ${jsonPath}`);
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const errors = [];
  const warnings = [];

  // Top-level fields
  if (typeof data.updatedAt !== 'string') errors.push('updatedAt must be a string');
  if (typeof data.cash !== 'number') warnings.push('cash is missing or not a number');

  // openPositions
  const open = data.openPositions || [];
  if (!Array.isArray(open)) {
    errors.push('openPositions must be an array');
  } else {
    for (const p of open) {
      if (!p.ticker) errors.push(`Open position missing ticker: ${JSON.stringify(p)}`);
      if (!p.type || !['CC', 'CSP'].includes(p.type)) errors.push(`Open position invalid type "${p.type}": ${p.ticker}`);
      if (!p.expiry) errors.push(`Open position missing expiry: ${p.ticker}`);
      if (typeof p.premium !== 'number' || !Number.isFinite(p.premium)) errors.push(`Open position premium not finite number: ${p.ticker}`);
      if (typeof p.strike !== 'number' || !Number.isFinite(p.strike)) errors.push(`Open position strike not finite number: ${p.ticker}`);
    }
  }

  // idlePositions
  const idle = data.idlePositions || [];
  if (!Array.isArray(idle)) {
    errors.push('idlePositions must be an array');
  } else {
    for (const p of idle) {
      if (!p.ticker) errors.push(`Idle position missing ticker: ${JSON.stringify(p)}`);
      if (typeof p.shares !== 'number' || p.shares <= 0) warnings.push(`Idle position shares invalid: ${p.ticker}`);
    }
  }

  // closedTrades
  const closed = data.closedTrades || [];
  if (!Array.isArray(closed)) {
    errors.push('closedTrades must be an array');
  } else {
    for (const t of closed) {
      if (!t.ticker) errors.push(`Closed trade missing ticker: ${JSON.stringify(t)}`);
      if (!t.expiryWeek) errors.push(`Closed trade missing expiryWeek: ${t.ticker}`);
      if (typeof t.premium !== 'number' || !Number.isFinite(t.premium)) errors.push(`Closed trade premium not finite: ${t.ticker} ${t.expiryWeek}`);
    }
  }

  // weeklyData integrity: totals should match closedTrades
  const computedByWeek = {};
  for (const t of closed) {
    computedByWeek[t.expiryWeek] = (computedByWeek[t.expiryWeek] || 0) + t.premium;
  }
  for (const w of (data.weeklyData || [])) {
    const computed = computedByWeek[w.week] || 0;
    const diff = Math.abs(w.realized - computed);
    if (diff > 0.01) {
      warnings.push(`weeklyData "${w.week}": stored $${w.realized}, computed $${computed.toFixed(0)} (diff $${diff.toFixed(0)})`);
    }
  }

  if (errors.length) {
    console.error('❌ Portfolio validation failed\n');
    for (const e of errors) console.error(`   - ${e}`);
    if (warnings.length) {
      console.error('\nWarnings:');
      for (const w of warnings) console.error(`   - ${w}`);
    }
    throw new Error(`Validation failed with ${errors.length} error(s)`);
  }

  // Print summary
  const totalRealized = closed.reduce((s, t) => s + t.premium, 0);
  const ccCount = open.filter(p => p.type === 'CC').length;
  const cspCount = open.filter(p => p.type === 'CSP').length;

  console.log('✅ Portfolio validation passed');
  console.log(`   Total realized: $${totalRealized.toFixed(0)} across ${closed.length} trades`);
  console.log(`   Open positions: ${open.length} (${ccCount} CC, ${cspCount} CSP)`);
  console.log(`   Idle positions: ${idle.length} stocks`);
  console.log(`   Cash: $${(data.cash || 0).toLocaleString()}`);

  if (warnings.length) {
    console.warn('\nWarnings:');
    for (const w of warnings) console.warn(`   - ${w}`);
  }

  return data;
}

// Standalone execution
if (require.main === module) {
  try {
    validatePortfolio(JSON_PATH);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
}

module.exports = { validatePortfolio };
