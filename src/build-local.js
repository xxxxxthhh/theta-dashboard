'use strict';
const fs = require('fs');
const path = require('path');
const { validatePortfolio } = require('./validate');
const {
  resolveDataFile,
  loadPublishedIbkrPortfolio,
  enrichPortfolioWithMarketData,
} = require('./data-loader');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'local-template.html');
const OUT_PATH = process.env.DASHBOARD_OUTPUT_PATH
  ? path.resolve(process.env.DASHBOARD_OUTPUT_PATH)
  : path.join(ROOT, 'local-analytics.html');

function buildLocalAnalytics() {
  const jsonPath = resolveDataFile(ROOT, 'portfolio_data.json', true);
  const marketPath = resolveDataFile(ROOT, 'market_data.json', true);
  const brokerPath = resolveDataFile(ROOT, path.join('published', 'ibkr-latest.json'), true);

  console.log('→ Step 1: Loading upstream portfolio data...');
  console.log(`   Using ${jsonPath}`);

  console.log('\n→ Step 2: Validating portfolio data...');
  const historicalData = validatePortfolio(jsonPath);

  console.log('\n→ Step 3: Loading reconciled IBKR current positions...');
  console.log(`   Using ${brokerPath}`);
  const data = loadPublishedIbkrPortfolio(brokerPath, historicalData);

  console.log('\n→ Step 4: Enriching with market prices...');
  console.log(`   Using ${marketPath}`);
  const { openEnriched, idleEnriched } = enrichPortfolioWithMarketData(data, marketPath);
  console.log(`   Enriched ${openEnriched}/${data.openPositions.length} open positions`);
  console.log(`   Enriched ${idleEnriched}/${data.idlePositions.length} stock holdings`);

  console.log('\n→ Step 5: Building local-analytics.html...');
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`local-template.html not found at ${TEMPLATE_PATH}`);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes('__LOCAL_DATA__')) {
    throw new Error('local-template.html is missing the __LOCAL_DATA__ placeholder');
  }

  const output = template.replace('__LOCAL_DATA__', JSON.stringify(data));
  fs.writeFileSync(OUT_PATH, output);

  console.log('\n✅ Local analytics built successfully → local-analytics.html');
}

try {
  buildLocalAnalytics();
} catch (err) {
  console.error('\n❌ Local analytics build failed:', err.message);
  process.exit(1);
}
