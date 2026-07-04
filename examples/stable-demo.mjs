import {
  CseApiError,
  CseClient,
} from "../dist/index.js";

const cse = new CseClient({ timeoutMs: 60_000 });

const results = [];
const failures = [];

async function check(name, call, summarize) {
  try {
    const value = await call();
    results.push({ name, ...summarize(value) });
    return value;
  } catch (error) {
    failures.push({ name, error });
    return undefined;
  }
}

function count(rows) {
  return { count: Array.isArray(rows) ? rows.length : 0 };
}

function objectKeys(value) {
  return {
    keys: value && typeof value === "object" ? Object.keys(value).length : 0,
  };
}

function printError(name, error) {
  if (error instanceof CseApiError) {
    console.error(`FAIL ${name}: ${error.message}`);
    console.error(`  endpoint=${error.endpoint} status=${error.status ?? "n/a"}`);
    if (error.body) {
      console.error(`  body=${error.body}`);
    }
    return;
  }

  console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("Running live CSE stable API demo...\n");

const approvedAnnouncements = await check(
  "getApprovedAnnouncements",
  () => cse.getApprovedAnnouncements(),
  count,
);

await check("getMarketStatus", () => cse.getMarketStatus(), (value) => ({ status: value.status }));
await check("getMarketSummary", () => cse.getMarketSummary(), objectKeys);
await check("getAspi", () => cse.getAspi(), (value) => ({ value: value.value }));
await check("getSnpSriLanka20", () => cse.getSnpSriLanka20(), (value) => ({ value: value.value }));
await check("getSectors", () => cse.getSectors(), count);
await check("getMarketChart ASPI", () => cse.getMarketChart("ASPI", 1), (value) => ({ points: value.points.length }));
await check("getMarketChart SNP_SL_20", () => cse.getMarketChart("SNP_SL_20", 1), (value) => ({
  points: value.points.length,
}));

await check("getCompany", () => cse.getCompany("LOLC.N0000"), (value) => ({
  symbol: value.symbol,
  securityId: value.securityId,
}));
await check("getCompanyChart", () => cse.getCompanyChart("LOLC.N0000", 1), (value) => ({
  points: value.points.length,
}));
await check("getSecurityCodes", () => cse.getSecurityCodes(), count);
await check("getSecurities", () => cse.getSecurities(), count);
await check("getTodayPrices", () => cse.getTodayPrices(), count);
await check("getTopGainers", () => cse.getTopGainers(), count);
await check("getTopLosers", () => cse.getTopLosers(), count);
await check("getMostActiveTrades", () => cse.getMostActiveTrades(), count);

await check("getTradeSummary", () => cse.getTradeSummary(), count);
await check("getDetailedTrades", () => cse.getDetailedTrades(), count);
await check("getDetailedTrades symbol", () => cse.getDetailedTrades("LOLC.N0000"), count);
await check("getDailyMarketSummary", () => cse.getDailyMarketSummary(), count);

await check("getNewListingsAnnouncements", () => cse.getNewListingsAnnouncements(), count);
await check("getBuyInBoardAnnouncements", () => cse.getBuyInBoardAnnouncements(), count);
await check("getCovidAnnouncements", () => cse.getCovidAnnouncements(), count);
await check("getFinancialAnnouncements", () => cse.getFinancialAnnouncements(), count);
await check("getCircularAnnouncements", () => cse.getCircularAnnouncements(), count);
await check("getDirectiveAnnouncements", () => cse.getDirectiveAnnouncements(), count);
await check("getNonComplianceAnnouncements", () => cse.getNonComplianceAnnouncements(), count);
await check("getCompanyAnnouncements", () => cse.getCompanyAnnouncements("LOLC.N0000"), count);

const announcementId = approvedAnnouncements?.find((item) => Number.isInteger(item.announcementId))?.announcementId;
if (announcementId) {
  await check("getAnnouncement", () => cse.getAnnouncement(announcementId), objectKeys);
} else {
  failures.push({
    name: "getAnnouncement",
    error: new Error("No announcementId found in getApprovedAnnouncements response."),
  });
}

await check("getCorporateAnnouncementCategories", () => cse.getCorporateAnnouncementCategories(), count);
await check("getSmdCategories", () => cse.getSmdCategories(), count);

await check("getNews", () => cse.getNews({ type: "CN", top: false }), count);
await check("getTopNews", () => cse.getTopNews({ type: "CN", numberOfRecord: 3 }), count);
await check("getEvents", () => cse.getEvents({ eventType: "OT", year: 2026 }), count);
await check("getTopEvents", () => cse.getTopEvents({ eventType: "OT", year: 2026, numberOfRecord: 3 }), count);
await check("getEducationalVideos", () => cse.getEducationalVideos(), count);
await check("getNotifications", () => cse.getNotifications(), count);

await check("raw", () => cse.raw("marketStatus"), objectKeys);
await check("rawGet", () => cse.rawGet("allSecurityCode"), count);

for (const result of results) {
  const details = Object.entries(result)
    .filter(([key]) => key !== "name")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`OK   ${result.name}${details ? ` ${details}` : ""}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} stable demo call(s) failed.`);
  for (const failure of failures) {
    printError(failure.name, failure.error);
  }
  process.exitCode = 1;
} else {
  console.log("\nAll stable demo calls completed.");
}
