// src/components/order-ticket.tsx — buy/sell ticket with two-step EXECUTE.
// Stock vs futures aware; price autofills from the live quote.

import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from 'react';
import { TICKET_ACTION_EVENT } from '../hooks/use-hotkeys';
import { useQuote, useTradingLive } from '../hooks/use-stream';
import { orderPriceTypeLabel } from '../lib/order-price-type-label';
import {
    AUTOMATIC_PROTECTION_ORDER_COND,
    canonicalOrderTicketCategory,
    orderTicketProtectionEligibilityReason,
} from '../lib/order-ticket-protection-eligibility';
import {
    calculateOrderTicketProtectionPrice,
    type OrderTicketProtectionDistanceKind,
} from '../lib/order-ticket-protection-preview';
import { usePickedPrice } from '../lib/price-sync';
import { maskAccountId, maskName, usePrivacyMode } from '../lib/privacy';
import { useAccounts } from '../lib/account-store';
import { checkOrderAllowed } from '../lib/risk';
import {
    acceptSmartOrderProtectedEntryConfirmation,
    previewSmartOrderProtectedEntryConfirmation,
    type SmartOrderProtectedEntryConfirmationRequest,
    type SmartOrderProtectedEntryConfirmationView,
    type SmartOrderProtectedEntryDistance,
} from '../lib/smart-order-client';
import { placeFuturesOrder, placeStockOrder } from '../lib/shioaji';
import type { ContractInfo } from '../lib/types/contract';
import type {
    Action,
    FuturesOCType,
    OrderType,
    StockOrderLot,
} from '../lib/types/order';
import {
    contractMultiplier,
    futuresTaxRate,
    stockTaxRate,
} from '../lib/utils/contract-cost';
import { fmtPrice } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './order-ticket.css';

type ProtectionFamily = 'fixed' | 'trailing';
type ProtectionDistanceKind = OrderTicketProtectionDistanceKind;
type ProtectionConfiguration = Readonly<{
    family: ProtectionFamily;
    valid: boolean;
    usesAtr: boolean;
    executionLimitPrice: string;
    legs: SmartOrderProtectedEntryConfirmationRequest['protection']['legs'];
}>;

function percentageToBasisPoints(value: string): number | null {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return null;
    const [integer, fraction = ''] = value.split('.');
    const result =
        BigInt(integer ?? '') * BigInt(100) +
        BigInt((fraction ?? '').padEnd(2, '0'));
    return result >= BigInt(1) && result <= BigInt(9_999)
        ? Number(result)
        : null;
}

function canonicalPositiveDecimal(value: string): string | null {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
    const normalized = value.includes('.')
        ? value.replace(/0+$/, '').replace(/\.$/, '')
        : value;
    return normalized === '0' ? null : normalized;
}

function protectionDistance(
    kind: ProtectionDistanceKind,
    value: string,
): SmartOrderProtectedEntryDistance | null {
    if (kind === 'price') {
        const canonical = canonicalPositiveDecimal(value);
        return canonical !== null
            ? Object.freeze({ kind: 'absolute', value: canonical })
            : null;
    }
    if (kind === 'percent') {
        const pctBps = percentageToBasisPoints(value);
        return pctBps === null
            ? null
            : Object.freeze({ kind: 'pct_bps', pctBps });
    }
    const canonical = canonicalPositiveDecimal(value);
    return canonical !== null
        ? Object.freeze({ kind: 'fixed_atr', multiplier: canonical })
        : null;
}

