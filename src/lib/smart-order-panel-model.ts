import type {
    BrowserCanonicalDistanceDefinition,
    BrowserSmartOrderCanonicalDraft,
} from './smart-order-browser-draft';

type StrategyDefinition = BrowserSmartOrderCanonicalDraft;
export type QuoteConditionField =
    | 'last_price'
    | 'bid_price'
    | 'ask_price'
    | 'up_amount'
    | 'down_amount'
    | 'up_percent'
    | 'down_percent'
    | 'tick_quantity'
    | 'total_quantity';

export type CanonicalValidityWindow = Readonly<{
    startDate: string;
    endDate: string;
    calendarVersion: string;
}>;

export type CanonicalOrderSpecification = Readonly<{
    contractKey: string;
    side: 'Buy' | 'Sell';
    orderCond: 'Cash';
    orderLot: 'Common';
    baseShares: string;
    commonLots: string;
    contractUnit: string;
    priceType: 'LMT' | 'MKT';
    limitPrice: string | null;
    timeInForce: 'ROD' | 'IOC';
    policyRevision: string;
}>;

export type SmartOrderActiveListBucket = 'monitoring' | 'processing';

const MONITORING_STATES = new Set(['observing', 'monitoring', 'paused']);

/**
 * Active-list snapshots never become history on the browser's say-so. Only the
 * dedicated Runtime history projection is allowed to populate the history tab.
 * Unknown or unexpectedly terminal-looking active snapshots therefore stay in
 * processing until Runtime resolves every broker side effect and local duty.
 */
export function smartOrderActiveListBucket(
    state: string,
    runtimeDisplayState?: string,
): SmartOrderActiveListBucket {
    const effectiveState = runtimeDisplayState ?? state;
    return MONITORING_STATES.has(state) &&
        MONITORING_STATES.has(effectiveState)
        ? 'monitoring'
        : 'processing';
}

export function smartOrderRuntimeDisplayState(
    strategyState: string,
    activity: Readonly<{ displayState: string }> | undefined,
): string {
    return activity?.displayState ?? strategyState;
}

const ACTIVITY_STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
    candidate: '觀察候選',
    entry_dispatching: '進場送出處理中',
    waiting_entry_result: '等待進場結果',
    materializing: '建立保護中',
    pending_entry: '等待進場結果',
    pending_entry_fill: '等待進場成交',
    exit_dispatching: '出場送出處理中',
    exit_working: '出場委託未成交',
    partially_exited: '部分出場',
    safety_blocked: '安全封鎖',
    reserved: '曝險已保留',
    monitoring_reserved: '監控量已保留',
    intent_reserved: '出場意圖已保留',
    broker_working: '券商委託未成交',
    open: '人工處理未結',
});

export function smartOrderActivityStateLabel(state: string): string {
    return (
        ACTIVITY_STATE_LABELS[state] ?? smartOrderStatePresentation(state).label
    );
}

export interface SmartOrderStatePresentation {
    readonly label: string;
    readonly detail: string;
    readonly highRisk: boolean;
}

const STATE_PRESENTATIONS: Readonly<
    Record<string, SmartOrderStatePresentation>
