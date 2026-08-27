export const SMART_ORDER_CANONICAL_DRAFT_SCHEMA_VERSION =
    'realtimestock.smart-order-strategy/v1';
export const SMART_ORDER_CANONICAL_DRAFT_DECISION_TABLE_VERSION =
    '2026-08-11.2';
export const SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY =
    'TSE:STK:UNSET';

export const SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS =
    Object.freeze({
        quick: 'realtimestock.smart-order-strategy-payload/quick/v1',
        good_till:
            'realtimestock.smart-order-strategy-payload/good-till/v1',
        multi_condition:
            'realtimestock.smart-order-strategy-payload/multi-condition/v1',
        parent_child:
            'realtimestock.smart-order-strategy-payload/parent-child/v1',
        stop_take:
            'realtimestock.smart-order-strategy-payload/stop-take/v1',
        trailing_exit:
            'realtimestock.smart-order-strategy-payload/trailing-exit/v1',
        scheduled_quantity:
            'realtimestock.smart-order-strategy-payload/scheduled-quantity/v1',
    });

export const SMART_ORDER_CANONICAL_DRAFT_KINDS = Object.freeze(
    Object.keys(SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS),
);

const KIND_SET = new Set(SMART_ORDER_CANONICAL_DRAFT_KINDS);
const MAX_SIGNED_64_BIT_INTEGER = 9_223_372_036_854_775_807n;
const CONTRACT_PATTERN =
    /^(?:TSE|OTC):STK:[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WALL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const DRAFT_UNVERIFIED_REVISION = 'draft-unverified';
const TAIPEI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function invalid(message) {
    throw new TypeError(`canonical smart-order draft is invalid: ${message}`);
}

function strictRecord(value, label, expectedKeys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalid(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return invalid(`${label} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        return invalid(`${label} cannot contain symbol fields`);
    }
    const actual = Object.getOwnPropertyNames(value).sort();
    const expected = [...expectedKeys].sort();
    if (
        actual.length !== expected.length ||
        actual.some((key, index) => key !== expected[index])
    ) {
        return invalid(`${label} fields do not match the versioned schema`);
    }
    for (const key of actual) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) {
            return invalid(`${label}.${key} must be an enumerable data field`);
        }
    }
    return value;
}

function strictArray(value, label, minimumLength, maximumLength) {
    if (!Array.isArray(value)) return invalid(`${label} must be an array`);
    if (value.length < minimumLength || value.length > maximumLength) {
        return invalid(`${label} length is outside the versioned schema`);
    }
    const keys = Object.getOwnPropertyNames(value).filter(
        (key) => key !== 'length',
    );
    if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        return invalid(`${label} must be dense and have no extra fields`);
    }
    return value;
}

function strictEnum(value, allowed, label) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        return invalid(`${label} is outside the versioned schema`);
    }
    return value;
}

function strictRevision(value, label) {
    if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) {
        return invalid(`${label} must be a canonical revision`);
    }
    return value;
}

function strictPositiveIntegerText(value, label) {
    if (
        typeof value !== 'string' ||
        value.length > 19 ||
        !/^[1-9]\d*$/.test(value) ||
        BigInt(value) > MAX_SIGNED_64_BIT_INTEGER
    ) {
        return invalid(`${label} must be a positive integer string`);
    }
    return value;
}

function strictCanonicalDecimal(value, label, positive = false) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 80 ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    ) {
        return invalid(`${label} must be a canonical decimal string`);
    }
    const [integerPart, fractionalPart = ''] = value.split('.');
    const normalizedFraction = fractionalPart.replace(/0+$/, '');
    const normalized =
        normalizedFraction.length === 0
            ? integerPart
            : `${integerPart}.${normalizedFraction}`;
    if (
        normalized !== value ||
        integerPart.length > 18 ||
        normalizedFraction.length > 18 ||
        (positive && value === '0')
    ) {
        return invalid(`${label} must be a bounded canonical decimal string`);
    }
    return value;
}

function strictContract(value, label) {
    if (typeof value !== 'string' || !CONTRACT_PATTERN.test(value)) {
        return invalid(`${label} must be a first-phase TSE/OTC STK contract`);
    }
    return value;
}

function parseCondition(value, label) {
    const record = strictRecord(value, label, [
        'field',
        'comparator',
        'threshold',
        'mappingRevision',
    ]);
    strictEnum(
        record.field,
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
    strictEnum(record.comparator, ['gte', 'lte'], `${label}.comparator`);
    strictCanonicalDecimal(record.threshold, `${label}.threshold`);
    strictRevision(record.mappingRevision, `${label}.mappingRevision`);
}

function parseValidity(value, label) {
    const record = strictRecord(value, label, [
        'startDate',
        'endDate',
        'calendarVersion',
    ]);
    if (
        typeof record.startDate !== 'string' ||
        !ISO_DATE_PATTERN.test(record.startDate) ||
        typeof record.endDate !== 'string' ||
        !ISO_DATE_PATTERN.test(record.endDate)
    ) {
        return invalid(`${label} dates must use YYYY-MM-DD`);
    }
    const startEpochMs = Date.parse(`${record.startDate}T00:00:00.000Z`);
    const endEpochMs = Date.parse(`${record.endDate}T00:00:00.000Z`);
    const inclusiveDays = (endEpochMs - startEpochMs) / 86_400_000 + 1;
    if (
        !Number.isInteger(inclusiveDays) ||
        inclusiveDays < 1 ||
        inclusiveDays > 30 ||
        new Date(startEpochMs).toISOString().slice(0, 10) !==
            record.startDate ||
        new Date(endEpochMs).toISOString().slice(0, 10) !== record.endDate
    ) {
        return invalid(`${label} must span 1 to 30 inclusive calendar dates`);
    }
    strictRevision(record.calendarVersion, `${label}.calendarVersion`);
    return record;
}

function parseOrder(value, label) {
    const record = strictRecord(value, label, [
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
    strictContract(record.contractKey, `${label}.contractKey`);
    strictEnum(record.side, ['Buy', 'Sell'], `${label}.side`);
    strictEnum(record.orderCond, ['Cash'], `${label}.orderCond`);
    strictEnum(record.orderLot, ['Common'], `${label}.orderLot`);
    const baseShares = strictPositiveIntegerText(
        record.baseShares,
        `${label}.baseShares`,
    );
    const commonLots = strictPositiveIntegerText(
        record.commonLots,
        `${label}.commonLots`,
    );
    const contractUnit = strictPositiveIntegerText(
        record.contractUnit,
        `${label}.contractUnit`,
    );
    if (BigInt(baseShares) !== BigInt(commonLots) * BigInt(contractUnit)) {
        return invalid(`${label} quantity tuple is inconsistent`);
    }
    const priceType = strictEnum(
        record.priceType,
        ['LMT', 'MKT'],
        `${label}.priceType`,
    );
    if (priceType === 'LMT') {
        strictCanonicalDecimal(record.limitPrice, `${label}.limitPrice`, true);
    } else if (record.limitPrice !== null) {
        return invalid(`${label}.limitPrice must be null for MKT`);
    }
    const timeInForce = strictEnum(
        record.timeInForce,
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
        return invalid(
            `${label} supports only LMT+ROD, LMT+IOC or MKT+IOC`,
        );
    }
    strictRevision(record.policyRevision, `${label}.policyRevision`);
    return record;
}

function parseDistance(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return invalid(`${label} must be a distance object`);
    }
    if (value.kind === 'absolute') {
        const record = strictRecord(value, label, ['kind', 'value']);
        strictCanonicalDecimal(record.value, `${label}.value`, true);
        return;
    }
    if (value.kind === 'pct_bps') {
        const record = strictRecord(value, label, ['kind', 'pctBps']);
        if (
            !Number.isSafeInteger(record.pctBps) ||
            record.pctBps < 1 ||
            record.pctBps > 9_999
        ) {
            return invalid(`${label}.pctBps must be 1-9999`);
        }
        return;
    }
    if (value.kind === 'fixed_atr') {
        const record = strictRecord(value, label, [
            'kind',
            'atr',
            'multiplier',
            'atrSnapshotRevision',
        ]);
        strictCanonicalDecimal(record.atr, `${label}.atr`, true);
        strictCanonicalDecimal(record.multiplier, `${label}.multiplier`, true);
        strictRevision(
            record.atrSnapshotRevision,
            `${label}.atrSnapshotRevision`,
        );
        return;
    }
    return invalid(`${label}.kind is outside the versioned schema`);
}

function parseActivationPolicy(record, label) {
    strictEnum(
        record.activationPolicy,
        ['require_rearm', 'immediate_if_true'],
        `${label}.activationPolicy`,
    );
}

function requirePayloadVersion(record, kind, label) {
    if (
        record.payloadSchemaVersion !==
        SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS[kind]
    ) {
        return invalid(`${label}.payloadSchemaVersion is unsupported`);
    }
}

function parseParameters(kind, value) {
    const label = `${kind} parameters`;
    if (kind === 'quick') {
        const record = strictRecord(value, label, [
            'payloadSchemaVersion',
            'monitorContractKey',
            'condition',
            'order',
            'validity',
            'activationPolicy',
        ]);
        requirePayloadVersion(record, kind, label);
        const monitor = strictContract(
            record.monitorContractKey,
            `${label}.monitorContractKey`,
        );
        parseCondition(record.condition, `${label}.condition`);
        const order = parseOrder(record.order, `${label}.order`);
        if (monitor !== order.contractKey) {
            return invalid('quick monitor and order contract must match');
        }
        parseValidity(record.validity, `${label}.validity`);
        parseActivationPolicy(record, label);
        return;
    }
    if (kind === 'good_till') {
        const record = strictRecord(value, label, [
            'payloadSchemaVersion',
            'monitorContractKey',
            'condition',
            'order',
            'validity',
            'activationPolicy',
            'targetBaseShares',
            'perOrderMaxBaseShares',
        ]);
        requirePayloadVersion(record, kind, label);
        strictContract(record.monitorContractKey, `${label}.monitorContractKey`);
        parseCondition(record.condition, `${label}.condition`);
        parseOrder(record.order, `${label}.order`);
        parseValidity(record.validity, `${label}.validity`);
        parseActivationPolicy(record, label);
        const target = strictPositiveIntegerText(
            record.targetBaseShares,
            `${label}.targetBaseShares`,
        );
        const maximum = strictPositiveIntegerText(
            record.perOrderMaxBaseShares,
            `${label}.perOrderMaxBaseShares`,
        );
        if (BigInt(maximum) > BigInt(target)) {
            return invalid('good_till per-order maximum exceeds target');
        }
        return;
    }
    if (kind === 'multi_condition') {
        const record = strictRecord(value, label, [
            'payloadSchemaVersion',
            'conditions',
            'operator',
            'order',
            'validity',
            'activationPolicy',
        ]);
        requirePayloadVersion(record, kind, label);
        strictArray(record.conditions, `${label}.conditions`, 1, 7).forEach(
            (condition, index) => {
                const leg = strictRecord(
                    condition,
                    `${label}.conditions[${index}]`,
                    ['monitorContractKey', 'condition'],
                );
                strictContract(
                    leg.monitorContractKey,
                    `${label}.conditions[${index}].monitorContractKey`,
                );
                parseCondition(
                    leg.condition,
                    `${label}.conditions[${index}].condition`,
                );
            },
        );
        strictEnum(record.operator, ['AND', 'OR'], `${label}.operator`);
        parseOrder(record.order, `${label}.order`);
        parseValidity(record.validity, `${label}.validity`);
        parseActivationPolicy(record, label);
        return;
    }
    if (kind === 'parent_child') {
        const record = strictRecord(value, label, [
            'payloadSchemaVersion',
            'parent',
            'child',
            'parentValidity',
            'activationPolicy',
        ]);
        requirePayloadVersion(record, kind, label);
        const parseLeg = (valueToParse, legName) => {
            const leg = strictRecord(
                valueToParse,
                `${label}.${legName}`,
                legName === 'parent'
                    ? ['monitorContractKey', 'condition', 'order']
                    : [
                          'monitorContractKey',
                          'condition',
                          'order',
                          'cutoffTime',
                      ],
            );
            const monitor = strictContract(
                leg.monitorContractKey,
                `${label}.${legName}.monitorContractKey`,
            );
            parseCondition(leg.condition, `${label}.${legName}.condition`);
            const order = parseOrder(leg.order, `${label}.${legName}.order`);
            if (monitor !== order.contractKey) {
                return invalid(`${legName} monitor and order contract must match`);
            }
            if (
                legName === 'child' &&
                (typeof leg.cutoffTime !== 'string' ||
                    !WALL_TIME_PATTERN.test(leg.cutoffTime))
            ) {
                return invalid('child.cutoffTime must be HH:mm:ss');
            }
            return order;
        };
        const parentOrder = parseLeg(record.parent, 'parent');
        const childOrder = parseLeg(record.child, 'child');
        if (parentOrder.side !== 'Buy' || childOrder.side !== 'Sell') {
            return invalid('parent_child requires Buy parent and Sell child');
        }
        parseValidity(record.parentValidity, `${label}.parentValidity`);
        parseActivationPolicy(record, label);
        return;
    }
    if (kind === 'stop_take') {
        const record = strictRecord(value, label, [
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
        ]);
        requirePayloadVersion(record, kind, label);
        const position = strictContract(
            record.positionContractKey,
            `${label}.positionContractKey`,
        );
        const monitor = strictContract(
            record.monitorContractKey,
            `${label}.monitorContractKey`,
        );
        strictRevision(
            record.positionEvidenceRevision,
            `${label}.positionEvidenceRevision`,
        );
        strictCanonicalDecimal(record.basisPrice, `${label}.basisPrice`, true);
        strictEnum(
            record.basisSource,
            ['broker_average_cost', 'user_specified'],
            `${label}.basisSource`,
        );
        const legIds = new Set();
        const legTypes = new Set();
        strictArray(record.legs, `${label}.legs`, 1, 2).forEach((valueToParse, index) => {
            const leg = strictRecord(valueToParse, `${label}.legs[${index}]`, [
                'legId',
                'type',
                'distance',
                'triggerPrice',
                'triggerTicks',
            ]);
            const legId = strictRevision(
                leg.legId,
                `${label}.legs[${index}].legId`,
            );
            const legType = strictEnum(
                leg.type,
                ['stop', 'take'],
                `${label}.legs[${index}].type`,
            );
            if (legIds.has(legId) || legTypes.has(legType)) {
                return invalid('stop_take legs must have unique ids and types');
            }
            legIds.add(legId);
            legTypes.add(legType);
            parseDistance(leg.distance, `${label}.legs[${index}].distance`);
            strictCanonicalDecimal(
                leg.triggerPrice,
                `${label}.legs[${index}].triggerPrice`,
                true,
            );
            strictPositiveIntegerText(
                leg.triggerTicks,
                `${label}.legs[${index}].triggerTicks`,
            );
        });
        const order = parseOrder(record.order, `${label}.order`);
        if (
            position !== monitor ||
            position !== order.contractKey ||
            order.side !== 'Sell'
        ) {
            return invalid(
                'stop_take requires one position/monitor/order contract and Sell',
            );
        }
        parseValidity(record.validity, `${label}.validity`);
        parseActivationPolicy(record, label);
        return;
    }
    if (kind === 'trailing_exit') {
        const record = strictRecord(value, label, [
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
        ]);
        requirePayloadVersion(record, kind, label);
        const position = strictContract(
            record.positionContractKey,
            `${label}.positionContractKey`,
        );
        const monitor = strictContract(
            record.monitorContractKey,
            `${label}.monitorContractKey`,
        );
        strictRevision(
            record.positionEvidenceRevision,
            `${label}.positionEvidenceRevision`,
        );
        strictCanonicalDecimal(record.positionCost, `${label}.positionCost`, true);
        strictCanonicalDecimal(
            record.activationPrice,
            `${label}.activationPrice`,
            true,
        );
        parseDistance(record.retracement, `${label}.retracement`);
        if (record.fixedStopPrice !== null) {
            strictCanonicalDecimal(
                record.fixedStopPrice,
                `${label}.fixedStopPrice`,
                true,
            );
        }
        const order = parseOrder(record.order, `${label}.order`);
        if (
            position !== monitor ||
            position !== order.contractKey ||
            order.side !== 'Sell'
        ) {
            return invalid(
                'trailing_exit requires one position/monitor/order contract and Sell',
            );
        }
        parseValidity(record.validity, `${label}.validity`);
        parseActivationPolicy(record, label);
        return;
    }
    if (kind === 'scheduled_quantity') {
        const record = strictRecord(value, label, [
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
        requirePayloadVersion(record, kind, label);
        strictEnum(record.mode, ['timed', 'quantity'], `${label}.mode`);
        parseOrder(record.order, `${label}.order`);
        const scheduledValidity = parseValidity(
            record.validity,
            `${label}.validity`,
        );
        if (scheduledValidity.startDate !== scheduledValidity.endDate) {
            return invalid('scheduled_quantity is limited to one trading date');
        }
        strictPositiveIntegerText(
            record.targetBaseShares,
            `${label}.targetBaseShares`,
        );
        if (
            typeof record.startTime !== 'string' ||
            !WALL_TIME_PATTERN.test(record.startTime) ||
            (record.endTime !== null &&
                (typeof record.endTime !== 'string' ||
                    !WALL_TIME_PATTERN.test(record.endTime))) ||
            !Number.isSafeInteger(record.intervalSeconds) ||
            record.intervalSeconds <= 0
        ) {
            return invalid(`${label} timing fields are invalid`);
        }
        if (record.perOrderBaseShares !== null) {
            strictPositiveIntegerText(
                record.perOrderBaseShares,
                `${label}.perOrderBaseShares`,
            );
        }
        if (
            (record.mode === 'timed' &&
                (record.endTime === null ||
                    record.perOrderBaseShares !== null)) ||
            (record.mode === 'quantity' &&
                (record.endTime !== null ||
                    record.perOrderBaseShares === null))
        ) {
            return invalid(
                'scheduled_quantity mode fields do not match the approved disabled decision table',
            );
        }
        strictEnum(
            record.algorithmStatus,
            ['disabled_unverified'],
            `${label}.algorithmStatus`,
        );
        return;
    }
    return invalid('strategy kind is unsupported');
}

function taipeiDateAt(nowEpochMs) {
    if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
        throw new TypeError('canonical draft nowEpochMs must be a safe integer');
    }
    const instant = new Date(nowEpochMs);
    if (Number.isNaN(instant.getTime())) {
        throw new TypeError('canonical draft nowEpochMs is outside Date range');
    }
    const parts = Object.fromEntries(
        TAIPEI_DATE_FORMATTER.formatToParts(instant).map((part) => [
            part.type,
            part.value,
        ]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function editableCondition() {
    return {
        field: 'last_price',
        comparator: 'gte',
        threshold: '1',
        mappingRevision: DRAFT_UNVERIFIED_REVISION,
    };
}

function editableValidity(tradeDate) {
    return {
        startDate: tradeDate,
        endDate: tradeDate,
        calendarVersion: DRAFT_UNVERIFIED_REVISION,
    };
}

function editableOrder(contractKey, side) {
    return {
        contractKey,
        side,
        orderCond: 'Cash',
        orderLot: 'Common',
        baseShares: '1000',
        commonLots: '1',
        contractUnit: '1000',
        priceType: 'LMT',
        limitPrice: '1',
        timeInForce: 'ROD',
        policyRevision: DRAFT_UNVERIFIED_REVISION,
    };
}

function editableParameters(kind, contractKey, tradeDate) {
    const payloadSchemaVersion =
        SMART_ORDER_CANONICAL_DRAFT_PAYLOAD_SCHEMA_VERSIONS[kind];
    const validity = () => editableValidity(tradeDate);
    switch (kind) {
        case 'quick':
            return {
                payloadSchemaVersion,
                monitorContractKey: contractKey,
                condition: editableCondition(),
                order: editableOrder(contractKey, 'Buy'),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'good_till':
            return {
                payloadSchemaVersion,
                monitorContractKey: contractKey,
                condition: editableCondition(),
                order: editableOrder(contractKey, 'Buy'),
                validity: validity(),
                activationPolicy: 'require_rearm',
                targetBaseShares: '1000',
                perOrderMaxBaseShares: '1000',
            };
        case 'multi_condition':
            return {
                payloadSchemaVersion,
                conditions: [
                    {
                        monitorContractKey: contractKey,
                        condition: editableCondition(),
                    },
                ],
                operator: 'AND',
                order: editableOrder(contractKey, 'Buy'),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'parent_child':
            return {
                payloadSchemaVersion,
                parent: {
                    monitorContractKey: contractKey,
                    condition: editableCondition(),
                    order: editableOrder(contractKey, 'Buy'),
                },
                child: {
                    monitorContractKey: contractKey,
                    condition: editableCondition(),
                    order: editableOrder(contractKey, 'Sell'),
                    cutoffTime: '13:30:00',
                },
                parentValidity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'stop_take':
            return {
                payloadSchemaVersion,
                positionContractKey: contractKey,
                monitorContractKey: contractKey,
                positionEvidenceRevision: DRAFT_UNVERIFIED_REVISION,
                basisPrice: '1',
                basisSource: 'user_specified',
                legs: [
                    {
                        legId: 'draft-stop-leg',
                        type: 'stop',
                        distance: { kind: 'absolute', value: '1' },
                        triggerPrice: '1',
                        triggerTicks: '1',
                    },
                ],
                order: editableOrder(contractKey, 'Sell'),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'trailing_exit':
            return {
                payloadSchemaVersion,
                positionContractKey: contractKey,
                monitorContractKey: contractKey,
                positionEvidenceRevision: DRAFT_UNVERIFIED_REVISION,
                positionCost: '1',
                activationPrice: '1',
                retracement: { kind: 'absolute', value: '1' },
                fixedStopPrice: null,
                order: editableOrder(contractKey, 'Sell'),
                validity: validity(),
                activationPolicy: 'require_rearm',
            };
        case 'scheduled_quantity':
            return {
                payloadSchemaVersion,
                mode: 'timed',
                order: editableOrder(contractKey, 'Buy'),
                validity: validity(),
                targetBaseShares: '1000',
                startTime: '09:00:00',
                endTime: '13:30:00',
                intervalSeconds: 1800,
                perOrderBaseShares: null,
                algorithmStatus: 'disabled_unverified',
            };
        default:
            return invalid('strategy kind is unsupported');
    }
}

/**
 * Creates a complete, browser-editable draft wire payload without granting
 * account, readiness, feature-gate, write-master, or broker authority.
 */
export function createEditableCanonicalSmartOrderDraft({
    kind,
    workspaceContractKey,
    nowEpochMs,
}) {
    if (!KIND_SET.has(kind)) {
        throw new TypeError('canonical draft kind is unsupported');
    }
    const contractKey =
        workspaceContractKey === undefined || workspaceContractKey === null
            ? SMART_ORDER_CANONICAL_DRAFT_UNSET_CONTRACT_KEY
            : strictContract(workspaceContractKey, 'workspaceContractKey');
    const draft = {
        schemaVersion: SMART_ORDER_CANONICAL_DRAFT_SCHEMA_VERSION,
        decisionTableVersion:
            SMART_ORDER_CANONICAL_DRAFT_DECISION_TABLE_VERSION,
        kind,
        parameters: editableParameters(
            kind,
            contractKey,
            taipeiDateAt(nowEpochMs),
        ),
    };
    assertCanonicalSmartOrderDraft(draft, { expectedKind: kind });
    return draft;
}

export function assertCanonicalSmartOrderDraft(value, { expectedKind } = {}) {
    const record = strictRecord(value, 'draft', [
        'schemaVersion',
        'decisionTableVersion',
        'kind',
        'parameters',
    ]);
    if (record.schemaVersion !== SMART_ORDER_CANONICAL_DRAFT_SCHEMA_VERSION) {
        return invalid('schemaVersion is unsupported');
    }
    if (
        record.decisionTableVersion !==
        SMART_ORDER_CANONICAL_DRAFT_DECISION_TABLE_VERSION
    ) {
        return invalid('decisionTableVersion is unsupported');
    }
    if (!KIND_SET.has(record.kind)) {
        return invalid('kind is outside the seven-type schema');
    }
    if (expectedKind !== undefined && record.kind !== expectedKind) {
        return invalid('kind does not match the stored draft discriminator');
    }
    parseParameters(record.kind, record.parameters);
    return value;
}

export function isCanonicalSmartOrderDraft(value, options) {
    try {
        assertCanonicalSmartOrderDraft(value, options);
        return true;
    } catch {
        return false;
    }
}
