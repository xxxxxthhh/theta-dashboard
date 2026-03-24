# Theta Dashboard — Agent 操作指南

本项目是一个**期权卖方策略（Theta Gang）个人看板**，部署于 GitHub Pages，数据通过 AES-256-GCM 加密保护。

## 唯一数据源

`options-history-since-feb.md` 是**唯一的真相源**。所有期权记录、在途持仓、持仓股票均写入此文件。

---

## 数据源格式说明

### 1. 历史到期记录（按到期周追加）

每新增一个到期周，在文件中追加以下格式：

```markdown
#### 3/27 到期周

| 标的 | 类型 | Strike | 权利金 | 结果 |
|---|---|---|---|---|
| AAPL | CC | $262.5 | $180 | OTM 归零 ✅ |
| PDD | CSP | $95 | $120 | OTM 归零 ✅ |
| COIN | CSP | $175 | -$889 | 盘前止损 |
| AMD | CSP | $180 | $95 | **ITM assign，接货 100 股** |

本周权利金收入：**$XXXX**
```

**字段说明：**
- `类型`：`CC`（Covered Call）或 `CSP`（Cash-Secured Put）
- `Strike`：行权价，如 `$262.5`
- `权利金`：收到的权利金。负数表示亏损（如 `-$889`）；未记录填 `—`
- `结果`：自由文本，含 "assign" 或 "接货" 的行会被标记为 `assigned: true`

---

### 2. 在途持仓（当前持有但未到期的期权）

在文件中添加或更新以下段落（覆盖上一次的在途持仓）：

```markdown
### 📝 在途持仓

#### CC
| 标的 | Strike | 到期日 | 权利金 |
|---|---|---|---|
| CRCL | $65 | 2026-06-18 | $0 |
| AAPL | $260 | 2026-04-04 | $185 |

#### CSP
| 标的 | Strike | 到期日 | 权利金 |
|---|---|---|---|
| PDD | $95 | 2026-04-04 | $130 |
```

**注意**：到期日格式为 `YYYY-MM-DD`。

---

### 3. 持仓股票（持有的股票，用于 Covered Call）

```markdown
### 📦 持仓股票

| 标的 | 股数 | 成本 | 可卖CC | 备注 |
|---|---|---|---|---|
| AAPL | 100 | $257.00 | ✓ | |
| PDD | 200 | $101.78 | ✓ | 原100股 + 3/20接货100股 |
| AMZN | 10 | $212.50 | — | 不足100股 |
```

---

## 构建命令

每次更新 `options-history-since-feb.md` 后运行：

```bash
# 设置密码（每次终端会话需要）
export DASHBOARD_PASS="你的密码"

# 构建（仅生成 index.html）
node src/build.js

# 或使用便捷脚本（自动构建）
./build.sh

# 构建 + 推送到 GitHub
./build.sh --push
```

---

## 文件职责

| 文件 | 说明 |
|------|------|
| `options-history-since-feb.md` | **唯一数据源** - 手动维护 |
| `src/extract.js` | Markdown → `portfolio_data.json` |
| `src/validate.js` | JSON Schema + 数据完整性校验 |
| `src/encrypt.js` | AES-256-GCM 加密模块 |
| `src/build.js` | 构建编排器（提取→校验→加密→注入） |
| `build.sh` | 便捷 Shell 脚本（含可选 git push） |
| `template.html` | 前端 Dashboard 模板 |
| `index.html` | **构建产物**（提交到 Git，用于 GitHub Pages） |
| `portfolio_data.json` | 中间产物（`.gitignore` 不提交） |

---

## 安全注意事项

- `portfolio_data.json` 已在 `.gitignore` 中排除，**永远不要手动 git add 它**
- `DASHBOARD_PASS` 只能通过环境变量传递，**永远不要硬编码到任何文件**
- 没有密码，GitHub Pages 上的 `index.html` 只显示加密乱码
