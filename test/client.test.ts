import { describe, expect, it, vi } from "vitest";
import { CseClient, CseEmptyDataError, CseValidationError } from "../src/index.js";

type ResponseSpec = { status?: number; body: unknown };

function createFetch(responses: Record<string, ResponseSpec[]>): {
  fetch: typeof fetch;
  calls: Array<{ method: string; endpoint: string; query: string; body: string }>;
} {
  const calls: Array<{ method: string; endpoint: string; query: string; body: string }> = [];

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const endpoint = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
    const method = init?.method ?? "GET";
    calls.push({ method, endpoint, query: url.searchParams.toString(), body });

    const queue = responses[endpoint];
    const next = queue?.shift();
    if (!next) {
      return new Response(JSON.stringify({ message: `unexpected endpoint ${endpoint}` }), { status: 404 });
    }

    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });

  return { fetch: fetchMock as unknown as typeof fetch, calls };
}

describe("CseClient", () => {
  it("resolves securityId and maps company chart points", async () => {
    const { fetch, calls } = createFetch({
      companyInfoSummery: [
        {
          body: {
            reqSymbolInfo: { symbol: "LOLC.N0000", name: "L O L C HOLDINGS PLC" },
            reqSymbolBetaInfo: { securityId: 378, betaValueSPSL: 0.43 },
            reqLogo: { id: 2168, path: "upload_logo/378_1601611239.jpeg" },
          },
        },
      ],
      companyChartDataByStock: [
        {
          body: {
            id: 378,
            chartData: [
              {
                h: 54.7,
                l: 54.7,
                o: null,
                s: 57118421,
                q: 918,
                p: 54.7,
                c: -0.1,
                pc: -0.1824,
                t: 1783051488212,
                n: null,
                id: 57118421,
              },
            ],
          },
        },
      ],
    });
    const client = new CseClient({ fetch });

    const chart = await client.getCompanyChart("LOLC.N0000", 1);

    expect(chart.securityId).toBe(378);
    expect(chart.points).toHaveLength(1);
    expect(chart.points[0]).toMatchObject({
      high: 54.7,
      low: 54.7,
      open: null,
      price: 54.7,
      quantity: 918,
      timestamp: 1783051488212,
    });
    expect(calls).toEqual([
      { method: "POST", endpoint: "companyInfoSummery", query: "", body: "symbol=LOLC.N0000" },
      { method: "POST", endpoint: "companyChartDataByStock", query: "", body: "stockId=378&period=1" },
    ]);
  });

  it("maps getTopLosers to the misspelled upstream endpoint", async () => {
    const { fetch, calls } = createFetch({
      topLooses: [{ body: [{ symbol: "CFLB.N0000", changePercentage: -7.27 }] }],
    });
    const client = new CseClient({ fetch });

    const losers = await client.getTopLosers();

    expect(losers).toEqual([{ symbol: "CFLB.N0000", changePercentage: -7.27 }]);
    expect(calls).toEqual([{ method: "POST", endpoint: "topLooses", query: "", body: "" }]);
  });

  it("rejects unsupported chart periods before making a request", async () => {
    const { fetch, calls } = createFetch({});
    const client = new CseClient({ fetch });

    await expect(client.getCompanyChart("LOLC.N0000", "1D" as never)).rejects.toBeInstanceOf(CseValidationError);
    expect(calls).toEqual([]);
  });

  it("throws a clear error for empty company chart data", async () => {
    const { fetch } = createFetch({
      companyInfoSummery: [
        {
          body: {
            reqSymbolInfo: { symbol: "LOLC.N0000" },
            reqSymbolBetaInfo: { securityId: 378 },
          },
        },
      ],
      companyChartDataByStock: [{ body: { id: 378, chartData: [] } }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getCompanyChart("LOLC.N0000", 1)).rejects.toBeInstanceOf(CseEmptyDataError);
  });

  it("flattens dailyMarketSummery nested arrays", async () => {
    const { fetch } = createFetch({
      dailyMarketSummery: [{ body: [[{ id: 26367, marketTurnover: 1541395970 }]] }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getDailyMarketSummary()).resolves.toEqual([{ id: 26367, marketTurnover: 1541395970 }]);
  });

  it("fetches securities from discovered GET endpoints", async () => {
    const { fetch, calls } = createFetch({
      allSecurityCode: [{ body: [{ id: 204, name: "ABANS ELECTRICALS PLC", symbol: "ABAN.N0000", active: 1 }] }],
      cntSecurity: [{ body: { status: "OK", content: [{ securityId: 642, name: "ABANS ELECTRICALS PLC", symbol: "ABAN" }] } }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getSecurityCodes()).resolves.toEqual([
      { id: 204, name: "ABANS ELECTRICALS PLC", symbol: "ABAN.N0000", active: 1 },
    ]);
    await expect(client.getSecurities()).resolves.toEqual([
      { securityId: 642, name: "ABANS ELECTRICALS PLC", symbol: "ABAN" },
    ]);
    expect(calls).toEqual([
      { method: "GET", endpoint: "allSecurityCode", query: "", body: "" },
      { method: "GET", endpoint: "cntSecurity", query: "", body: "" },
    ]);
  });

  it("maps market chart index names to upstream chart ids", async () => {
    const { fetch, calls } = createFetch({
      chartData: [{ body: [{ d: 1783051200000, v: 6204.54, pc: null }] }],
    });
    const client = new CseClient({ fetch });

    const chart = await client.getMarketChart("SNP_SL_20", 1);

    expect(chart).toMatchObject({
      index: "SNP_SL_20",
      chartId: 40,
      points: [{ date: 1783051200000, value: 6204.54, percentChange: null }],
    });
    expect(calls).toEqual([{ method: "POST", endpoint: "chartData", query: "", body: "chartId=40&period=1" }]);
  });

  it("fetches company announcements by symbol", async () => {
    const { fetch, calls } = createFetch({
      getAnnouncementByCompany: [{ body: { reqCompanyAnnouncement: [{ announcementId: 34388, symbol: "LOLC.N0000" }] } }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getCompanyAnnouncements("LOLC.N0000")).resolves.toEqual([
      { announcementId: 34388, symbol: "LOLC.N0000" },
    ]);
    expect(calls).toEqual([
      { method: "POST", endpoint: "getAnnouncementByCompany", query: "", body: "symbol=LOLC.N0000" },
    ]);
  });

  it("flattens grouped news responses and passes discovered query params", async () => {
    const { fetch, calls } = createFetch({
      web: [{ body: { CN: [{ id: "news-1", title: "Market notice" }] } }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getTopNews({ type: "CN", numberOfRecord: 3 })).resolves.toEqual([
      { id: "news-1", title: "Market notice" },
    ]);
    expect(calls).toEqual([
      { method: "GET", endpoint: "web", query: "top=true&type=CN&numberOfRecord=3", body: "" },
    ]);
  });

  it("reads content arrays from public website endpoints", async () => {
    const { fetch, calls } = createFetch({
      notifications: [{ body: { status: "OK", content: [{ id: "n1", title: "NOTICE" }] } }],
    });
    const client = new CseClient({ fetch });

    await expect(client.getNotifications()).resolves.toEqual([{ id: "n1", title: "NOTICE" }]);
    expect(calls).toEqual([
      { method: "GET", endpoint: "notifications", query: "", body: "" },
    ]);
  });
});
