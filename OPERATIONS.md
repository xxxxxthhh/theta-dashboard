# Theta Dashboard — Agent 操作指南

本项目是一个 GitHub Pages 上的个人看板仓库。它只负责**消费 `theta-data` 的上游 JSON 并生成 `index.html`**。

数据格式、持仓编辑规则、端到端时序以 `theta-data/README.md` 为准；本文件只说明 dashboard 自己的构建和发布职责。

---

## 输入约定

本仓库构建时只读取两个上游文件：

- `portfolio_data.json`
- `market_data.json`

`src/build.js` 的查找顺序如下：

1. `THETA_DATA_DIR`
2. dashboard 仓库根目录下的本地覆盖文件
3. 默认同级目录 `../theta-data`

如果要修改交易记录或持仓，请先去 `theta-data` 仓库更新 Markdown 并重新生成 JSON。

---

## 本地构建

先确保上游 JSON 已经准备好：

```bash
cd /Users/kyx/Documents/theta-data
node scripts/build_portfolio.js
```

然后在 dashboard 仓库构建：

```bash
cd /Users/kyx/Documents/theta-dashboard
export DASHBOARD_PASS="你的密码"
export THETA_DATA_DIR="../theta-data"
node src/build.js
```

便捷命令：

- `./build.sh` 只生成 `index.html`
- `./build.sh --push` 生成后提交并推送 `index.html`

---

## CI 行为

- `theta-dashboard/.github/workflows/build.yml` 只在两种情况下运行：
  - 收到 `repository_dispatch(data-updated)`
  - 手工 `workflow_dispatch`
- 修改 `src/*.js` 或 `template.html` 后，需要手工触发 CI 重建
- 自动重建来自 `theta-data` 推送新的 `portfolio_data.json` 或 `market_data.json`

---

## 本仓库职责文件

| 文件 | 说明 |
| --- | --- |
| `src/build.js` | 读取上游 JSON、校验、补充市场数据、加密并生成页面 |
| `src/validate.js` | 在加密前校验上游 `portfolio_data.json` |
| `src/encrypt.js` | AES-256-GCM 加密模块 |
| `template.html` | 页面模板 |
| `index.html` | 构建产物，提交到 GitHub Pages |
| `build.sh` | 本地构建和可选推送脚本 |

---

## 本地覆盖和调试

- `portfolio_data.json` 和 `market_data.json` 可以临时放在仓库根目录做本地覆盖
- 这两个文件默认都被 `.gitignore` 排除，不应提交
- `market_data.json` 用于补齐 `openPositions` 的 `lastPrice`、`bufferDollar` 和 `bufferPct`

Buffer 计算：

| 类型 | 公式 | 正值含义 |
| --- | --- | --- |
| CC | `strike - lastPrice` | 股价低于行权价 |
| CSP | `lastPrice - strike` | 股价高于行权价 |

---

## 安全注意事项

- 永远不要硬编码 `DASHBOARD_PASS`
- 没有密码，页面里的组合数据只会以加密 payload 形式存在
