'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { resolveDataFile } = require('../src/data-loader');
const { assessReadiness, checkReadiness } = require('../src/build-readiness');

const ROOT = path.resolve(__dirname, '..');
const calendarPath = resolveDataFile(ROOT, 'scripts/lib/market_time.js', true);
const calendar = require(calendarPath);
const assess = (brokerAsOf, marketAsOf, now = '2026-09-30T21:40:00Z') =>
  assessReadiness({ brokerAsOf, marketAsOf, now: new Date(now), calendar });

test('reported overnight market-first mismatch defers; either arrival order recovers', () => {
  for (const [broker, market] of [['2026-09-29', '2026-09-30'], ['2026-09-30', '2026-09-29']]) {
    const result = assess(broker, market);
    assert.equal(result.ready, false);
    assert.match(result.message, /2026-10-01T11:00:00.000Z/);
    assert.equal(assess('2026-09-30', '2026-09-30').ready, true);
  }
});

test('aligned current session builds before and after collection deadline', () => {
  for (const time of ['2026-09-30T21:40:00Z', '2026-10-01T11:00:00Z', '2026-10-01T15:00:00Z']) {
    assert.equal(assess('2026-09-30', '2026-09-30', time).ready, true);
  }
});

test('both prior-session inputs defer during collection, then fail even though aligned', () => {
  assert.equal(assess('2026-09-29', '2026-09-29').ready, false);
  assert.throws(() => assess('2026-09-29', '2026-09-29', '2026-10-01T11:00:00Z'), /stale or inconsistent/);
});

test('deadline is strict and applies equally to broker and market lag', () => {
  for (const dates of [['2026-09-29', '2026-09-30'], ['2026-09-30', '2026-09-29']]) {
    assert.equal(assess(...dates, '2026-10-01T10:59:59.999Z').ready, false);
    assert.throws(() => assess(...dates, '2026-10-01T11:00:00Z'), /alignment deadline/);
  }
});

test('older or future sessions fail immediately during grace', () => {
  for (const dates of [['2026-09-28', '2026-09-30'], ['2026-09-30', '2026-09-28'], ['2026-10-01', '2026-09-30']]) {
    assert.throws(() => assess(...dates), /stale or inconsistent/);
  }
});

test('missing, malformed, impossible and non-session dates fail closed', () => {
  for (const bad of [undefined, null, '', '2026-9-30', '2026-09-31', '2026-09-26', '2026-09-07']) {
    assert.throws(() => assess(bad, '2026-09-30'), /valid XNYS/);
    assert.throws(() => assess('2026-09-30', bad), /valid XNYS/);
  }
  assert.throws(() => assess('2026-09-30', '2026-09-30', 'invalid'), /clock/);
  assert.throws(() => assess('2028-01-03', '2028-01-03', '2028-01-04T08:00:00Z'), /does not cover/);
});

test('Friday rolls on ET Saturday and grace does not renew over the weekend', () => {
  assert.equal(assess('2026-09-24', '2026-09-25', '2026-09-26T08:00:00Z').ready, false);
  assert.throws(() => assess('2026-09-24', '2026-09-25', '2026-09-27T08:00:00Z'), /stale or inconsistent/);
  assert.equal(assess('2026-09-25', '2026-09-25', '2026-09-27T08:00:00Z').ready, true);
});

test('holidays do not renew grace or create fictitious sessions', () => {
  assert.equal(assess('2026-09-03', '2026-09-04', '2026-09-05T08:00:00Z').ready, false);
  assert.throws(() => assess('2026-09-03', '2026-09-04', '2026-09-08T08:00:00Z'), /stale or inconsistent/);
  assert.equal(assess('2026-09-04', '2026-09-04', '2026-09-08T08:00:00Z').ready, true);
});

test('shared calendar respects early close and standard-time collector window', () => {
  assert.equal(assess('2026-11-25', '2026-11-25', '2026-11-27T18:14:00Z').ready, true);
  assert.equal(assess('2026-11-25', '2026-11-27', '2026-11-27T18:15:00Z').ready, false);
  // The 17:00 Singapore compensation run may retry until 05:30 EST
  // (10:30 UTC / 18:30 Singapore). Do not fail while that run can be valid.
  assert.equal(assess('2026-11-25', '2026-11-27', '2026-11-28T10:30:00Z').ready, false);
  assert.equal(assess('2026-11-25', '2026-11-27', '2026-11-28T10:59:59Z').ready, false);
  assert.throws(() => assess('2026-11-25', '2026-11-27', '2026-11-28T11:00:00Z'), /stale or inconsistent/);
});

