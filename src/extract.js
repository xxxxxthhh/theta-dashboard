'use strict';
const fs = require('fs');
const path = require('path');

const MD_PATH = path.join(__dirname, '..', 'options-history-since-feb.md');
const OUT_PATH = path.join(__dirname, '..', 'portfolio_data.json');

// Parse premium strings: "$840", "-$889", "$1,768", "—", ""
function parsePremium(str) {
  if (!str || /^[—–-]*$/.test(str.trim())) return 0;
  const cleaned = str.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : 0;
}

// Normalize week label: "2/13 " -> "2/13", "3/6 " -> "3/6"
function normalizeWeek(raw) {
  return raw.trim();
}

// Normalize expiry: "4/2" -> "2026-04-02", "2026-04-02" unchanged
function normalizeExpiry(raw) {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const year = new Date().getFullYear();
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return trimmed;
}

// Build column index map from open-position header row
function buildOpenColMap(headerParts) {
  const map = {};
  for (let i = 0; i < headerParts.length; i++) {
    const h = headerParts[i].toLowerCase();
    if (h === '标的' || h === 'ticker') map.ticker = i;
    else if (h === 'strike') map.strike = i;
    else if (h.includes('到期')) map.expiry = i;
    else if (h.includes('权利金') || h === 'premium') map.premium = i;
    else if (h.includes('合约') || h === 'contracts') map.contracts = i;
  }
  return map;
}