function ProtectionPreview({
    contract,
    basis,
    disabledReason,
    enabled,
    onEnabledChange,
    onConfigurationChange,
}: {
    contract: ContractInfo;
    basis: string;
    disabledReason: string | null;
    enabled: boolean;
    onEnabledChange: (enabled: boolean) => void;
    onConfigurationChange: (configuration: ProtectionConfiguration) => void;
}) {
    const [family, setFamily] = useState<ProtectionFamily>('fixed');
    const [distanceKind, setDistanceKind] =
        useState<ProtectionDistanceKind>('percent');
    const [activationDistanceKind, setActivationDistanceKind] =
        useState<ProtectionDistanceKind>('percent');
    const [retracementDistanceKind, setRetracementDistanceKind] =
        useState<ProtectionDistanceKind>('percent');
    const [stopValue, setStopValue] = useState('3');
    const [takeValue, setTakeValue] = useState('5');
    const [activationValue, setActivationValue] = useState('3');
    const [retracementValue, setRetracementValue] = useState('2');
    const [trailingFixedStopEnabled, setTrailingFixedStopEnabled] =
        useState(false);
    const [trailingFixedStopValue, setTrailingFixedStopValue] = useState('5');
    const [atr, setAtr] = useState('2');
    const [executionLimitPrice, setExecutionLimitPrice] = useState(basis);
    const fixedTab = useRef<HTMLButtonElement>(null);
    const trailingTab = useRef<HTMLButtonElement>(null);
    const id = useId();
    const headingId = `${id}-protection-heading`;
    const category = canonicalOrderTicketCategory(contract);

    useEffect(() => {
        setExecutionLimitPrice(basis);
    }, [contract.code]);

    const previews = useMemo(() => {
        const calculate = (
            value: string,
            operation: 'add' | 'subtract',
            kind: ProtectionDistanceKind,
        ) => {
            return category === null
                ? null
                : calculateOrderTicketProtectionPrice({
                basis,
                distanceKind: kind,
                distanceValue: value,
                atrValue: atr,
                operation,
                category,
                limitDown: String(contract.limit_down),
                limitUp: String(contract.limit_up),
            });
        };
        return family === 'fixed'
            ? {
                  stop: calculate(stopValue, 'subtract', distanceKind),
                  take: calculate(takeValue, 'add', distanceKind),
              }
            : {
                  activation: calculate(
                      activationValue,
                      'add',
                      activationDistanceKind,
                  ),
                  retracementValidation: calculate(
                      retracementValue,
                      'subtract',
                      retracementDistanceKind,
                  ),
                  fixedStop: trailingFixedStopEnabled
                      ? calculate(
                            trailingFixedStopValue,
                            'subtract',
                            retracementDistanceKind,
                        )
                      : null,
              };
    }, [activationDistanceKind, activationValue, atr, basis, category, contract.limit_down, contract.limit_up, distanceKind, family, retracementDistanceKind, retracementValue, stopValue, takeValue, trailingFixedStopEnabled, trailingFixedStopValue]);
    const previewValid = family === 'fixed'
        ? Boolean(previews.stop && previews.take)
        : Boolean(
              previews.activation &&
                  previews.retracementValidation &&
                  (!trailingFixedStopEnabled || previews.fixedStop),
          );
    const configuration = useMemo<ProtectionConfiguration>(() => {
        const canonicalExecutionLimitPrice =
            canonicalPositiveDecimal(executionLimitPrice);
        const execution = Object.freeze({
            priceType: 'LMT' as const,
            limitPrice: canonicalExecutionLimitPrice ?? '',
            timeInForce: 'ROD' as const,
        });
        const createLeg = (
            legId: string,
            type: SmartOrderProtectedEntryConfirmationRequest['protection']['legs'][number]['type'],
            comparator: 'lte' | 'gte',
            kind: ProtectionDistanceKind,
            value: string,
        ) => {
            const distance = protectionDistance(kind, value);
            return distance === null
                ? null
                : Object.freeze({
                      comparator,
                      distance,
                      execution,
                      legId,
                      type,
                  });
        };
        const legs =
            family === 'fixed'
                ? [
                      createLeg(
                          'protected-entry-stop',
                          'stop',
                          'lte',
                          distanceKind,
                          stopValue,
                      ),
                      createLeg(
                          'protected-entry-take',
                          'take',
                          'gte',
                          distanceKind,
                          takeValue,
                      ),
                  ]
                : [
                      createLeg(
                          'protected-entry-trailing-activation',
                          'trailing_activation',
                          'gte',
                          activationDistanceKind,
                          activationValue,
                      ),
                      createLeg(
                          'protected-entry-trailing-retracement',
                          'trailing_retracement',
                          'lte',
                          retracementDistanceKind,
                          retracementValue,
                      ),
                      ...(trailingFixedStopEnabled
                          ? [
                                createLeg(
                                    'protected-entry-fixed-stop',
                                    'fixed_stop',
                                    'lte',
                                    retracementDistanceKind,
                                    trailingFixedStopValue,
                                ),
                            ]
                          : []),
                  ];
        const executionPrice = Number(canonicalExecutionLimitPrice);
        const executionValid =
            Number.isFinite(executionPrice) &&
            canonicalExecutionLimitPrice !== null &&
            executionPrice > 0 &&
            executionPrice >= Number(contract.limit_down) &&
            executionPrice <= Number(contract.limit_up);
        return Object.freeze({
            family,
            valid:
                previewValid &&
                executionValid &&
                legs.every((leg) => leg !== null),
            usesAtr:
                (family === 'fixed' && distanceKind === 'atr') ||
                (family === 'trailing' &&
                    (activationDistanceKind === 'atr' ||
                        retracementDistanceKind === 'atr')),
            executionLimitPrice: canonicalExecutionLimitPrice ?? '',
            legs: Object.freeze(
                legs.filter(
                    (leg): leg is NonNullable<typeof leg> => leg !== null,
                ),
            ),
        });
    }, [
        activationDistanceKind,
        activationValue,
        contract.limit_down,
        contract.limit_up,
        distanceKind,
        executionLimitPrice,
        family,
        previewValid,
        retracementDistanceKind,
        retracementValue,
        stopValue,
        takeValue,
        trailingFixedStopEnabled,
        trailingFixedStopValue,
    ]);
    useEffect(() => {
        onConfigurationChange(configuration);
    }, [configuration, onConfigurationChange]);
    const unitFor = (kind: ProtectionDistanceKind) =>
        kind === 'price'
            ? 'TWD 價位'
            : kind === 'percent'
              ? '%（Runtime 會保存 integer bps）'
              : 'ATR 倍數';

    return (
        <section className={styles.protectionSection} aria-labelledby={headingId}>
            <div className={styles.protectionHeader}>
                <div>
                    <strong id={headingId}>自動保護（Runtime）</strong>
                    <span>本機監控・非券商雲端</span>
                </div>
                <button
                    type='button'
                    className={styles.seg[enabled ? 'on' : 'off']}
                    disabled={Boolean(disabledReason)}
                    aria-pressed={enabled}
                    onClick={() => {
                        const next = !enabled;
                        onEnabledChange(next);
                    }}
                >
                    {enabled ? '已選擇保護' : '加入保護'}
                </button>
            </div>
            {disabledReason ? (
                <p className={styles.protectionBlocked} role='status'>
                    不支援：{disabledReason}
                </p>
            ) : null}
            {enabled ? (
                <div className={styles.protectionSettings}>
                    <div className={styles.protectionTabs} role='tablist' aria-label='保護類型'>
                        {([
                            ['fixed', '固定保護'],
                            ['trailing', '移動出場'],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                id={`${id}-${value}-tab`}
                                ref={value === 'fixed' ? fixedTab : trailingTab}
                                type='button'
                                role='tab'
                                aria-selected={family === value}
                                aria-controls={`${id}-${value}-panel`}
                                tabIndex={family === value ? 0 : -1}
                                className={styles.seg[family === value ? 'on' : 'off']}
                                onClick={() => setFamily(value)}
                                onKeyDown={(event) => {
                                    const next = event.key === 'Home'
                                        ? 'fixed'
                                        : event.key === 'End'
                                          ? 'trailing'
                                          : event.key === 'ArrowRight' || event.key === 'ArrowLeft'
                                            ? value === 'fixed'
                                                ? 'trailing'
                                                : 'fixed'
                                            : null;
                                    if (!next) return;
                                    event.preventDefault();
                                    setFamily(next);
                                    (next === 'fixed' ? fixedTab : trailingTab).current?.focus();
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div
                        id={`${id}-${family}-panel`}
                        role='tabpanel'
                        aria-labelledby={`${id}-${family}-tab`}
                        className={styles.protectionPanel}
                    >
                    {family === 'fixed' ? (
                        <ProtectionDistanceModeSelect
                            label='停損／停利距離模式'
                            ariaLabel='保護距離模式'
                            value={distanceKind}
                            onChange={setDistanceKind}
                        />
                    ) : (
                        <>
                            <ProtectionDistanceModeSelect
                                label='啟動門檻模式'
                                ariaLabel='啟動門檻距離模式'
                                value={activationDistanceKind}
                                onChange={setActivationDistanceKind}
                            />
                            <ProtectionDistanceModeSelect
                                label='回撤距離模式'
                                ariaLabel='回撤距離模式'
                                value={retracementDistanceKind}
                                onChange={setRetracementDistanceKind}
                            />
                        </>
                    )}
                    {(family === 'fixed' && distanceKind === 'atr') ||
                    (family === 'trailing' &&
                        (activationDistanceKind === 'atr' ||
                            retracementDistanceKind === 'atr')) ? (
                        <label className={styles.protectionField}>
                            <span>固定 ATR(14) 預覽值</span>
                            <input aria-label='固定 ATR 預覽值' inputMode='decimal' value={atr} onChange={(event) => setAtr(event.target.value)} />
                            <small>正式值須由 Runtime 凍結上一完成交易日快照。</small>
                        </label>
                    ) : null}
                    {family === 'fixed' ? (
                        <>
                            <ProtectionDistanceInput label='停損' value={stopValue} unit={unitFor(distanceKind)} onChange={setStopValue} />
                            <ProtectionDistanceInput label='停利' value={takeValue} unit={unitFor(distanceKind)} onChange={setTakeValue} />
                        </>
                    ) : (
                        <>
                            <ProtectionDistanceInput label='啟動門檻' value={activationValue} unit={unitFor(activationDistanceKind)} onChange={setActivationValue} />
                            <ProtectionDistanceInput label='回撤距離' value={retracementValue} unit={unitFor(retracementDistanceKind)} onChange={setRetracementValue} />
                            <label className={styles.protectionCheckbox}>
                                <input
                                    type='checkbox'
                                    checked={trailingFixedStopEnabled}
                                    onChange={(event) =>
                                        setTrailingFixedStopEnabled(event.target.checked)
                                    }
                                />
                                <span>另設固定停損（使用回撤距離模式）</span>
                            </label>
                            {trailingFixedStopEnabled ? (
                                <ProtectionDistanceInput
                                    label='固定停損'
                                    value={trailingFixedStopValue}
                                    unit={unitFor(retracementDistanceKind)}
                                    onChange={setTrailingFixedStopValue}
                                />
                            ) : null}
                        </>
                    )}
                    <label className={styles.protectionField}>
                        <span>保護委託限價（各 leg 共用）</span>
                        <input
                            aria-label='保護委託限價'
                            inputMode='decimal'
                            value={executionLimitPrice}
                            onChange={(event) =>
                                setExecutionLimitPrice(event.target.value)
                            }
                        />
                        <small>
                            broker execution policy：LMT／ROD；與 trigger
                            分開保存，仍須 Runtime dispatch gates。
                        </small>
                    </label>
                    <div className={styles.protectionPreview} role='status'>
                            <span>估算基準 {fmtPrice(Number(basis))}（正式值依 broker 成交均價重算）</span>
                        {family === 'fixed' ? (
                            <>
                                <ProtectionPriceLine label='停損' preview={previews.stop ?? null} />
                                <ProtectionPriceLine label='停利' preview={previews.take ?? null} />
                            </>
                        ) : (
                            <>
                                <ProtectionPriceLine label='啟動' preview={previews.activation ?? null} />
                                <span>
                                    回撤：啟動後以 Runtime 持久化的 saved high 計算；建立前不以 entry basis 冒充理論 trigger。
                                </span>
                                {trailingFixedStopEnabled ? (
                                    <ProtectionPriceLine
                                        label='固定停損'
                                        preview={previews.fixedStop ?? null}
                                    />
                                ) : null}
                            </>
                        )}
                    </div>
                    {!previewValid ? (
                        <p className={styles.protectionBlocked} role='alert'>
                            保護輸入無效；不得建立 Runtime intent。
                        </p>
                    ) : null}
                    <p className={styles.protectionBoundary}>
                        含保護的新單只會送往本機 Runtime 做 canonical
                        confirmation 與原子保存；browser 不會直送 broker。
                        ATR 必須有 Runtime 凍結的可信快照，只有畫面預覽值時會
                        fail closed。
                    </p>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

function ProtectionPriceLine({
    label,
    preview,
}: {
    label: string;
    preview: ReturnType<typeof calculateOrderTicketProtectionPrice>;
}) {
    return (
        <span>
            {label}：
            {preview
                ? `理論 ${preview.theoreticalPrice} → 合法 tick ${preview.legalTickPrice}（tick ${preview.tickSize}，觸發 ${preview.comparator}）`
                : '無效或超出漲跌停'}
        </span>
    );
}

function ProtectionDistanceModeSelect({
    label,
    ariaLabel,
    value,
    onChange,
}: {
    label: string;
    ariaLabel: string;
    value: ProtectionDistanceKind;
    onChange: (value: ProtectionDistanceKind) => void;
}) {
    return (
        <label className={styles.protectionField}>
            <span>{label}</span>
            <select
                aria-label={ariaLabel}
                value={value}
                onChange={(event) =>
                    onChange(event.target.value as ProtectionDistanceKind)
                }
            >
                <option value='price'>價位</option>
                <option value='percent'>百分比</option>
                <option value='atr'>ATR</option>
            </select>
        </label>
    );
}

function ProtectionDistanceInput({ label, value, unit, onChange }: {
    label: string;
    value: string;
    unit: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className={styles.protectionField}>
            <span>{label}</span>
            <input aria-label={`${label}保護值`} inputMode='decimal' value={value} onChange={(event) => onChange(event.target.value)} />
            <small>{unit}</small>
        </label>
    );
}

export function OrderTicket({
    contract,
    onPlaced,
}: {
    contract: ContractInfo;
    onPlaced: () => void;
}) {
    const isFutures =
        contract.security_type === 'FUT' || contract.security_type === 'OPT';
    const quote = useQuote(contract.code);
    const live = useTradingLive();
    const { selectedStock, selectedFutures } = useAccounts();
    const priv = usePrivacyMode();

    const [action, setAction] = useState<Action>('Buy');
    const [price, setPrice] = useState('');
    const [qty, setQty] = useState(1);
    const [priceType, setPriceType] = useState('LMT');
    const [orderType, setOrderType] = useState<OrderType>('ROD');
    const [orderLot, setOrderLot] = useState<StockOrderLot>('Common');
    const [octype, setOctype] = useState<FuturesOCType>('Auto');
    const [daytradeShort, setDaytradeShort] = useState(false);
    const [armed, setArmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [protectionSelected, setProtectionSelected] = useState(false);
    const [protectionConfiguration, setProtectionConfiguration] =
        useState<ProtectionConfiguration>(() =>
            Object.freeze({
                family: 'fixed',
                valid: false,
                usesAtr: false,
                executionLimitPrice: '',
                legs: Object.freeze([]),
            }),
        );
    const [protectedEntryConfirmation, setProtectedEntryConfirmation] =
        useState<SmartOrderProtectedEntryConfirmationView | null>(null);
    const [feedback, setFeedback] = useState<{
        kind: 'ok' | 'err';
        text: string;
    } | null>(null);
    const priceTouched = useRef(false);
    const onProtectionConfigurationChange = useCallback(
        (configuration: ProtectionConfiguration) => {
            setProtectionConfiguration(configuration);
        },
        [],
    );

    // reset on symbol change
    useEffect(() => {
        setPrice('');
        priceTouched.current = false;
        setArmed(false);
        setFeedback(null);
        setPriceType('LMT');
        setOrderType('ROD');
        setOrderLot('Common');
        setOctype('Auto');
        setDaytradeShort(false);
        setProtectionSelected(false);
        setProtectedEntryConfirmation(null);
    }, [contract.code]);

    // B/S hotkeys switch action
    useEffect(() => {
        const onAction = (e: Event) => {
            const a = (e as CustomEvent).detail?.action;
            if (a === 'Buy' || a === 'Sell') {
                setAction(a);
                setArmed(false);
            }
        };
        window.addEventListener(TICKET_ACTION_EVENT, onAction);
        return () => window.removeEventListener(TICKET_ACTION_EVENT, onAction);
    }, []);

    // autofill price from live quote until user edits it
    const liveClose = quote?.tick?.close;
    useEffect(() => {
        if (!priceTouched.current && liveClose) {
            setPrice(String(Number(liveClose)));
        }
    }, [liveClose]);

    // price picked from chart hover/click or depth ladder (same symbol only)
    const picked = usePickedPrice(contract.code);
    useEffect(() => {
        if (picked) {
            priceTouched.current = true;
            setPrice(String(picked.price));
            setArmed(false);
        }
    }, [picked]);

    const protectedEntryConfirmationRequest = useMemo<
        SmartOrderProtectedEntryConfirmationRequest | null
    >(() => {
        const limitPrice = canonicalPositiveDecimal(price);
        if (
            !protectionSelected ||
            !protectionConfiguration.valid ||
            protectionConfiguration.usesAtr ||
            isFutures ||
            action !== 'Buy' ||
            priceType !== 'LMT' ||
            (orderType !== 'ROD' && orderType !== 'IOC') ||
            orderLot !== 'Common' ||
            daytradeShort ||
            !selectedStock ||
            (contract.exchange !== 'TSE' && contract.exchange !== 'OTC') ||
            contract.security_type !== 'STK' ||
            !Number.isSafeInteger(qty) ||
            qty < 1 ||
            limitPrice === null
        ) {
            return null;
        }
        return Object.freeze({
            schemaVersion:
                'smart-order-protected-entry-confirmation-request/2026-08-20.1',
            accountBrokerRef: selectedStock.broker_id,
            accountIdRef: selectedStock.account_id,
            commonLots: qty,
            contractKey: `${contract.exchange}:STK:${contract.code}`,
            entryOrder: Object.freeze({
                priceType: 'LMT',
                limitPrice,
                timeInForce: orderType,
            }),
            protection: Object.freeze({
                family: protectionConfiguration.family,
                legs: protectionConfiguration.legs,
            }),
        });
    }, [
        action,
        contract.code,
        contract.exchange,
        contract.security_type,
        daytradeShort,
        isFutures,
        orderLot,
        orderType,
        price,
        priceType,
        protectionConfiguration,
        protectionSelected,
        qty,
        selectedStock,
    ]);
    const protectedEntryConfirmationFingerprint = useMemo(
        () =>
            protectedEntryConfirmationRequest === null
                ? null
                : JSON.stringify(protectedEntryConfirmationRequest),
        [protectedEntryConfirmationRequest],
    );
    useEffect(() => {
        setProtectedEntryConfirmation(null);
    }, [protectedEntryConfirmationFingerprint]);

    const execute = async () => {
        if (protectionSelected) {
            setArmed(false);
            if (protectedEntryConfirmationRequest === null) {
                setFeedback({
                    kind: 'err',
                    text: protectionConfiguration.usesAtr
                        ? '✕ ATR 只有畫面預覽值；Runtime 尚無可信固定快照，未建立 intent'
                        : '✕ 含保護委託欄位尚未完整或不在支援矩陣，未建立 intent',
                });
                return;
            }
            setBusy(true);
            try {
                if (protectedEntryConfirmation === null) {
                    const preview =
                        await previewSmartOrderProtectedEntryConfirmation({
                            confirmationRequest:
                                protectedEntryConfirmationRequest,
                        });
                    setProtectedEntryConfirmation(preview);
                    setFeedback({
                        kind: 'ok',
                        text: 'Runtime canonical confirmation 已建立；請核對下方全部綁定欄位後再次確認',
                    });
                } else {
                    const accepted =
                        await acceptSmartOrderProtectedEntryConfirmation({
                            confirmationRequest:
                                protectedEntryConfirmationRequest,
                            confirmationId:
                                protectedEntryConfirmation.confirmationId,
                            snapshotHash:
                                protectedEntryConfirmation.snapshotHash,
                            userAcknowledged: true,
                        });
                    setProtectedEntryConfirmation(accepted);
                    setFeedback({
                        kind: 'ok',
                        text: '計畫、entry intent、reservation 與保護義務已原子保存；broker 尚未送出',
                    });
                    onPlaced();
                }
            } catch (error) {
                setProtectedEntryConfirmation(null);
                setFeedback({
                    kind: 'err',
                    text: `✕ ${
                        error instanceof Error ? error.message : String(error)
                    }（尚未送出／尚未受保護）`,
                });
            } finally {
                setBusy(false);
            }
            return;
        }
        if (!armed) {
            setArmed(true);
            setFeedback(null);
            return;
        }
        setArmed(false);
        setBusy(true);
        try {
            const blocked = checkOrderAllowed(qty);
            if (blocked) throw new Error(blocked);
            const p = priceType === 'LMT' ? Number(price) : 0;
            if (priceType === 'LMT' && (!Number.isFinite(p) || p <= 0)) {
                throw new Error('限價單需要有效價格');
            }
            const trade = isFutures
                ? await placeFuturesOrder(contract, {
                      action,
                      price: p,
                      quantity: qty,
                      price_type: priceType as 'LMT' | 'MKT' | 'MKP',
                      order_type: orderType,
                      octype,
                  })
                : await placeStockOrder(contract, {
                      action,
                      price: p,
                      quantity: qty,
                      price_type: priceType as 'LMT' | 'MKT',
                      order_type: orderType,
                      order_lot: orderLot,
                      daytrade_short:
                          action === 'Sell' && daytradeShort
                              ? true
                              : undefined,
                  }, 'STK-MAN-PLACE-TICKET');
            setFeedback({
                kind: 'ok',
                text: `▸ ${trade.status.status} #${trade.order.seqno || trade.order.id.slice(0, 8)}`,
            });
            onPlaced();
        } catch (e) {
            setFeedback({
                kind: 'err',
                text: `✕ ${e instanceof Error ? e.message : String(e)}`,
            });
        } finally {
            setBusy(false);
        }
    };

    const qtyUnit = isFutures ? '口' : orderLot === 'IntradayOdd' ? '股' : '張';
    const activeAccount = isFutures ? selectedFutures : selectedStock;
    const protectionDisabledReason = orderTicketProtectionEligibilityReason({
        contract,
        action,
        orderCond: AUTOMATIC_PROTECTION_ORDER_COND,
        orderLot,
        daytradeShort,
        fixedStockAccount: selectedStock,
    });
    useEffect(() => {
        if (protectionDisabledReason !== null) setProtectionSelected(false);
    }, [protectionDisabledReason]);
    const previewBasis =
        priceType === 'LMT' && Number.isFinite(Number(price)) && Number(price) > 0
            ? price
            : String(contract.reference);

    if (contract.security_type === 'IND') {
        return (
            <div className={styles.body}>
                <span className={styles.costRow}>
                    指數商品僅提供即時行情與分析，不支援下單
                </span>
            </div>
        );
    }

    return (
        <div className={styles.body}>
                <div className={styles.sideTabs}>
                    <button
                        className={styles.buyTab[action === 'Buy' ? 'on' : 'off']}
                        onClick={() => {
                            setAction('Buy');
                            setArmed(false);
                        }}
                    >
                        買進 Buy
                    </button>
                    <button
                        className={
                            styles.sellTab[action === 'Sell' ? 'on' : 'off']
                        }
                        onClick={() => {
                            setAction('Sell');
                            setArmed(false);
                        }}
                    >
                        賣出 Sell
                    </button>
                </div>

                <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>價格</span>
                    <button
                        className={styles.stepBtn}
                        onClick={() => {
                            priceTouched.current = true;
                            setPrice((p) =>
                                String(
                                    Math.max(0, Number(p || 0) - 1),
                                ),
                            );
                        }}
                    >
                        −
                    </button>
                    <input
                        className={styles.numInput}
                        value={
                            priceType === 'LMT'
                                ? price
                                : orderPriceTypeLabel(
                                      priceType as 'MKT' | 'MKP',
                                  )
                        }
                        disabled={priceType !== 'LMT'}
                        onChange={(e) => {
                            priceTouched.current = true;
                            setPrice(e.target.value);
                            setArmed(false);
                        }}
                        inputMode='decimal'
                    />
                    <button
                        className={styles.stepBtn}
                        onClick={() => {
                            priceTouched.current = true;
                            setPrice((p) => String(Number(p || 0) + 1));
                        }}
                    >
                        +
                    </button>
                </div>

                <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>數量{qtyUnit}</span>
                    <button
                        className={styles.stepBtn}
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                    >
                        −
                    </button>
                    <input
                        className={styles.numInput}
                        value={qty}
                        onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isInteger(v) && v >= 0) setQty(v);
                        }}
                        inputMode='numeric'
                    />
                    <button
                        className={styles.stepBtn}
                        onClick={() => setQty((q) => q + 1)}
                    >
                        +
                    </button>
                </div>

                <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>價別</span>
                    <div className={styles.segGroup}>
                        {(isFutures
                            ? ['LMT', 'MKT', 'MKP']
                            : ['LMT', 'MKT']
                        ).map((pt) => (
                            <button
                                key={pt}
                                className={
                                    styles.seg[priceType === pt ? 'on' : 'off']
                                }
                                onClick={() => {
                                    setPriceType(pt);
                                    setArmed(false);
                                    if (pt !== 'LMT') setOrderType('IOC');
                                    else setOrderType('ROD');
                                }}
                            >
                                {orderPriceTypeLabel(
                                    pt as 'LMT' | 'MKT' | 'MKP',
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>效期</span>
                    <div className={styles.segGroup}>
                        {(['ROD', 'IOC', 'FOK'] as OrderType[]).map((ot) => (
                            <button
                                key={ot}
                                className={
                                    styles.seg[orderType === ot ? 'on' : 'off']
                                }
                                onClick={() => {
                                    setOrderType(ot);
                                    setArmed(false);
                                }}
                            >
                                {ot}
                            </button>
                        ))}
                    </div>
                </div>

                {isFutures ? (
                    <div className={styles.fieldRow}>
                        <span className={styles.fieldLabel}>倉別</span>
                        <div className={styles.segGroup}>
                            {(
                                [
                                    ['Auto', '自動'],
                                    ['New', '新倉'],
                                    ['Cover', '平倉'],
                                    ['DayTrade', '當沖'],
                                ] as [FuturesOCType, string][]
                            ).map(([oc, label]) => (
                                <button
                                    key={oc}
                                    className={
                                        styles.seg[octype === oc ? 'on' : 'off']
                                    }
                                    onClick={() => {
                                        setOctype(oc);
                                        setArmed(false);
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className={styles.fieldRow}>
                        <span className={styles.fieldLabel}>單位</span>
                        <div className={styles.segGroup}>
                            {(
                                [
                                    ['Common', '整股'],
                                    ['IntradayOdd', '零股'],
                                ] as [StockOrderLot, string][]
                            ).map(([lot, label]) => (
                                <button
                                    key={lot}
                                    className={
                                        styles.seg[
                                            orderLot === lot ? 'on' : 'off'
                                        ]
                                    }
                                    onClick={() => {
                                        setOrderLot(lot);
                                        setArmed(false);
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {!isFutures &&
                    action === 'Sell' &&
                    orderLot === 'Common' &&
                    contract.day_trade === 'Yes' && (
                        <div className={styles.fieldRow}>
                            <span className={styles.fieldLabel}>沖賣</span>
                            <div className={styles.segGroup}>
                                <button
                                    className={
                                        styles.seg[daytradeShort ? 'on' : 'off']
                                    }
                                    title='現股當沖先賣（無券先賣，當日需回補）'
                                    onClick={() => {
                                        setDaytradeShort((v) => !v);
                                        setArmed(false);
                                    }}
                                >
                                    {daytradeShort
                                        ? '✓ 現沖先賣（當日回補）'
                                        : '現股當沖先賣'}
                                </button>
                            </div>
                        </div>
                    )}

                <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>括號單</span>
                    <div className={styles.segGroup}>
                        <button
                            className={styles.seg.off}
                            type='button'
                            disabled
                            aria-disabled='true'
                            title='舊版瀏覽器括號單沒有 durable broker authority，已停用；請改用智慧下單'
                            style={{ cursor: 'not-allowed', opacity: 0.55 }}
                        >
                            已停用：請用智慧下單
                        </button>
                    </div>
                </div>
                <span className={styles.costRow}>
                    此下單面板不會建立停損／停利保護；請先核對部位，再到智慧下單重建。
                </span>

                <ProtectionPreview
                    contract={contract}
                    basis={previewBasis}
                    disabledReason={protectionDisabledReason}
                    enabled={protectionSelected}
                    onEnabledChange={setProtectionSelected}
                    onConfigurationChange={
                        onProtectionConfigurationChange
                    }
                />

                {protectionDisabledReason === null ? (
                    <span className={styles.costRow}>
                        自動保護適用：TSE／OTC・Cash・Common・現股多單
                    </span>
                ) : null}

                {activeAccount && (
                    <span className={styles.costRow}>
                        帳號 {activeAccount.broker_id}-
                        {maskAccountId(activeAccount.account_id, priv)}（
                        {maskName(activeAccount.username, priv)}）
                    </span>
                )}

                <CostEstimate
                    contract={contract}
                    action={action}
                    price={priceType === 'LMT' ? Number(price) : null}
                    qty={qty}
                    odd={!isFutures && orderLot === 'IntradayOdd'}
                    daytrade={!isFutures && daytradeShort}
                />

                {protectedEntryConfirmation ? (
                    <section
                        className={styles.protectionPreview}
                        aria-label='Runtime canonical confirmation'
                    >
                        <strong>
                            Runtime canonical confirmation：
                            {protectedEntryConfirmation.state === 'accepted'
                                ? '已接受並原子保存'
                                : '待最後確認'}
                        </strong>
                        <span>
                            simulation・
                            {protectedEntryConfirmation.fixedAccountLabel}・
                            {protectedEntryConfirmation.contract.category}{' '}
                            {protectedEntryConfirmation.contract.contractKey}
                        </span>
                        <span>
                            Buy・Cash／Common・
                            {protectedEntryConfirmation.entryOrder.commonLots}
                            張／
                            {protectedEntryConfirmation.entryOrder.baseShares}
                            股・entry{' '}
                            {protectedEntryConfirmation.entryOrder.priceType}/
                            {protectedEntryConfirmation.entryOrder.timeInForce}{' '}
                            @ {protectedEntryConfirmation.entryOrder.limitPrice}
                        </span>
                        {protectedEntryConfirmation.protection.legs.map(
                            (leg) => (
                                <span key={leg.legId}>
                                    {leg.type} {leg.comparator}・
                                    {leg.distance.kind === 'absolute'
                                        ? `距離 ${leg.distance.value}`
                                        : leg.distance.kind === 'pct_bps'
                                          ? `距離 ${(
                                                leg.distance.pctBps / 100
                                            ).toFixed(2)}%`
                                          : `ATR × ${leg.distance.multiplier}`}
                                    ・broker {leg.execution.priceType}/
                                    {leg.execution.timeInForce}
                                    {leg.execution.limitPrice === null
                                        ? ''
                                        : ` @ ${leg.execution.limitPrice}`}
                                </span>
                            ),
                        )}
                        <span>
                            預覽基準{' '}
                            {
                                protectedEntryConfirmation.previewBasis
                                    .priceDecimal
                            }
                            ；正式 trigger 依 entry 成交加權均價重算
                        </span>
                        <span>
                            risk revision{' '}
                            {protectedEntryConfirmation.riskRevision}・mode
                            generation{' '}
                            {protectedEntryConfirmation.modeGeneration}・Runtime
                            revision{' '}
                            {protectedEntryConfirmation.runtimeRevision}・有效至{' '}
                            {new Date(
                                protectedEntryConfirmation.validUntilEpochMs,
                            ).toLocaleTimeString('zh-TW')}
                        </span>
                        <span className={styles.protectionBoundary}>
                            本機監控不是券商雲端；Runtime 重啟後須完成對帳並由使用者
                            re-arm。此確認不授予 browser 或 broker write authority。
                        </span>
                    </section>
                ) : null}

                <button
                    className={
                        styles.execBtn[
                            armed ? 'armed' : action === 'Buy' ? 'buy' : 'sell'
                        ]
                    }
                    onClick={execute}
                    disabled={
                        busy ||
                        qty < 1 ||
                        !live ||
                        (protectionSelected &&
                            protectedEntryConfirmation?.state === 'accepted')
                    }
                >
                    {protectionSelected
                        ? protectedEntryConfirmation?.state === 'accepted'
                            ? '含保護計畫已保存（broker 尚未送出）'
                            : protectedEntryConfirmation
                              ? '確認並原子保存含保護 entry'
                              : '建立 Runtime canonical confirmation'
                        : !live
                        ? '⚠ 行情未連線，暫停下單'
                        : busy
                          ? '傳送中…'
                          : armed
                            ? `確認${action === 'Buy' ? '買進' : '賣出'} ${qty}${qtyUnit} @ ${priceType === 'LMT' ? fmtPrice(Number(price)) : orderPriceTypeLabel(priceType as 'MKT' | 'MKP')}`
                            : action === 'Buy'
                              ? '買進下單'
                              : '賣出下單'}
                </button>

            {feedback && (
                <span
                    className={`${styles.feedback} ${
                        panel.dirText[feedback.kind === 'ok' ? 'down' : 'up']
                    }`}
                >
                    {feedback.text}
                </span>
            )}
        </div>
    );
}

function CostEstimate({
    contract,
    action,
    price,
    qty,
    odd,
    daytrade,
}: {
    contract: ContractInfo;
    action: Action;
    price: number | null;
    qty: number;
    odd: boolean;
    daytrade: boolean;
}) {
    if (!price || !Number.isFinite(price) || price <= 0 || qty <= 0) {
        return null;
    }
    const mult = contractMultiplier(contract);
    if (contract.security_type === 'OPT') {
        // options: premium × multiplier; 期交稅 0.1% of premium value
        const premium = price * mult * qty;
        const tax = Math.max(1, Math.round(premium * 0.001));
        return (
            <span className={styles.costRow}>
                權利金 ≈ {fmtPrice(premium, 0)} · 期交稅 ≈ {tax}/邊
            </span>
        );
    }
    if (contract.security_type === 'FUT') {
        const notional = price * mult * qty;
        const tax = Math.max(
            1,
            Math.round(notional * futuresTaxRate(contract)),
        );
        return (
            <span className={styles.costRow}>
                契約值 ≈ {fmtPrice(notional, 0)}（乘數 {mult}）· 期交稅 ≈{' '}
                {tax}/邊
            </span>
        );
    }
    const shares = odd ? qty : qty * 1000;
    const notional = price * shares;
    const fee = Math.max(odd ? 1 : 20, Math.round(notional * 0.001425));
    const baseTaxRate = stockTaxRate(contract);
    // 一般股票當沖賣出減半；ETF 與權證固定 0.1%。
    const taxRate =
        baseTaxRate === 0.003 && daytrade ? 0.0015 : baseTaxRate;
    const tax = action === 'Sell' ? Math.round(notional * taxRate) : 0;
    return (
        <span className={styles.costRow}>
            金額 {fmtPrice(notional, 0)} · 手續費 ≈ {fee}
            {action === 'Sell' ? ` · 證交稅 ≈ ${tax}` : ''}（牌告價估算）
        </span>
    );
}
