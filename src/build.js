'use strict';
const fs = require('fs');
const path = require('path');
const { validatePortfolio } = require('./validate');
const { encrypt } = require('./encrypt');

const ROOT = path.join(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUT_PATH = path.join(ROOT, 'index.html');

function getCandidateDataDirs() {
  const dirs = [];
  if (process.env.THETA_DATA_DIR) dirs.push(path.resolve(ROOT, process.env.THETA_DATA_DIR));
  dirs.push(ROOT);
  dirs.push(path.resolve(ROOT, '..', 'theta-data'));

  return [...new Set(dirs)];
}

function resolveDataFile(name, required) {
  for (const dir of getCandidateDataDirs()) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  if (!required) return null;

  throw new Error(
    `${name} not found. Checked: ${getCandidateDataDirs().join(', ')}. ` +
    'Set THETA_DATA_DIR if the theta-data checkout is elsewhere.'
  );
}

function build() {
  const password = process.env.DASHBOARD_PASS;
  if (!password) {
    throw new Error('DASHBOARD_PASS environment variable is not set');
  }

  const jsonPath = resolveDataFile('portfolio_data.json', true);
  const marketPath = resolveDataFile('market_data.json', false);

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
      const marketData = JSON.parse(fs.readFileSync(marketPath, 'utf8'));
      const prices = marketData.prices || {};
      let enriched = 0;
      for (const pos of data.openPositions) {
        const info = prices[pos.ticker];
        if (info && typeof info.close === 'number') {
          pos.lastPrice = info.close;
          pos.priceDate = info.date;
          if (pos.type === 'CC') {
            // CC: 股价低于行权价为安全（OTM）
            pos.bufferDollar = +(pos.strike - info.close).toFixed(2);
          } else if (pos.type === 'CSP') {
            // CSP: 股价高于行权价为安全（OTM）
            pos.bufferDollar = +(info.close - pos.strike).toFixed(2);
          }
          pos.bufferPct = +(pos.bufferDollar / info.close * 100).toFixed(2);
          enriched++;
        }
      }
      if (marketData.fetchedAt) data.marketDataAt = marketData.fetchedAt;
      console.log(`   Enriched ${enriched}/${data.openPositions.length} positions`);
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
