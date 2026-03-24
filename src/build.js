'use strict';
const fs = require('fs');
const path = require('path');
const { extractFromMarkdown } = require('./extract');
const { validatePortfolio } = require('./validate');
const { encrypt } = require('./encrypt');

const ROOT = path.join(__dirname, '..');
const MD_PATH = path.join(ROOT, 'options-history-since-feb.md');
const JSON_PATH = path.join(ROOT, 'portfolio_data.json');
const TEMPLATE_PATH = path.join(ROOT, 'template.html');
const OUT_PATH = path.join(ROOT, 'index.html');

function build() {
  const password = process.env.DASHBOARD_PASS;
  if (!password) {
    throw new Error('DASHBOARD_PASS environment variable is not set');
  }

  // Step 1: Extract
  console.log('→ Step 1: Extracting data from Markdown...');
  extractFromMarkdown(MD_PATH, JSON_PATH);

  // Step 2: Validate
  console.log('\n→ Step 2: Validating portfolio data...');
  const data = validatePortfolio(JSON_PATH);

  // Step 3: Encrypt
  console.log('\n→ Step 3: Encrypting...');
  const enc = encrypt(data, password);
  const jsonSize = JSON.stringify(data).length;
  console.log(`   Raw data: ${jsonSize} bytes → Encrypted: ${enc.data.length} chars`);

  // Step 4: Inject into template
  console.log('\n→ Step 4: Building index.html...');
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
