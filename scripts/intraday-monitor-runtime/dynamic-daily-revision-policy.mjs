import { createHash } from 'node:crypto';

import { canonicalJson } from '../smart-order-runtime/canonical-json.mjs';
import { dynamicDailyConfigHash,
    validateDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';

export const DYNAMIC_DAILY_REVISION_POLICY_SCHEMA = 'intraday-monitor-daily-revision-policy/1';
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function eligible(item) {
    return item.enabled === true && /^(?!00)\d{4}$/.test(item.contract?.code ?? '') &&
        ['TSE', 'OTC'].includes(item.contract?.exchange);
}

function symbol(item) {
    return item.contract?.canonicalSymbol ??
        `${item.contract?.code}.${item.contract?.exchange === 'TSE' ? 'TW' : 'TWO'}`;
}

export function resolveDynamicDailyRevisionPolicy({ plan, savedConfig, savedAt,
    nextApplicableTradeDate = null, currentPlanSealed = false } = {}) {
    if (!validateDynamicDailyCohortPlan(plan) ||
        !Number.isSafeInteger(savedConfig?.revision) || savedConfig.revision < plan.configRevision ||
        !Array.isArray(savedConfig.items) || savedConfig.items.length > 200 ||
        !INSTANT.test(savedAt ?? '') || !Number.isFinite(Date.parse(savedAt)) ||
        (nextApplicableTradeDate !== null &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(nextApplicableTradeDate) ||
                nextApplicableTradeDate <= plan.tradeDate))) {
        throw new TypeError('daily_revision_policy_input_invalid');
    }
    const savedHash = dynamicDailyConfigHash(savedConfig);
    if (savedConfig.revision === plan.configRevision && savedHash !== plan.configHash) {
        throw new TypeError('daily_revision_config_hash_mismatch');
    }
    const planned = plan.selected.map((entry) => entry.canonicalSymbol);
    const eligibleItems = savedConfig.items.filter(eligible);
    const desired = eligibleItems.slice(0, 160).map(symbol);
    const desiredSet = new Set(desired);
    const plannedSet = new Set(planned);
    const configuredBySymbol = new Map(savedConfig.items.map((item) => [symbol(item), item]));
    const removedOrDisabled = planned.filter((item) =>
        !configuredBySymbol.has(item) || configuredBySymbol.get(item).enabled !== true);
    const displacedByCapacity = planned.filter((item) =>
        !desiredSet.has(item) && !removedOrDisabled.includes(item));
    const added = desired.filter((item) => !plannedSet.has(item));
    const waiting = eligibleItems.slice(160).map(symbol);
    const changed = savedConfig.revision !== plan.configRevision;
    const beforeCutoff = Date.parse(savedAt) < Date.parse(`${plan.tradeDate}T08:35:00+08:00`);
    const afterPreviousClose = Date.parse(savedAt) >=
        Date.parse(`${plan.previousTradeDate}T13:34:30+08:00`);
    const sameDayDeltaAllowed = changed && !currentPlanSealed && beforeCutoff && afterPreviousClose;
    const decision = !changed ? 'same_revision' : sameDayDeltaAllowed ?
        'awaiting_premarket_delta' : nextApplicableTradeDate ?
            'pending_next_trade_date' : 'pending_official_trade_date';
    const body = { schemaVersion: DYNAMIC_DAILY_REVISION_POLICY_SCHEMA,
        planHash: plan.planHash, planTradeDate: plan.tradeDate,
        planRevision: plan.configRevision, savedRevision: savedConfig.revision,
        savedAt, currentPlanSealed: currentPlanSealed === true,
        decision, effectiveTradeDate: !changed ? plan.tradeDate :
            sameDayDeltaAllowed ? plan.tradeDate : nextApplicableTradeDate,
        plannedCount: planned.length, desiredCount: desired.length,
        waitingCapacityCount: waiting.length,
        added, removedOrDisabled, displacedByCapacity,
        waitingCapacity: waiting,
        requiresOldPlanConfirmation: changed && removedOrDisabled.length > 0 &&
            !sameDayDeltaAllowed,
        oldPlanStillEffective: changed && !sameDayDeltaAllowed,
        subscriptionRotationAllowed: false,
        notificationAuthority: false, brokerWriteAuthority: false };
    const policyHash = createHash('sha256').update(canonicalJson(body)).digest('hex');
    return Object.freeze({ ...body, policyHash });
}

// 若已封存當日名單，使用者可明示保留舊 plan，或只暫停被刪／停用檔的比較與通知。
// 兩者都不改寫當日 plan，也不換訂閱；真正 UI 保存決策時需另留 append-only 稽核。
export function decideDynamicDailyOldPlanConflict(policy, { policyHash,
    choice, confirmed } = {}) {
    if (policy?.schemaVersion !== DYNAMIC_DAILY_REVISION_POLICY_SCHEMA ||
        policy.requiresOldPlanConfirmation !== true ||
        policy.policyHash !== policyHash || confirmed !== true ||
        !['keep_old_plan', 'suppress_removed'].includes(choice)) {
        throw new TypeError('daily_old_plan_confirmation_invalid');
    }
    return Object.freeze({ planHash: policy.planHash,
        savedRevision: policy.savedRevision, choice,
        suppressedSymbols: choice === 'suppress_removed' ?
            Object.freeze([...policy.removedOrDisabled]) : Object.freeze([]),
        pendingEffectiveTradeDate: policy.effectiveTradeDate,
        planRewritten: false, subscriptionRotated: false,
        comparisonAuthorityForSuppressed: false,
        notificationAuthorityForSuppressed: false });
}