// All integration input below is synthetic, isolated from the tracked data.
function fixture(t, brokerDate = '2026-09-29', marketDate = '2026-09-30') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-readiness-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'published'));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(calendarPath, path.join(dir, 'scripts', 'lib', 'market_time.js'));
  const authority = { mode: 'ibkr-only', source: 'ibkr-flex', asOfDate: brokerDate, manualOverridesAllowed: false };
  const snapshot = {
    schemaVersion: 2, source: 'ibkr-flex', publisherId: 'tianhaos-mac-mini', brokerAsOf: brokerDate,
    broker: { source: 'ibkr-flex', asOfDate: brokerDate, positionAuthority: authority, cash: 0, stocks: [], options: [], normalizationIssues: [] },
    accountRisk: {
      stateSource: 'ibkr-flex', snapshotAsOf: brokerDate, activityAsOf: brokerDate, positionAuthority: authority,
      positionsReconciled: true, syncGate: { pass: true }, syncRunStatus: 'success', syncRunId: 1,
    },
    riskReport: { t4: { status: 'block', canOpen: false } },
  };
  const brokerFile = path.join(dir, 'published', 'ibkr-latest.json');
  const save = () => {
    snapshot.stateSha256 = crypto.createHash('sha256').update(JSON.stringify({
      brokerAsOf: snapshot.brokerAsOf, broker: snapshot.broker, accountRisk: snapshot.accountRisk, riskReport: snapshot.riskReport,
    })).digest('hex');
    fs.writeFileSync(brokerFile, JSON.stringify(snapshot));
  };
  save();
  fs.writeFileSync(path.join(dir, 'market_data.json'), JSON.stringify({ latestDate: marketDate, prices: {} }));
  fs.writeFileSync(path.join(dir, 'portfolio_data.json'), JSON.stringify({ updatedAt: '2026-09-01', cash: 0, weeklyData: [], closedTrades: [] }));
  return { dir, snapshot, save, brokerFile };
}

function isolatedEnv(dir) {
  const env = { ...process.env, THETA_DATA_DIR: dir };
  delete env.GITHUB_OUTPUT;
  delete env.GITHUB_STEP_SUMMARY;
  return env;
}

test('authority/hash/reconciliation errors fail during grace rather than defer', t => {
  const { dir, snapshot, save, brokerFile } = fixture(t);
  const envBefore = process.env.THETA_DATA_DIR;
  process.env.THETA_DATA_DIR = dir;
  t.after(() => {
    if (envBefore === undefined) delete process.env.THETA_DATA_DIR;
    else process.env.THETA_DATA_DIR = envBefore;
  });
  const check = () => checkReadiness(ROOT, new Date('2026-09-30T21:40:00Z'));
  assert.equal(check().ready, false);
  snapshot.accountRisk.syncRunStatus = 'failed';
  save();
  assert.throws(check, /reconciled successful/);
  snapshot.accountRisk.syncRunStatus = 'success';
  snapshot.broker.positionAuthority.manualOverridesAllowed = true;
  save();
  assert.throws(check, /broker authority/);
  snapshot.broker.positionAuthority.manualOverridesAllowed = false;
  save();
  snapshot.broker.cash = 1;
  fs.writeFileSync(brokerFile, JSON.stringify(snapshot));
  assert.throws(check, /stateSha256/);
});

test('workflow gate returns explicit ready output, summary and failure status without building', t => {
  for (const [date, time, status, ready] of [
    ['2026-09-29', '2026-09-30T21:40:00Z', 0, 'false'],
    ['2026-09-30', '2026-10-01T11:00:00Z', 0, 'true'],
    ['2026-09-29', '2026-10-01T11:00:00Z', 1, null],
  ]) {
    const { dir } = fixture(t, date);
    const output = path.join(dir, 'output');
    const summary = path.join(dir, 'summary');
    const script = `require('./src/build-readiness').main(${JSON.stringify(ROOT)}, new Date(${JSON.stringify(time)}))`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...isolatedEnv(dir), GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    });
    assert.equal(result.status, status, result.stderr);
    if (ready) assert.equal(fs.readFileSync(output, 'utf8'), `ready=${ready}\n`);
    else assert.equal(fs.existsSync(output), false);
    assert.match(fs.readFileSync(summary, 'utf8'), ready === 'true' ? /Ready:/ : ready === 'false' ? /Deferred:/ : /readiness failed/);
    assert.equal(fs.existsSync(path.join(dir, 'index.html')), false);
  }
});

test('aligned synthetic data still builds; direct mismatched build retains hard date guard', t => {
  for (const [brokerDate, expectedStatus] of [['2026-09-30', 0], ['2026-09-29', 1]]) {
    const { dir } = fixture(t, brokerDate);
    const out = path.join(dir, 'built.html');
    const result = spawnSync(process.execPath, ['src/build.js'], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...isolatedEnv(dir), DASHBOARD_PASS: crypto.randomBytes(24).toString('hex'), DASHBOARD_OUTPUT_PATH: out },
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    assert.equal(fs.existsSync(out), expectedStatus === 0);
    if (expectedStatus === 1) assert.match(result.stderr, /does not match brokerAsOf/);
  }
});

test('unrelated configuration and historical-data build errors remain failures', t => {
  for (const failure of ['missing-password', 'invalid-history']) {
    const { dir } = fixture(t, '2026-09-30');
    const out = path.join(dir, 'built.html');
    const env = { ...isolatedEnv(dir), DASHBOARD_OUTPUT_PATH: out };
    if (failure === 'missing-password') delete env.DASHBOARD_PASS;
    else {
      env.DASHBOARD_PASS = crypto.randomBytes(24).toString('hex');
      fs.writeFileSync(path.join(dir, 'portfolio_data.json'), JSON.stringify({ updatedAt: 123 }));
    }
    const result = spawnSync(process.execPath, ['src/build.js'], { cwd: ROOT, encoding: 'utf8', env });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(out), false);
    assert.match(result.stderr, failure === 'missing-password' ? /DASHBOARD_PASS environment variable is not set/ : /Validation failed/);
  }
});
