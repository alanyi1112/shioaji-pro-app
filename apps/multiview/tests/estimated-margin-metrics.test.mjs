import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEstimatedMarginMetrics,
  ESTIMATED_MARGIN_FORMULA_VERSION,
  ESTIMATED_MARGIN_MODEL_LOAN_RATIO_PERCENT,
  ESTIMATED_MARGIN_MODEL_LOAN_RATIO_SOURCE,
} from "../worker/estimated-margin-metrics.ts";

function row(sessionDate, values = {}) {
  return {
    sessionDate,
    close: 50,
    marginBuyLots: 0,
    marginSellLots: 0,
    marginCashRepaymentLots: 0,
    marginYesterdayBalanceLots: 0,
    marginTodayBalanceLots: 0,
    marginBalanceChangeLots: 0,
    ...values,
  };
}

test("估算融資成本涵蓋 seeded、買進加權、減部位、歸零與重新 seed", () => {
  const result = calculateEstimatedMarginMetrics([
    row("2026-07-01", { marginTodayBalanceLots: 100, marginBalanceChangeLots: 100 }),
    row("2026-07-02", { close: 60, marginYesterdayBalanceLots: 100, marginBuyLots: 20, marginSellLots: 10, marginCashRepaymentLots: 5, marginTodayBalanceLots: 105, marginBalanceChangeLots: 5 }),
    row("2026-07-03", { close: 62, marginYesterdayBalanceLots: 105, marginSellLots: 100, marginCashRepaymentLots: 5, marginTodayBalanceLots: 0, marginBalanceChangeLots: -105 }),
    row("2026-07-04", { close: 70, marginYesterdayBalanceLots: 0, marginBuyLots: 10, marginTodayBalanceLots: 10, marginBalanceChangeLots: 10 }),
  ]);

  assert.equal(result[0].status, "seeded");
  assert.equal(result[0].estimatedCostPrice, 50);
  assert.equal(result[0].formulaVersion, ESTIMATED_MARGIN_FORMULA_VERSION);
  assert.equal(result[1].status, "available");
  assert.equal(result[1].estimatedCostPrice, 51.666667);
  assert.equal(result[2].status, "empty");
  assert.equal(result[2].estimatedCostPrice, null);
  assert.equal(result[3].status, "seeded");
  assert.equal(result[3].estimatedCostPrice, 70);
});

test("流量不平保留 gap，後續可核對交易日以收盤價重新起算", () => {
  const result = calculateEstimatedMarginMetrics([
    row("2026-07-01", { marginTodayBalanceLots: 100 }),
    row("2026-07-02", { marginYesterdayBalanceLots: 100, marginBuyLots: 10, marginTodayBalanceLots: 120 }),
    row("2026-07-03", { close: 55, marginYesterdayBalanceLots: 120, marginBuyLots: 5, marginTodayBalanceLots: 125 }),
    row("2026-07-04", { close: 60, marginYesterdayBalanceLots: 125, marginBuyLots: 5, marginTodayBalanceLots: 130 }),
  ]);
  assert.equal(result[1].status, "partial");
  assert.equal(result[1].reasonCode, "balance_mismatch");
  assert.equal(result[1].estimatedCostPrice, null);
  assert.equal(result[2].status, "reseeded");
  assert.equal(result[2].reasonCode, "reseeded");
  assert.equal(result[2].estimatedCostPrice, 55);
  assert.equal(result[2].seeded, false);
  assert.equal(result[2].reseeded, true);
  assert.equal(result[3].status, "available");
  assert.equal(result[3].estimatedCostPrice, 55.192308);
});

test("估算維持率固定採 60% 模型參數並揭露來源", () => {
  const available = calculateEstimatedMarginMetrics([
    row("2026-07-01", { close: 60, marginTodayBalanceLots: 100 }),
  ])[0];
  assert.equal(available.estimatedMaintenancePercent, 166.666667);
  assert.equal(available.marginLoanRatioPercent, ESTIMATED_MARGIN_MODEL_LOAN_RATIO_PERCENT);
  assert.equal(available.marginLoanRatioSource, ESTIMATED_MARGIN_MODEL_LOAN_RATIO_SOURCE);
  assert.equal(available.marginLoanRatioSourceDate, "2026-07-01");
  assert.equal(available.maintenanceReasonCode, "available");
});

test("缺少估算成本時維持率不得沿用前值", () => {
  const result = calculateEstimatedMarginMetrics([
    row("2026-07-01", { close: 60, marginTodayBalanceLots: 100 }),
    row("2026-07-02", { close: 61, marginYesterdayBalanceLots: 100, marginBuyLots: 10, marginTodayBalanceLots: 120 }),
  ]);
  assert.equal(result[0].estimatedMaintenancePercent, 166.666667);
  assert.equal(result[1].estimatedMaintenancePercent, null);
  assert.equal(result[1].maintenanceReasonCode, "missing_estimated_cost");
});
