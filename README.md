# ggzy-mcp

**MCP server for China's national public resource trading platform.**

China publishes every government tender, procurement notice and award announcement on
[ggzy.gov.cn](https://www.ggzy.gov.cn) — but the site has no public API, no documentation,
and no export. This server reverse-engineers its internal search endpoint and exposes it
as an MCP tool, so an AI agent can query **live** bidding data in one call.

```
You: 浙江最近一周有哪些医疗设备的招标？
AI:   [calls search_bids → 20 live records with dates, provinces and links]
```

## Tools

| Tool | What it does |
|---|---|
| `search_bids` | Full-text search over tender announcements. Filter by keyword, province, time window, category and page. Returns title, publish date, province, category, source platform and a direct link. |
| `list_provinces` | Lists the province names and 6-digit division codes accepted by `search_bids`. |

### `search_bids` parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `keyword` | string | — | Full-text search, Chinese or English (`医疗设备`, `智慧城市`, `数据中心`) |
| `province` | string | nationwide | Province name (`浙江`) or division code (`330000`) |
| `days` | number | `7` | Look-back window, 1–90 |
| `category` | string | all | `工程` · `政府采购` · `其他` |
| `page` | number | `1` | Page number, 20 records per page |

## Install

```bash
git clone https://github.com/<you>/ggzy-mcp.git
cd ggzy-mcp
npm install
npm run build
```

## Configure your MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ggzy": {
      "command": "node",
      "args": ["/absolute/path/to/ggzy-mcp/dist/index.js"]
    }
  }
}
```

**Cursor / Cline / any MCP client** — same shape, point `command` at `node` and `args` at the built entry file.

Restart the client. You should see `ggzy` with two tools.

## Example output

```
条件："医疗设备" / 浙江 / 近 7 天
本页 20 条，上游报总 1000 条（该站每页最多 20 条，总数上限 1000）

1. [2026-11-12] 浙江省 · 采购合同
   2026年湖州市中心医院医疗设备更新项目-腋臭治疗仪项目合同
   来源：湖州市公共资源交易网
   https://www.ggzy.gov.cn/information/deal/html/a/330000/0203/20261112/0033cfc5ef3ba7d9460da7e9c8ce172cc999.html
```

## Known limits (upstream, not this server)

- **20 records per page**, and the upstream caps the reported total at **1000**.
- **First call can take 10–40 seconds** — the government server is slow. Subsequent calls within
  the same minute are fast. The server times out at 30s and reports a clear error.
- **Captcha**: the upstream page has captcha logic that may trigger under rapid requests.
  Do not hammer it; one query per second is safe.
- **Fields change**: this is an undocumented endpoint. If it breaks, the mapping lives in
  `src/index.ts` (`UPSTREAM` + the `BidRecord` mapping) and is usually a five-line fix.

## Why this exists

AI agents are good at reasoning and bad at touching the world. Most useful Chinese data
sits behind systems with no API — provincial procurement portals, old government sites,
legacy ERPs. This project is one adapter for one of those systems.

If you need a different one, the pattern is the same: find the XHR, replay it, wrap it in MCP.

## License

MIT
