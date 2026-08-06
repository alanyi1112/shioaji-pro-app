export const ESTIMATED_MARGIN_FORMULA_VERSION = "estimated-margin-v2";
export const ESTIMATED_MARGIN_MODEL_LOAN_RATIO_PERCENT = 60;
export const ESTIMATED_MARGIN_MODEL_LOAN_RATIO_SOURCE = "fixed-60-percent-estimate-model";

export type EstimatedMarginInput = {
  sessionDate: string;
  close: number | null;
  marginBuyLots: number | null;
  marginSellLots: number | null;
  marginCashRepaymentLots: number | null;
  marginYesterdayBalanceLots: number | null;
  marginTodayBalanceLots: number | null;
  marginBalanceChangeLots: number | null;
};

export type EstimatedMarginResult = {
  sessionDate: string;
  estimatedCostPrice: number | null;
  estimatedMaintenancePercent: number | null;
  marginLoanRatioPercent: number | null;
  marginLoanRatioSource: string | null;
  marginLoanRatioSourceDate: string | null;
  marginBalanceChangeLots: number | null;
  close: number | null;
  seeded: boolean;
  reseeded: boolean;
  status: "available" | "seeded" | "reseeded" | "empty" | "partial" | "unavailable";
  reasonCode: "available" | "seeded" | "reseeded" | "zero_balance" | "missing_close" | "missing_margin_input" | "balance_mismatch" | "cost_chain_interrupted";
  maintenanceReasonCode: "available" | "missing_close" | "missing_estimated_cost";
  formulaVersion: string;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validNonNegative = (value: unknown): value is number => finite(value) && value >= 0;
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function maintenanceFor(input: EstimatedMarginInput, estimatedCostPrice: number | null) {
  if (!finite(input.close) || input.close <= 0) return { value: null, reason: "missing_close" as const };
  if (!finite(estimatedCostPrice) || estimatedCostPrice <= 0) return { value: null, reason: "missing_estimated_cost" as const };
  return {
    value: round(input.close / (estimatedCostPrice * (ESTIMATED_MARGIN_MODEL_LOAN_RATIO_PERCENT / 100)) * 100),
    reason: "available" as const,
  };
}

export function calculateEstimatedMarginMetrics(rows: EstimatedMarginInput[], balanceToleranceLots = 0.001): EstimatedMarginResult[] {
  const ordered = [...rows].sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
  let previousBalance: number | null = null;
  let previousCost: number | null = null;
  let reseedPending = false;
  return ordered.map((input) => {
    const close = finite(input.close) && input.close > 0 ? input.close : null;
    const balance = validNonNegative(input.marginTodayBalanceLots) ? input.marginTodayBalanceLots : null;
    const marginBalanceChangeLots = finite(input.marginBalanceChangeLots) ? input.marginBalanceChangeLots : null;
    let estimatedCostPrice: number | null = null;
    let seeded = false;
    let reseeded = false;
    let status: EstimatedMarginResult["status"] = "unavailable";
    let reasonCode: EstimatedMarginResult["reasonCode"] = close === null ? "missing_close" : "missing_margin_input";

    if (balance !== null && close !== null) {
      if (balance === 0) {
        status = "empty";
        reasonCode = "zero_balance";
        previousBalance = 0;
        previousCost = null;
        reseedPending = false;
      } else if (previousBalance === null || previousBalance === 0) {
        estimatedCostPrice = round(close);
        seeded = true;
        status = "seeded";
        reasonCode = "seeded";
        previousBalance = balance;
        previousCost = estimatedCostPrice;
        reseedPending = false;
      } else {
        const buy = input.marginBuyLots;
        const sell = input.marginSellLots;
        const repayment = input.marginCashRepaymentLots;
        const yesterday = input.marginYesterdayBalanceLots;
        const inputsValid = [buy, sell, repayment, yesterday].every(validNonNegative);
        if (!inputsValid) {
          status = "partial";
          reasonCode = "missing_margin_input";
          previousBalance = balance;
          previousCost = null;
          reseedPending = true;
        } else if (Math.abs((yesterday as number) - previousBalance) > balanceToleranceLots
          || Math.abs(previousBalance + (buy as number) - (sell as number) - (repayment as number) - balance) > balanceToleranceLots) {
          status = "partial";
          reasonCode = "balance_mismatch";
          previousBalance = balance;
          previousCost = null;
          reseedPending = true;
        } else if (reseedPending) {
          estimatedCostPrice = round(close);
          reseeded = true;
          status = "reseeded";
          reasonCode = "reseeded";
          previousBalance = balance;
          previousCost = estimatedCostPrice;
          reseedPending = false;
        } else if (!finite(previousCost) || previousCost <= 0) {
          status = "partial";
          reasonCode = "cost_chain_interrupted";
          previousBalance = balance;
          previousCost = null;
        } else {
          const boughtBalance = previousBalance + (buy as number);
          if (boughtBalance <= 0) {
            status = "partial";
            reasonCode = "balance_mismatch";
            previousBalance = balance;
            previousCost = null;
            reseedPending = true;
          } else {
            estimatedCostPrice = round((previousBalance * previousCost + (buy as number) * close) / boughtBalance);
            status = "available";
            reasonCode = "available";
            previousBalance = balance;
            previousCost = estimatedCostPrice;
          }
        }
      }
    } else {
      previousBalance = balance;
      previousCost = null;
      reseedPending = balance !== null && balance > 0;
    }

    const maintenance = maintenanceFor(input, estimatedCostPrice);
    return {
      sessionDate: input.sessionDate,
      estimatedCostPrice,
      estimatedMaintenancePercent: maintenance.value,
      marginLoanRatioPercent: ESTIMATED_MARGIN_MODEL_LOAN_RATIO_PERCENT,
      marginLoanRatioSource: ESTIMATED_MARGIN_MODEL_LOAN_RATIO_SOURCE,
      marginLoanRatioSourceDate: input.sessionDate,
      marginBalanceChangeLots,
      close,
      seeded,
      reseeded,
      status,
      reasonCode,
      maintenanceReasonCode: maintenance.reason,
      formulaVersion: ESTIMATED_MARGIN_FORMULA_VERSION,
    };
  });
}
