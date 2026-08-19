'use strict';
const fs = require('fs');
const path = require('path');
const { validatePortfolio } = require('./validate');
const { encrypt } = require('./encrypt');
const {
  resolveDataFile,
  loadPublishedIbkrPortfolio,
  enrichPortfolioWithMarketData,
} = require('./data-loader');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUT_PATH = process.env.DASHBOARD_OUTPUT_PATH
  ? path.resolve(process.env.DASHBOARD_OUTPUT_PATH)
  : path.join(ROOT, 'index.html');

function build() {
  const password = process.env.DASHBOARD_PASS;
  if (!password) {
    throw new Error('DASHBOARD_PASS environment variable is not set');
  }

  const jsonPath = resolveDataFile(ROOT, 'portfolio_data.json', true);
  const marketPath = resolveDataFile(ROOT, 'market_data.json', true);
  const brokerPath = resolveDataFile(ROOT, path.join('published', 'ibkr-latest.json'), true);

  // Step 1: Load upstream data
  console.log('→ Step 1: Loading upstream portfolio data...');
  console.log(`   Using ${jsonPath}`);

  // Step 2: Validate
  console.log('\n→ Step 2: Validating portfolio data...');
  const historicalData = validatePortfolio(jsonPath);

  // Step 3: Replace current positions with the broker-only published read model.
  // Historical closed trades and weekly summaries remain display projections.
  console.log('\n→ Step 3: Loading reconciled IBKR current positions...');
  console.log(`   Using ${brokerPath}`);
  const data = loadPublishedIbkrPortfolio(brokerPath, historicalData);
  console.log(`   Broker as-of ${data.brokerAsOf} · sync run ${data.brokerSyncRunId}`);
  console.log(`   Current positions: ${data.openPositions.length} options · ${data.idlePositions.length} stocks`);

  // Step 4: Enrich with market price data. The market session must match the
  // broker snapshot; mixed-day builds fail closed and wait for the next sync.
  console.log('\n→ Step 4: Enriching with market prices...');
  console.log(`   Using ${marketPath}`);
  const { openEnriched, idleEnriched } = enrichPortfolioWithMarketData(data, marketPath);
  console.log(`   Enriched ${openEnriched}/${data.openPositions.length} open positions`);
  console.log(`   Enriched ${idleEnriched}/${data.idlePositions.length} stock holdings`);

  // Step 5: Encrypt
  console.log('\n→ Step 5: Encrypting...');
  const enc = encrypt(data, password);
  const jsonSize = JSON.stringify(data).length;
  console.log(`   Raw data: ${jsonSize} bytes → Encrypted: ${enc.data.length} chars`);

  // Step 6: Inject into template
  console.log('\n→ Step 6: Building index.html...');
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`template.html not found at ${TEMPLATE_PATH}`);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes('__ENCRYPTED_DATA__')) {
    throw new Error('template.html is missing the __ENCRYPTED_DATA__ placeholder');
  }
  const output = template.replace('__ENCRYPTED_DATA__', JSON.stringify(enc));
  fs.writeFileSync(OUT_PATH, output);

  console.log('\n✅ Dashboard built successfully → index.html');
}

try {
  build();
} catch (err) {
  console.error('\n❌ Build failed:', err.message);
  process.exit(1);
}