> = Object.freeze({
    draft: {
        label: '草稿',
        detail: '只保存在 Runtime；尚未啟用監控，也沒有 broker 委託權限。',
        highRisk: false,
    },
    observing: {
        label: '觀察中',
        detail: 'Runtime 正在觀察條件；條件成立不等於成交。',
        highRisk: false,
    },
    monitoring: {
        label: '監控中',
        detail: 'Runtime 正在監控；以 Runtime 快照為唯一 active 狀態來源。',
        highRisk: false,
    },
    paused: {
        label: '已暫停',
        detail: '停止新的 activation；既有 broker 委託或本機義務不會因此取消。',
        highRisk: false,
    },
    triggered: {
        label: '條件已觸發',
        detail: '條件成立；尚不能解讀為已送單、broker 已接受或已成交。',
        highRisk: false,
    },
    prepared: {
        label: '已準備・尚未送出',
        detail: '本機意圖已保存；使用者重新確認與 Runtime 授權前不得送出。',
        highRisk: false,
    },
    pending_entry_fill: {
        label: '等待進場成交',
        detail: '進場委託尚未有完整成交證據；正式保護量與觸發價尚未建立。',
        highRisk: true,
    },
    dispatching: {
        label: '送出處理中',
        detail: 'broker 結果尚未確定；不得重送或顯示成交。',
        highRisk: true,
    },
    acknowledged: {
        label: 'broker 已回應・待對帳',
        detail: '回應不等於成交；仍須以 broker evidence 完成對帳。',
        highRisk: false,
    },
    pending_submit: {
        label: '送出中',
        detail: 'PendingSubmit；尚未證明 broker 正式接受或成交。',
        highRisk: false,
    },
    pre_submitted: {
        label: '預受理・未成交',
        detail: 'PreSubmitted；尚未成交。',
        highRisk: false,
    },
    submitted: {
        label: '已委託・未成交',
        detail: 'broker 已受理，但成交量仍須由 broker evidence 確認。',
        highRisk: false,
    },
    accepted: {
        label: 'broker 已接受・未成交',
        detail: '接受不等於成交；仍在處理中。',
        highRisk: false,
    },
    working: {
        label: '已委託・未成交',
        detail: '仍有 working broker order，不能進歷程。',
        highRisk: false,
    },
    part_filled: {
        label: '部分成交',
        detail: '只確認部分成交；剩餘量與保護義務仍須對帳。',
        highRisk: true,
    },
    filled: {
        label: '成交待結案',
        detail: '單層成交不代表整體策略與本機義務皆已終結。',
        highRisk: false,
    },
    unfilled: {
        label: '未成交待結案',
        detail: '未成交 remainder 與義務尚待 Runtime 結案。',
        highRisk: false,
    },
    unknown: {
        label: '結果未知',
        detail: '可能已有 broker side effect；禁止自動重送，必須先對帳。',
        highRisk: true,
    },
    reconciling: {
        label: '對帳中',
        detail: 'Runtime 正在以固定帳號 broker evidence 對帳。',
        highRisk: true,
    },
    recovery: {
        label: '復原中',
        detail: 'Runtime 尚未恢復 write readiness；不得自動送出。',
        highRisk: true,
    },
    manual_intervention: {
        label: '待人工處理',
        detail: '只能依 reason-specific evidence 處理；一般 resume 無權解除。',
        highRisk: true,
    },
    cancel_pending: {
        label: '取消處理中',
        detail: '取消策略不等於 broker 委託已取消，仍須等待最終證據。',
        highRisk: true,
    },
    expired_with_obligation: {
        label: '已到期・義務未結',
        detail: '停止新 activation，但 working／unknown／保護義務仍在處理中。',
        highRisk: true,
    },
    unprotected: {
        label: '未受保護',
        detail: '存在 Runtime 追蹤的未受保護量；需立即核對券商狀態。',
        highRisk: true,
    },
    completed: {
        label: '完成待歷程確認',
        detail: 'active 快照不可自行進歷程；等待 Runtime terminal history projection。',
        highRisk: false,
    },
    cancelled: {
        label: '取消待歷程確認',
        detail: 'active 快照不可自行進歷程；等待 Runtime terminal history projection。',
        highRisk: false,
    },
    expired: {
        label: '到期待歷程確認',
        detail: 'active 快照不可自行進歷程；等待 Runtime terminal history projection。',
        highRisk: false,
    },
    failed: {
        label: '失敗待結案',
        detail: '失敗不保證 broker side effect 與本機義務皆已終結。',
        highRisk: true,
    },
    inactive: {
        label: 'Inactive 待結案',
        detail: 'broker Inactive 不等於整體策略完成；仍須對帳。',
        highRisk: true,
    },
});

export function smartOrderStatePresentation(
    state: string,
): SmartOrderStatePresentation {
    return (
        STATE_PRESENTATIONS[state] ?? {
            label: `未識別狀態（${state}）`,
            detail: 'Runtime 回傳了尚未支援的狀態；保守留在處理中並禁止推論成交。',
            highRisk: true,
        }
    );
}

export interface CanonicalTriggerView {
    readonly label: string;
    readonly field: string;
    readonly comparator: 'gte' | 'lte';
    readonly threshold: string;
    readonly revision: string;
    readonly patchKind:
        | 'quote_condition'
        | 'stop_take_leg'
        | 'trailing_activation';
}

export interface CanonicalDraftSharedView {
    readonly definition: StrategyDefinition;
    readonly fixedAccountLabel: string;
    readonly orderLabel: string;
    readonly order: CanonicalOrderSpecification;
    readonly trigger: CanonicalTriggerView | null;
    readonly validity: CanonicalValidityWindow;
    readonly activationPolicy:
        | 'require_rearm'
        | 'immediate_if_true'
        | null;
    readonly stopTakeLegs: readonly CanonicalStopTakeLegEdit[] | null;
    readonly multiOperator: 'AND' | 'OR' | null;
    readonly multiConditions: readonly CanonicalMultiConditionEdit[] | null;
}

export interface CanonicalStopTakeLegEdit {
    readonly type: 'stop' | 'take';
    readonly distance: BrowserCanonicalDistanceDefinition;
}

export interface CanonicalMultiConditionEdit {
    readonly monitorContractKey: string;
    readonly field: QuoteConditionField;
    readonly comparator: 'gte' | 'lte';
    readonly threshold: string;
}

type UnknownRecord = Record<string, unknown>;

const DRAFT_SCHEMA_VERSION = 'realtimestock.smart-order-strategy/v1';
const DRAFT_DECISION_TABLE_VERSION = '2026-08-11.2';
const PAYLOAD_SCHEMA_VERSIONS = Object.freeze({
    quick: 'realtimestock.smart-order-strategy-payload/quick/v1',
    good_till: 'realtimestock.smart-order-strategy-payload/good-till/v1',
    multi_condition:
        'realtimestock.smart-order-strategy-payload/multi-condition/v1',
    parent_child:
        'realtimestock.smart-order-strategy-payload/parent-child/v1',
    stop_take: 'realtimestock.smart-order-strategy-payload/stop-take/v1',
    trailing_exit:
        'realtimestock.smart-order-strategy-payload/trailing-exit/v1',
    scheduled_quantity:
        'realtimestock.smart-order-strategy-payload/scheduled-quantity/v1',
});

