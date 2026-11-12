#!/usr/bin/env node
/**
 * ggzy-mcp — MCP server for China's national public resource trading platform
 *
 * Exposes the (undocumented) search API behind www.ggzy.gov.cn so AI agents can
 * query live tender / procurement announcements.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const UPSTREAM = "https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList";
const SITE = "https://www.ggzy.gov.cn";

/** Province name -> administrative division code used by the upstream API. */
const PROVINCES: Record<string, string> = {
  浙江: "330000", 北京: "110000", 上海: "310000", 江苏: "320000", 福建: "350000",
  广东: "440000", 山东: "370000", 湖北: "420000", 湖南: "430000", 四川: "510000",
  陕西: "610000", 河南: "410000", 河北: "130000", 山西: "140000", 辽宁: "210000",
  吉林: "220000", 黑龙江: "230000", 安徽: "340000", 江西: "360000", 广西: "450000",
  海南: "460000", 重庆: "500000", 贵州: "520000", 云南: "530000", 西藏: "540000",
  甘肃: "620000", 青海: "630000", 宁夏: "640000", 新疆: "650000", 内蒙古: "150000",
  天津: "120000",
};

/** Announcement categories accepted by the upstream API. */
const CATEGORIES: Record<string, string> = {
  工程: "01",
  政府采购: "02",
  其他: "90",
};

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface BidRecord {
  title: string;
  publishTime: string;
  provinceText: string;
  informationTypeText: string;
  platform: string;
  url: string;
}

interface SearchResult {
  total: number;
  records: BidRecord[];
  query: string;
}

async function searchBids(opts: {
  keyword?: string;
  province?: string;
  days?: number;
  category?: string;
  page?: number;
}): Promise<SearchResult> {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 90);
  const page = Math.min(Math.max(opts.page ?? 1, 1), 50);
  const end = new Date();
  const begin = new Date(end.getTime() - days * 86_400_000);

  let provinceCode = "";
  if (opts.province) {
    const raw = opts.province.trim();
    if (/^\d{6}$/.test(raw)) provinceCode = raw;
    else provinceCode = PROVINCES[raw] ?? "";
    if (!provinceCode) {
      throw new Error(
        `未知省份 "${opts.province}"。可用值：${Object.keys(PROVINCES).join("、")}`,
      );
    }
  }

  let classify = "";
  if (opts.category) {
    classify = CATEGORIES[opts.category] ?? (/^\d{2}$/.test(opts.category) ? opts.category : "");
    if (!classify) {
      throw new Error(`未知分类 "${opts.category}"。可用值：${Object.keys(CATEGORIES).join("、")}`);
    }
  }

  const form = new URLSearchParams({
    SOURCE_TYPE: "",
    DEAL_TIME: "",
    TIMEBEGIN: ymd(begin),
    TIMEEND: ymd(end),
    PAGENUMBER: String(page),
    FINDTXT: (opts.keyword ?? "").slice(0, 60),
    DEAL_PROVINCE: provinceCode,
    DEAL_CLASSIFY: classify,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: `${SITE}/`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form.toString(),
      signal: ctrl.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`请求上游失败（${msg}）。ggzy.gov.cn 响应较慢，可稍后重试。`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`上游返回 HTTP ${res.status}`);

  const json: any = await res.json();
  const data = json?.data ?? {};
  const records: BidRecord[] = (data.records ?? []).map((r: any) => ({
    title: r.title ?? "",
    publishTime: r.publishTime ?? "",
    provinceText: r.provinceText ?? "",
    informationTypeText: r.informationTypeText ?? r.businessTypeText ?? "",
    platform: r.transactionSourcesPlatformText ?? "",
    url: r.url ? (String(r.url).startsWith("http") ? r.url : SITE + r.url) : "",
  }));

  const parts = [
    opts.keyword ? `"${opts.keyword}"` : "全部关键词",
    opts.province ?? "全国",
    `近 ${days} 天`,
  ];
  if (opts.category) parts.push(opts.category);

  return {
    total: Number(data.total ?? data.totalCount ?? 0),
    records,
    query: parts.join(" / "),
  };
}

function render(result: SearchResult): string {
  if (result.records.length === 0) {
    return `条件：${result.query}\n没有匹配的公告。可以换关键词或放宽时间范围（最多 90 天）。`;
  }
  const lines = [
    `条件：${result.query}`,
    `本页 ${result.records.length} 条，上游报总 ${result.total} 条（该站每页最多 20 条，总数上限 1000）`,
    "",
  ];
  result.records.forEach((r, i) => {
    lines.push(`${i + 1}. [${r.publishTime}] ${r.provinceText} · ${r.informationTypeText}`);
    lines.push(`   ${r.title}`);
    if (r.platform) lines.push(`   来源：${r.platform}`);
    if (r.url) lines.push(`   ${r.url}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

const server = new McpServer({ name: "ggzy-mcp", version: "1.0.0" });

server.tool(
  "search_bids",
  "Search live tender / procurement announcements on China's national public resource trading platform (ggzy.gov.cn). Returns title, publish date, province, category, source platform and a direct link for each announcement.",
  {
    keyword: z.string().optional().describe("Full-text keyword, Chinese or English, e.g. 医疗设备 / 智慧城市 / 数据中心"),
    province: z.string().optional().describe("Province name (e.g. 浙江) or 6-digit division code (e.g. 330000). Omit for nationwide."),
    days: z.number().int().min(1).max(90).optional().describe("Look back this many days. Default 7, max 90."),
    category: z.string().optional().describe("Category: 工程 (construction), 政府采购 (government procurement), 其他 (other). Omit for all."),
    page: z.number().int().min(1).max(50).optional().describe("Page number, default 1. Each page holds up to 20 records."),
  },
  async (args: any) => {
    try {
      const result = await searchBids(args);
      return { content: [{ type: "text", text: render(result) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text", text: `查询失败：${msg}` }], isError: true };
    }
  },
);

server.tool(
  "list_provinces",
  "List the province names and division codes accepted by search_bids.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: Object.entries(PROVINCES)
          .map(([name, code]) => `${name}：${code}`)
          .join("\n"),
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("ggzy-mcp fatal:", e);
  process.exit(1);
});