function extractFromMarkdown(mdPath, outPath) {
  if (!fs.existsSync(mdPath)) {
    throw new Error(`Cannot find data source: ${mdPath}`);
  }

  const content = fs.readFileSync(mdPath, 'utf8');
  const lines = content.split('\n');

  const data = {
    updatedAt: new Date().toISOString().slice(0, 10),
    cash: 0,
    weeklyData: [],
    openPositions: [],
    idlePositions: [],
    closedTrades: [],
  };

  // Summary table parsed from the header for cross-validation
  const summaryByWeek = {};

  // State machine
  const STATE = {
    TOP: 'TOP',
    SUMMARY_TABLE: 'SUMMARY_TABLE',
    HISTORY_WEEK: 'HISTORY_WEEK',
    OPEN_POSITIONS: 'OPEN_POSITIONS',
    OPEN_CC: 'OPEN_CC',
    OPEN_CSP: 'OPEN_CSP',
    IDLE: 'IDLE',
  };
  let state = STATE.TOP;
  let currentWeek = null; // e.g. "2/13"
  let openColMap = null;  // column index map for open position tables

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // Skip separator rows
    if (/^\|[-:| ]+\|$/.test(line)) continue;

    // Detect summary table (top-level overview)
    if (line.match(/^###.*总览/) || line.match(/^###.*Overview/i)) {
      state = STATE.SUMMARY_TABLE;
      continue;
    }

    // Detect weekly history section heading: #### 2/13 到期周
    const weekMatch = line.match(/^####\s+(.+?)到期周/);
    if (weekMatch) {
      state = STATE.HISTORY_WEEK;
      currentWeek = normalizeWeek(weekMatch[1]);
      continue;
    }

    // Detect open positions section: ### 📝 在途持仓 / ### Open
    if (line.match(/^###\s+.*在途/) || line.match(/^###\s+.*Open/i)) {
      state = STATE.OPEN_POSITIONS;
      continue;
    }

    // Detect idle stock section: ### 📦 持仓股票 / ### Idle / ### Holdings
    if (line.match(/^###\s+.*持仓股票/) || line.match(/^###\s+.*Idle/i) || line.match(/^###\s+.*Holdings/i)) {
      state = STATE.IDLE;
      continue;
    }

    // Detect open sub-type: #### CC / #### CSP
    if (state === STATE.OPEN_POSITIONS || state === STATE.OPEN_CC || state === STATE.OPEN_CSP) {
      const openTypeMatch = line.match(/^####\s+(CC|CSP)\s*$/i);
      if (openTypeMatch) {
        state = openTypeMatch[1].toUpperCase() === 'CC' ? STATE.OPEN_CC : STATE.OPEN_CSP;
        openColMap = null; // reset for each sub-section
        continue;
      }
    }

    // Any higher-level heading resets state
    if (/^#{1,3}\s/.test(line) && !line.match(/^####/)) {
      // Only reset if not already handled above
      if (state !== STATE.SUMMARY_TABLE && state !== STATE.OPEN_POSITIONS) {
        state = STATE.TOP;
        currentWeek = null;
      }
      continue;
    }

    // Parse table rows
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    // Detect open-position header rows and build column mapping
    const isOpenHeader = (parts[0] === '标的' || parts[0].toLowerCase() === 'ticker') &&
                         (state === STATE.OPEN_CC || state === STATE.OPEN_CSP);
    if (isOpenHeader) {
      openColMap = buildOpenColMap(parts);
      continue;
    }
    // Skip other header rows
    if (parts[0] === '标的' || parts[0] === '到期周' || parts[0].startsWith('Ticker') || parts[0].startsWith('总计') || parts[0].startsWith('2月')) continue;

    if (state === STATE.SUMMARY_TABLE && parts.length >= 2) {
      // | 到期周 | 已实现权利金 | 备注 |
      // Normalize: "2/13 周" → "2/13"
      const weekLabel = parts[0].trim().replace(/\s*周$/, '');
      const premiumStr = parts[1].replace(/\*\*/g, '').replace(/,/g, '').trim();
      const val = Number(premiumStr.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(val) && val > 0 && weekLabel.includes('/')) {
        summaryByWeek[weekLabel] = val;
      }
      continue;
    }

    if (state === STATE.HISTORY_WEEK && currentWeek && parts.length >= 4) {
      // | 标的 | 类型 | Strike | 权利金 | 结果 |
      const ticker = parts[0];
      const type = parts[1].toUpperCase();
      const strike = Number(parts[2].replace(/[^0-9.]/g, ''));
      const premium = parsePremium(parts[3]);
      const result = parts[4] || '';

      if (ticker && (type === 'CC' || type === 'CSP')) {
        data.closedTrades.push({
          ticker,
          type,
          strike,
          premium,
          expiryWeek: currentWeek,
          assigned: /assign|接货/i.test(result),
          result: result.replace(/\*\*/g, '').trim(),
        });
      }
      continue;
    }

    if ((state === STATE.OPEN_CC || state === STATE.OPEN_CSP) && parts.length >= 4) {
      // Use column mapping if available, fallback to legacy positional order
      const col = openColMap || { ticker: 0, strike: 1, expiry: 2, premium: 3 };
      const ticker = parts[col.ticker != null ? col.ticker : 0];
      const strike = Number((parts[col.strike != null ? col.strike : 1] || '').replace(/[^0-9.]/g, ''));
      const expiryRaw = (parts[col.expiry != null ? col.expiry : 2] || '').trim();
      const premium = parsePremium(parts[col.premium != null ? col.premium : 3]);
      const type = state === STATE.OPEN_CC ? 'CC' : 'CSP';
      const expiry = normalizeExpiry(expiryRaw);

      if (ticker) {
        data.openPositions.push({ ticker, type, strike, expiry, premium, contracts: 1 });
      }
      continue;
    }

    if (state === STATE.IDLE && parts.length >= 3) {
      // | 标的 | 股数 | 成本 | 可卖CC | 备注 |
      const ticker = parts[0];
      const shares = Number(parts[1].replace(/[^0-9]/g, ''));
      const costBasis = Number(parts[2].replace(/[^0-9.]/g, ''));
      const canSellCC = parts[3] ? !/[×✗xX否no]/i.test(parts[3]) : true;
      const note = parts[4] || '';

      if (ticker && Number.isFinite(shares)) {
        data.idlePositions.push({ ticker, shares, costBasis, canSellCC, note });
      }
      continue;
    }
  }

  // Aggregate weeklyData from closedTrades
  const weekMap = {};
  for (const t of data.closedTrades) {
    const w = t.expiryWeek;
    if (!weekMap[w]) weekMap[w] = { week: w, label: `${w} 到期周`, realized: 0, trades: 0 };
    weekMap[w].realized += t.premium;
    weekMap[w].trades += 1;
  }

  // Sort chronologically: treat "M/D" as sortable
  data.weeklyData = Object.values(weekMap).sort((a, b) => {
    const toNum = (w) => {
      const [m, d] = w.week.split('/').map(Number);
      return m * 100 + d;
    };
    return toNum(a) - toNum(b);
  });

  // Mark pending weeks: weeks where every trade is "待到期" AND the week
  // corresponds to an open position expiry date → show as unconfirmed in dashboard
  const openWeekSet = new Set();
  for (const pos of data.openPositions) {
    if (!pos.expiry) continue;
    const m = pos.expiry.match(/\d{4}-(\d+)-(\d+)/);
    if (m) openWeekSet.add(`${parseInt(m[1])}/${parseInt(m[2])}`);
  }
  for (const entry of data.weeklyData) {
    if (!openWeekSet.has(entry.week)) continue;
    const weekTrades = data.closedTrades.filter(t => t.expiryWeek === entry.week);
    if (weekTrades.length > 0 && weekTrades.every(t => /待到期/.test(t.result))) {
      entry.pending = true;
      entry.pendingPremium = entry.realized;
      entry.realized = 0;
    }
  }

  // Cross-validate against summary table
  const warnings = [];
  for (const [weekLabel, summaryVal] of Object.entries(summaryByWeek)) {
    const extracted = weekMap[weekLabel];
    if (!extracted) {
      warnings.push(`Summary table mentions "${weekLabel}" but no trades found for this week`);
      continue;
    }
    const diff = Math.abs(extracted.realized - summaryVal);
    if (diff > 5) {
      warnings.push(`Week "${weekLabel}": summary says $${summaryVal}, extracted $${extracted.realized} (diff $${diff})`);
    }
  }

  if (warnings.length) {
    console.warn('\n⚠️  Cross-validation warnings:');
    for (const w of warnings) console.warn(`   - ${w}`);
    console.warn('');
  }

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  const totalRealized = data.weeklyData.reduce((s, w) => s + w.realized, 0);
  console.log(`✅ Extracted to ${path.basename(outPath)}`);
  console.log(`   ${data.closedTrades.length} closed trades across ${data.weeklyData.length} weeks`);
  console.log(`   ${data.openPositions.length} open positions`);
  console.log(`   ${data.idlePositions.length} idle stock positions`);
  console.log(`   Total realized: $${totalRealized}`);

  return data;
}

// Standalone execution
if (require.main === module) {
  try {
    extractFromMarkdown(MD_PATH, OUT_PATH);
  } catch (err) {
    console.error('❌', err.message);
    process.exit(1);
  }
}

module.exports = { extractFromMarkdown, parsePremium };
