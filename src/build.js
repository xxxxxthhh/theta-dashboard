'use strict';
const fs = require('fs');
const path = require('path');
const { validatePortfolio } = require('./validate');
const { encrypt } = require('./encrypt');
const { resolveDataFile, enrichPortfolioWithMarketData } = require('./data-loader');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUT_PATH = path.join(ROOT, 'index.html');

function build() {
  const password = process.env.DASHBOARD_PASS;
  if (!password) {
    throw new Error('DASHBOARD_PASS environment variable is not set');
  }

  const jsonPath = resolveDataFile(ROOT, 'portfolio_data.json', true);
  const marketPath = resolveDataFile(ROOT, 'market_data.json', false);

  // Step 1: Load upstream data
  console.log('→ Step 1: Loading upstream portfolio data...');
  console.log(`   Using ${jsonPath}`);

  // Step 2: Validate
  console.log('\n→ Step 2: Validating portfolio data...');
  const data = validatePortfolio(jsonPath);

  // Step 3: Enrich with market price data
  console.log('\n→ Step 3: Enriching with market prices...');
  if (marketPath) {
    try {
      console.log(`   Using ${marketPath}`);
      const { openEnriched, idleEnriched } = enrichPortfolioWithMarketData(data, marketPath);
      console.log(`   Enriched ${openEnriched}/${data.openPositions.length} open positions`);
      console.log(`   Enriched ${idleEnriched}/${data.idlePositions.length} idle holdings`);
    } catch (err) {
      console.warn(`   Warning: could not read market_data.json - ${err.message}`);
    }
  } else {
    console.log('   No market_data.json found in upstream data dir, skipping enrichment');
  }

  // Step 4: Encrypt
  console.log('\n→ Step 4: Encrypting...');
  const enc = encrypt(data, password);
  const jsonSize = JSON.stringify(data).length;
  console.log(`   Raw data: ${jsonSize} bytes → Encrypted: ${enc.data.length} chars`);

  // Step 5: Inject into template
  console.log('\n→ Step 5: Building index.html...');
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