function invalidBrowserDraft(message: string): never {
    throw new TypeError(`invalid Runtime canonical draft: ${message}`);
}

function exactRecord(
    value: unknown,
    label: string,
    expectedKeys: readonly string[],
): UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalidBrowserDraft(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return invalidBrowserDraft(`${label} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        return invalidBrowserDraft(`${label} cannot contain symbol fields`);
    }
    const keys = Object.getOwnPropertyNames(value).sort();
    const expected = [...expectedKeys].sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])
    ) {
        return invalidBrowserDraft(
            `${label} must contain exactly ${expected.join(', ')}`,
        );
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
            return invalidBrowserDraft(`${label}.${key} must be plain data`);
        }
    }
    return value as UnknownRecord;
}

function exactArray(
    value: unknown,
    label: string,
    minimumLength: number,
    maximumLength: number,
): readonly unknown[] {
    if (!Array.isArray(value)) {
        return invalidBrowserDraft(`${label} must be an array`);
    }
    if (value.length < minimumLength || value.length > maximumLength) {
        return invalidBrowserDraft(`${label} length is outside the schema`);
    }
    const keys = Object.getOwnPropertyNames(value).filter(
        (key) => key !== 'length',
    );
    if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        return invalidBrowserDraft(`${label} must be a dense array`);
    }
    return value;
}

function requireEnum<Value extends string>(
    value: unknown,
    allowed: readonly Value[],
    label: string,
): Value {
    if (typeof value !== 'string' || !allowed.includes(value as Value)) {
        return invalidBrowserDraft(`${label} is outside the versioned schema`);
    }
    return value as Value;
}

function requireRevision(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)
    ) {
        return invalidBrowserDraft(`${label} is not a canonical revision`);
    }
    return value;
}

function requireContractKey(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        !/^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)
    ) {
        return invalidBrowserDraft(`${label} is not a canonical contract key`);
    }
    return value;
}

const MAX_SIGNED_64_INTEGER_TEXT = '9223372036854775807';

function comparePositiveIntegerText(left: string, right: string): number {
    if (left.length !== right.length) return left.length < right.length ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}

function multiplyPositiveIntegerText(left: string, right: string): string {
    const digits = new Array<number>(left.length + right.length).fill(0);
    for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
        for (
            let rightIndex = right.length - 1;
            rightIndex >= 0;
            rightIndex -= 1
        ) {
            const outputIndex = leftIndex + rightIndex + 1;
            const product =
                Number(left[leftIndex]) * Number(right[rightIndex]) +
                (digits[outputIndex] ?? 0);
            digits[outputIndex] = product % 10;
            digits[outputIndex - 1] =
                (digits[outputIndex - 1] ?? 0) + Math.floor(product / 10);
        }
    }
    const result = digits.join('').replace(/^0+/, '');
    return result || '0';
}

function requirePositiveInteger(value: unknown, label: string): string {
    if (
        typeof value !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(value) ||
        comparePositiveIntegerText(value, MAX_SIGNED_64_INTEGER_TEXT) > 0
    ) {
        return invalidBrowserDraft(`${label} is not a positive integer string`);
    }
    return value;
}

function requireCanonicalDecimal(
    value: unknown,
    label: string,
    positive = false,
): string {
    if (
        typeof value !== 'string' ||
        !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)
    ) {
        return invalidBrowserDraft(`${label} is not a canonical decimal`);
    }
    const [integer = '', fraction = ''] = value.split('.');
    if (
        integer.length > 18 ||
        fraction.length > 18 ||
        (positive && !/[1-9]/.test(value))
    ) {
        return invalidBrowserDraft(`${label} exceeds decimal bounds`);
    }
    return value;
}

function requireIsoDate(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return invalidBrowserDraft(`${label} is not an ISO date`);
    }
    return value;
}

function requireTimeOrNull(
    value: unknown,
    label: string,
    nullable: boolean,
): string | null {
    if (nullable && value === null) return null;
    if (
        typeof value !== 'string' ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
    ) {
        return invalidBrowserDraft(`${label} is not HH:mm:ss`);
    }
    return value;
}

function inspectCondition(value: unknown, label: string): UnknownRecord {
    const condition = exactRecord(value, label, [
        'field',
        'comparator',
        'threshold',
        'mappingRevision',
    ]);
    requireEnum(
        condition.field,
        [
            'last_price',
            'bid_price',
            'ask_price',
            'up_amount',
            'down_amount',
            'up_percent',
            'down_percent',
            'tick_quantity',
            'total_quantity',
        ],
        `${label}.field`,
    );
    requireEnum(condition.comparator, ['gte', 'lte'], `${label}.comparator`);
    requireCanonicalDecimal(condition.threshold, `${label}.threshold`);
    requireRevision(condition.mappingRevision, `${label}.mappingRevision`);
    return condition;
}

function inspectValidity(value: unknown, label: string): UnknownRecord {
    const validity = exactRecord(value, label, [
        'startDate',
        'endDate',
        'calendarVersion',
    ]);
    requireIsoDate(validity.startDate, `${label}.startDate`);
    requireIsoDate(validity.endDate, `${label}.endDate`);
    requireRevision(validity.calendarVersion, `${label}.calendarVersion`);
    return validity;
}

function inspectOrder(value: unknown, label: string): UnknownRecord {
    const order = exactRecord(value, label, [
        'contractKey',
        'side',
        'orderCond',
        'orderLot',
        'baseShares',
        'commonLots',
        'contractUnit',
        'priceType',
        'limitPrice',
        'timeInForce',
        'policyRevision',
    ]);
    requireContractKey(order.contractKey, `${label}.contractKey`);
    requireEnum(order.side, ['Buy', 'Sell'], `${label}.side`);
    requireEnum(order.orderCond, ['Cash'], `${label}.orderCond`);
    requireEnum(order.orderLot, ['Common'], `${label}.orderLot`);
    const baseShares = requirePositiveInteger(
        order.baseShares,
        `${label}.baseShares`,
    );
    const commonLots = requirePositiveInteger(
        order.commonLots,
        `${label}.commonLots`,
    );
    const contractUnit = requirePositiveInteger(
        order.contractUnit,
        `${label}.contractUnit`,
    );
    if (baseShares !== multiplyPositiveIntegerText(commonLots, contractUnit)) {
        return invalidBrowserDraft(`${label} has an inconsistent quantity tuple`);
    }
    const priceType = requireEnum(
        order.priceType,
        ['LMT', 'MKT'],
        `${label}.priceType`,
    );
    if (priceType === 'LMT') {
        requireCanonicalDecimal(order.limitPrice, `${label}.limitPrice`, true);
    } else if (order.limitPrice !== null) {
        return invalidBrowserDraft(`${label}.limitPrice must be null for MKT`);
    }
    const timeInForce = requireEnum(
        order.timeInForce,
        ['ROD', 'IOC'],
        `${label}.timeInForce`,
    );
    if (
        !(
            (priceType === 'LMT' &&
                (timeInForce === 'ROD' || timeInForce === 'IOC')) ||
            (priceType === 'MKT' && timeInForce === 'IOC')
        )
    ) {
        return invalidBrowserDraft(
            `${label} supports only LMT+ROD, LMT+IOC or MKT+IOC`,
        );
    }
    requireRevision(order.policyRevision, `${label}.policyRevision`);
    return order;
}

function inspectDistance(value: unknown, label: string): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalidBrowserDraft(`${label} must be a distance object`);
    }
    const kind = (value as UnknownRecord).kind;
    if (kind === 'absolute') {
        const distance = exactRecord(value, label, ['kind', 'value']);
        requireCanonicalDecimal(distance.value, `${label}.value`, true);
        return;
    }
    if (kind === 'pct_bps') {
        const distance = exactRecord(value, label, ['kind', 'pctBps']);
        if (
            !Number.isSafeInteger(distance.pctBps) ||
            (distance.pctBps as number) < 1 ||
            (distance.pctBps as number) > 9_999
        ) {
            return invalidBrowserDraft(`${label}.pctBps must be 1-9999`);
        }
        return;
    }
    if (kind === 'fixed_atr') {
        const distance = exactRecord(value, label, [
            'kind',
            'atr',
            'multiplier',
            'atrSnapshotRevision',
        ]);
        requireCanonicalDecimal(distance.atr, `${label}.atr`, true);
        requireCanonicalDecimal(
            distance.multiplier,
            `${label}.multiplier`,
            true,
        );
        requireRevision(
            distance.atrSnapshotRevision,
            `${label}.atrSnapshotRevision`,
        );
        return;
    }
    return invalidBrowserDraft(`${label}.kind is outside the schema`);
}

function inspectActivationPolicy(parameters: UnknownRecord, label: string): void {
    requireEnum(
        parameters.activationPolicy,
        ['require_rearm', 'immediate_if_true'],
        `${label}.activationPolicy`,
    );
}

/**
 * Browser-safe display/edit shape guard. The authoritative full parser stays
 * in the Node sidecar and runs again on PUT; it is intentionally not bundled
 * into Safari/WKWebView. This guard only accepts the exact versioned draft
 * surface before exposing shared fields or constructing a draft-only update.
 */
function inspectBrowserCanonicalDraft(input: unknown): StrategyDefinition {
    const definition = exactRecord(input, 'strategy definition', [
        'schemaVersion',
        'decisionTableVersion',
        'kind',
        'parameters',
    ]);
    if (
        definition.schemaVersion !== DRAFT_SCHEMA_VERSION ||
        definition.decisionTableVersion !== DRAFT_DECISION_TABLE_VERSION
    ) {
        return invalidBrowserDraft('schema or decision table version mismatch');
    }
    const kind = requireEnum(
        definition.kind,
        [
            'quick',
            'good_till',
            'multi_condition',
            'parent_child',
            'stop_take',
            'trailing_exit',
            'scheduled_quantity',
        ],
        'strategy definition.kind',
    );
    const label = `${kind} parameters`;

    if (kind === 'quick' || kind === 'good_till') {
        const parameters = exactRecord(
            definition.parameters,
            label,
            kind === 'quick'
                ? [
                      'payloadSchemaVersion',
                      'monitorContractKey',
                      'condition',
                      'order',
                      'validity',
                      'activationPolicy',
                  ]
                : [
                      'payloadSchemaVersion',
                      'monitorContractKey',
                      'condition',
                      'order',
                      'validity',
                      'activationPolicy',
                      'targetBaseShares',
                      'perOrderMaxBaseShares',
                  ],
        );
        if (parameters.payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSIONS[kind]) {
            return invalidBrowserDraft(`${label}.payloadSchemaVersion mismatch`);
        }
        const monitor = requireContractKey(
            parameters.monitorContractKey,
            `${label}.monitorContractKey`,
        );
        inspectCondition(parameters.condition, `${label}.condition`);
        const order = inspectOrder(parameters.order, `${label}.order`);
        if (kind === 'quick' && monitor !== order.contractKey) {
            return invalidBrowserDraft('quick monitor and order contract mismatch');
        }
        inspectValidity(parameters.validity, `${label}.validity`);
        inspectActivationPolicy(parameters, label);
        if (kind === 'good_till') {
            const target = requirePositiveInteger(
                parameters.targetBaseShares,
                `${label}.targetBaseShares`,
            );
            const perOrder = requirePositiveInteger(
                parameters.perOrderMaxBaseShares,
                `${label}.perOrderMaxBaseShares`,
            );
            if (comparePositiveIntegerText(perOrder, target) > 0) {
                return invalidBrowserDraft(`${label} per-order maximum exceeds target`);
            }
        }
    } else if (kind === 'multi_condition') {
        const parameters = exactRecord(definition.parameters, label, [
            'payloadSchemaVersion',
            'conditions',
            'operator',
            'order',
            'validity',
            'activationPolicy',
        ]);
        if (parameters.payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSIONS[kind]) {
            return invalidBrowserDraft(`${label}.payloadSchemaVersion mismatch`);
        }
        exactArray(parameters.conditions, `${label}.conditions`, 1, 7).forEach(
            (entry, index) => {
                const leg = exactRecord(entry, `${label}.conditions[${index}]`, [
                    'monitorContractKey',
                    'condition',
                ]);
                requireContractKey(
                    leg.monitorContractKey,
                    `${label}.conditions[${index}].monitorContractKey`,
                );
                inspectCondition(
                    leg.condition,
                    `${label}.conditions[${index}].condition`,
                );
            },
        );
        requireEnum(parameters.operator, ['AND', 'OR'], `${label}.operator`);
        inspectOrder(parameters.order, `${label}.order`);
        inspectValidity(parameters.validity, `${label}.validity`);
        inspectActivationPolicy(parameters, label);
    } else if (kind === 'parent_child') {
        const parameters = exactRecord(definition.parameters, label, [
            'payloadSchemaVersion',
            'parent',
            'child',
            'parentValidity',
            'activationPolicy',
        ]);
        if (parameters.payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSIONS[kind]) {
            return invalidBrowserDraft(`${label}.payloadSchemaVersion mismatch`);
        }
        const inspectLeg = (name: 'parent' | 'child'): UnknownRecord => {
            const leg = exactRecord(
                parameters[name],
                `${label}.${name}`,
                name === 'parent'
                    ? ['monitorContractKey', 'condition', 'order']
                    : [
                          'monitorContractKey',
                          'condition',
                          'order',
                          'cutoffTime',
                      ],
            );
            const monitor = requireContractKey(
                leg.monitorContractKey,
                `${label}.${name}.monitorContractKey`,
            );
            inspectCondition(leg.condition, `${label}.${name}.condition`);
            const order = inspectOrder(leg.order, `${label}.${name}.order`);
            if (monitor !== order.contractKey) {
                return invalidBrowserDraft(`${label}.${name} contract mismatch`);
            }
            if (name === 'child') {
                requireTimeOrNull(leg.cutoffTime, `${label}.child.cutoffTime`, false);
            }
            return order;
        };
        const parentOrder = inspectLeg('parent');
        const childOrder = inspectLeg('child');
        if (parentOrder.side !== 'Buy' || childOrder.side !== 'Sell') {
            return invalidBrowserDraft(`${label} order sides are unsupported`);
        }
        inspectValidity(parameters.parentValidity, `${label}.parentValidity`);
        inspectActivationPolicy(parameters, label);
    } else if (kind === 'stop_take' || kind === 'trailing_exit') {
        const parameters = exactRecord(
            definition.parameters,
            label,
            kind === 'stop_take'
                ? [
                      'payloadSchemaVersion',
                      'positionContractKey',
                      'monitorContractKey',
                      'positionEvidenceRevision',
                      'basisPrice',
                      'basisSource',
                      'legs',
                      'order',
                      'validity',
                      'activationPolicy',
                  ]
                : [
                      'payloadSchemaVersion',
                      'positionContractKey',
                      'monitorContractKey',
                      'positionEvidenceRevision',
                      'positionCost',
                      'activationPrice',
                      'retracement',
                      'fixedStopPrice',
                      'order',
                      'validity',
                      'activationPolicy',
                  ],
        );
        if (parameters.payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSIONS[kind]) {
            return invalidBrowserDraft(`${label}.payloadSchemaVersion mismatch`);
        }
        const position = requireContractKey(
            parameters.positionContractKey,
            `${label}.positionContractKey`,
        );
        const monitor = requireContractKey(
            parameters.monitorContractKey,
            `${label}.monitorContractKey`,
        );
        requireRevision(
            parameters.positionEvidenceRevision,
            `${label}.positionEvidenceRevision`,
        );
        const order = inspectOrder(parameters.order, `${label}.order`);
        if (
            position !== monitor ||
            position !== order.contractKey ||
            order.side !== 'Sell'
        ) {
            return invalidBrowserDraft(`${label} contract or side mismatch`);
        }
        if (kind === 'stop_take') {
            requireCanonicalDecimal(parameters.basisPrice, `${label}.basisPrice`, true);
            requireEnum(
                parameters.basisSource,
                ['broker_average_cost', 'user_specified'],
                `${label}.basisSource`,
            );
            const legIds = new Set<string>();
            const legTypes = new Set<string>();
            exactArray(parameters.legs, `${label}.legs`, 1, 2).forEach(
                (entry, index) => {
                    const leg = exactRecord(entry, `${label}.legs[${index}]`, [
                        'legId',
                        'type',
                        'distance',
                        'triggerPrice',
                        'triggerTicks',
                    ]);
                    const legId = requireRevision(
                        leg.legId,
                        `${label}.legs[${index}].legId`,
                    );
                    const legType = requireEnum(
                        leg.type,
                        ['stop', 'take'],
                        `${label}.legs[${index}].type`,
                    );
                    if (legIds.has(legId) || legTypes.has(legType)) {
                        return invalidBrowserDraft(`${label}.legs must be unique`);
                    }
                    legIds.add(legId);
                    legTypes.add(legType);
                    inspectDistance(
                        leg.distance,
                        `${label}.legs[${index}].distance`,
                    );
                    requireCanonicalDecimal(
                        leg.triggerPrice,
                        `${label}.legs[${index}].triggerPrice`,
                        true,
                    );
                    requirePositiveInteger(
                        leg.triggerTicks,
                        `${label}.legs[${index}].triggerTicks`,
                    );
                },
            );
        } else {
            requireCanonicalDecimal(
                parameters.positionCost,
                `${label}.positionCost`,
                true,
            );
            requireCanonicalDecimal(
                parameters.activationPrice,
                `${label}.activationPrice`,
                true,
            );
            inspectDistance(parameters.retracement, `${label}.retracement`);
            if (parameters.fixedStopPrice !== null) {
                requireCanonicalDecimal(
                    parameters.fixedStopPrice,
                    `${label}.fixedStopPrice`,
                    true,
                );
            }
        }
        inspectValidity(parameters.validity, `${label}.validity`);
        inspectActivationPolicy(parameters, label);
    } else {
        const parameters = exactRecord(definition.parameters, label, [
            'payloadSchemaVersion',
            'mode',
            'order',
            'validity',
            'targetBaseShares',
            'startTime',
            'endTime',
            'intervalSeconds',
            'perOrderBaseShares',
            'algorithmStatus',
        ]);
        if (parameters.payloadSchemaVersion !== PAYLOAD_SCHEMA_VERSIONS[kind]) {
            return invalidBrowserDraft(`${label}.payloadSchemaVersion mismatch`);
        }
        requireEnum(parameters.mode, ['timed', 'quantity'], `${label}.mode`);
        inspectOrder(parameters.order, `${label}.order`);
        inspectValidity(parameters.validity, `${label}.validity`);
        requirePositiveInteger(
            parameters.targetBaseShares,
            `${label}.targetBaseShares`,
        );
        requireTimeOrNull(parameters.startTime, `${label}.startTime`, false);
        requireTimeOrNull(parameters.endTime, `${label}.endTime`, true);
        if (
            !Number.isSafeInteger(parameters.intervalSeconds) ||
            (parameters.intervalSeconds as number) <= 0
        ) {
            return invalidBrowserDraft(`${label}.intervalSeconds is invalid`);
        }
        if (parameters.perOrderBaseShares !== null) {
            requirePositiveInteger(
                parameters.perOrderBaseShares,
                `${label}.perOrderBaseShares`,
            );
        }
        requireEnum(
            parameters.algorithmStatus,
            ['disabled_unverified'],
            `${label}.algorithmStatus`,
        );
    }
    return input as StrategyDefinition;
}

function primaryOrder(
    definition: StrategyDefinition,
): Readonly<{ label: string; order: CanonicalOrderSpecification }> {
    switch (definition.kind) {
        case 'parent_child':
            return { label: '母單委託', order: definition.parameters.parent.order };
        default:
            return { label: '委託', order: definition.parameters.order };
    }
}

function primaryTrigger(
    definition: StrategyDefinition,
): CanonicalTriggerView | null {
    switch (definition.kind) {
        case 'quick':
        case 'good_till':
            return {
                label: '主要觸發條件',
                ...definition.parameters.condition,
                revision: definition.parameters.condition.mappingRevision,
                patchKind: 'quote_condition',
            };
        case 'multi_condition': {
            const first = definition.parameters.conditions[0];
            if (!first) return null;
            return {
                label: `第 1 個條件（共 ${definition.parameters.conditions.length} 個）`,
                ...first.condition,
                revision: first.condition.mappingRevision,
                patchKind: 'quote_condition',
            };
        }
        case 'parent_child':
            return {
                label: '母單觸發條件',
                ...definition.parameters.parent.condition,
                revision:
                    definition.parameters.parent.condition.mappingRevision,
                patchKind: 'quote_condition',
            };
        case 'stop_take': {
            const first = definition.parameters.legs[0];
            if (!first) return null;
            return {
                label: first.type === 'stop' ? '第 1 個停損觸發' : '第 1 個停利觸發',
                field: 'eligible_last_trade',
                comparator: first.type === 'stop' ? 'lte' : 'gte',
                threshold: first.triggerPrice,
                revision: definition.parameters.positionEvidenceRevision,
                patchKind: 'stop_take_leg',
            };
        }
        case 'trailing_exit':
            return {
                label: '移動出場啟動門檻',
                field: 'eligible_last_trade',
                comparator: 'gte',
                threshold: definition.parameters.activationPrice,
                revision: definition.parameters.positionEvidenceRevision,
                patchKind: 'trailing_activation',
            };
        case 'scheduled_quantity':
            return null;
    }
}

function sharedValidity(
    definition: StrategyDefinition,
): CanonicalValidityWindow {
    return definition.kind === 'parent_child'
        ? definition.parameters.parentValidity
        : definition.parameters.validity;
}

export function canonicalDraftSharedView(
    value: unknown,
    accountBound: boolean,
): CanonicalDraftSharedView | null {
    let definition: StrategyDefinition;
    try {
        definition = inspectBrowserCanonicalDraft(value);
    } catch {
        return null;
    }
    const order = primaryOrder(definition);
    return Object.freeze({
        definition,
        fixedAccountLabel: accountBound
            ? '已由 Runtime 固定（帳號識別不輸出）'
            : '待 Runtime canonical confirmation 固定',
        orderLabel: order.label,
        order: order.order,
        trigger: primaryTrigger(definition),
        validity: sharedValidity(definition),
        activationPolicy:
            definition.kind === 'scheduled_quantity'
                ? null
                : definition.parameters.activationPolicy,
        stopTakeLegs:
            definition.kind === 'stop_take'
                ? Object.freeze(
                      definition.parameters.legs.map((leg) =>
                          Object.freeze({
                              type: leg.type,
                              distance: Object.freeze({ ...leg.distance }),
                          }),
                      ),
                  )
                : null,
        multiOperator:
            definition.kind === 'multi_condition'
                ? definition.parameters.operator
                : null,
        multiConditions:
            definition.kind === 'multi_condition'
                ? Object.freeze(
                      definition.parameters.conditions.map((entry) =>
                          Object.freeze({
                              monitorContractKey: entry.monitorContractKey,
                              field: entry.condition.field,
                              comparator: entry.condition.comparator,
                              threshold: entry.condition.threshold,
                          }),
                      ),
                  )
                : null,
    });
}

export interface CanonicalDraftSharedEdits {
    readonly commonLots: string;
    readonly triggerField: QuoteConditionField | null;
    readonly triggerComparator: 'gte' | 'lte' | null;
    readonly triggerThreshold: string | null;
    readonly activationPolicy: 'require_rearm' | 'immediate_if_true' | null;
    readonly limitPrice: string | null;
    readonly startDate: string;
    readonly endDate: string;
    readonly stopTakeLegs?: readonly CanonicalStopTakeLegEdit[] | null;
    readonly multiOperator?: 'AND' | 'OR' | null;
    readonly multiConditions?: readonly CanonicalMultiConditionEdit[] | null;
}

type MutableRecord = Record<string, unknown>;

function mutablePrimaryOrder(definition: MutableRecord): MutableRecord {
    const parameters = definition.parameters as MutableRecord;
    if (definition.kind === 'parent_child') {
        return (parameters.parent as MutableRecord).order as MutableRecord;
    }
    return parameters.order as MutableRecord;
}

function patchTrigger(
    definition: MutableRecord,
    view: CanonicalDraftSharedView,
    field: QuoteConditionField | null,
    comparator: 'gte' | 'lte' | null,
    threshold: string,
): void {
    const parameters = definition.parameters as MutableRecord;
    switch (view.trigger?.patchKind) {
        case 'quote_condition':
            if (definition.kind === 'quick') {
                if (field === null || comparator === null) {
                    throw new TypeError('quick condition field and comparator are required');
                }
                const condition = parameters.condition as MutableRecord;
                condition.field = field;
                condition.comparator = comparator;
            }
            if (definition.kind === 'multi_condition') {
                const first = (parameters.conditions as MutableRecord[])[0];
                if (!first) {
                    throw new TypeError(
                        'multi_condition requires a primary condition',
                    );
                }
                (first.condition as MutableRecord).threshold = threshold;
            } else if (definition.kind === 'parent_child') {
                const parent = parameters.parent as MutableRecord;
                (parent.condition as MutableRecord).threshold = threshold;
            } else {
                (parameters.condition as MutableRecord).threshold = threshold;
            }
            break;
        case 'stop_take_leg': {
            const first = (parameters.legs as MutableRecord[])[0];
            if (!first) {
                throw new TypeError('stop_take requires a primary leg');
            }
            first.triggerPrice = threshold;
            break;
        }
        case 'trailing_activation':
            parameters.activationPrice = threshold;
            break;
        default:
            break;
    }
}

/**
 * Applies only the shared, already-versioned draft fields. It never invents an
 * account, contract unit, order class, trigger source, policy, or feature gate.
 * The complete definition is reparsed at the domain boundary before it can be
 * sent to the draft-only update API.
 */
export function applyCanonicalDraftSharedEdits(
    view: CanonicalDraftSharedView,
    edits: CanonicalDraftSharedEdits,
): StrategyDefinition {
    const mutable = JSON.parse(JSON.stringify(view.definition)) as MutableRecord;
    const order = mutablePrimaryOrder(mutable);
    if (!/^[1-9]\d{0,18}$/.test(edits.commonLots)) {
        throw new TypeError('commonLots must be a positive canonical integer');
    }
    const baseShares = multiplyPositiveIntegerText(
        edits.commonLots,
        String(order.contractUnit),
    );
    if (comparePositiveIntegerText(baseShares, MAX_SIGNED_64_INTEGER_TEXT) > 0) {
        throw new TypeError('baseShares exceeds the signed 64-bit boundary');
    }
    order.commonLots = edits.commonLots;
    order.baseShares = baseShares;
    if (order.priceType === 'LMT') {
        order.limitPrice = edits.limitPrice;
    }
    const parameters = mutable.parameters as MutableRecord;
    const validity =
        mutable.kind === 'parent_child'
            ? (parameters.parentValidity as MutableRecord)
            : (parameters.validity as MutableRecord);
    validity.startDate = edits.startDate;
    validity.endDate = edits.endDate;
    if (view.trigger && edits.triggerThreshold !== null) {
        patchTrigger(
            mutable,
            view,
            edits.triggerField,
            edits.triggerComparator,
            edits.triggerThreshold,
        );
    }
    if (mutable.kind === 'quick') {
        if (edits.activationPolicy === null) {
            throw new TypeError('quick activation policy is required');
        }
        parameters.activationPolicy = edits.activationPolicy;
    }
    if (mutable.kind === 'multi_condition') {
        if (
            edits.activationPolicy === null ||
            edits.activationPolicy === undefined ||
            edits.multiOperator === null ||
            edits.multiOperator === undefined ||
            edits.multiConditions === null ||
            edits.multiConditions === undefined ||
            edits.multiConditions.length < 1 ||
            edits.multiConditions.length > 7
        ) {
            throw new TypeError(
                'multi_condition requires one to seven conditions, an operator, and an activation policy',
            );
        }
        parameters.operator = edits.multiOperator;
        parameters.activationPolicy = edits.activationPolicy;
        const currentConditions = parameters.conditions as MutableRecord[];
        parameters.conditions = edits.multiConditions.map((entry, index) => ({
            monitorContractKey: entry.monitorContractKey,
            condition: {
                field: entry.field,
                comparator: entry.comparator,
                threshold: entry.threshold,
                mappingRevision: (
                    (currentConditions[index] ?? currentConditions[0])
                        ?.condition as MutableRecord | undefined
                )?.mappingRevision,
            },
        }));
    }
    if (mutable.kind === 'stop_take' && edits.stopTakeLegs !== undefined) {
        if (
            edits.stopTakeLegs === null ||
            edits.stopTakeLegs.length < 1 ||
            edits.stopTakeLegs.length > 2 ||
            new Set(edits.stopTakeLegs.map((leg) => leg.type)).size !==
                edits.stopTakeLegs.length
        ) {
            throw new TypeError('stop_take requires one stop/take leg of each selected type');
        }
        const currentByType = new Map(
            (parameters.legs as MutableRecord[]).map((leg) => [leg.type, leg]),
        );
        parameters.legs = edits.stopTakeLegs.map((leg) => {
            const current = currentByType.get(leg.type);
            return {
                legId: current?.legId ?? `draft-${leg.type}-leg`,
                type: leg.type,
                distance: JSON.parse(JSON.stringify(leg.distance)),
                triggerPrice: current?.triggerPrice ?? '1',
                triggerTicks: current?.triggerTicks ?? '1',
            };
        });
    }
    return inspectBrowserCanonicalDraft(mutable);
}
