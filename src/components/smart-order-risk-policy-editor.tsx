import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    fetchSmartOrderRuntimeRiskPolicy,
    publishSmartOrderRuntimeRiskPolicy,
    SmartOrderLocalApiError,
    SmartOrderLogicalOperationRegistry,
    type SmartOrderRiskLimitVector,
    type SmartOrderRuntimeRiskPolicyEditorInput,
    type SmartOrderRuntimeRiskPolicyView,
} from '../lib/smart-order-client';
import * as styles from './smart-order-panel.css';

const EDITOR_SCHEMA =
    'smart-order-runtime-risk-policy-editor/2026-08-14.1' as const;

type FormState = Readonly<{
    buyFeeBps: string;
    minimumBuyFeeMinorUnits: string;
    cashBufferMinorUnits: string;
    accountQuantityShares: string;
    accountNotionalMinorUnits: string;
    accountCashMinorUnits: string;
    accountPositionShares: string;
    accountOrderCount: string;
    identityQuantityShares: string;
    identityNotionalMinorUnits: string;
    identityCashMinorUnits: string;
    identityPositionShares: string;
    identityOrderCount: string;
    accountDailyLossLimitMinorUnits: string;
    identityDailyLossLimitMinorUnits: string;
}>;

const EMPTY_FORM: FormState = Object.freeze({
    buyFeeBps: '0',
    minimumBuyFeeMinorUnits: '0',
    cashBufferMinorUnits: '0',
    accountQuantityShares: '0',
    accountNotionalMinorUnits: '0',
    accountCashMinorUnits: '0',
    accountPositionShares: '0',
    accountOrderCount: '0',
    identityQuantityShares: '0',
    identityNotionalMinorUnits: '0',
    identityCashMinorUnits: '0',
    identityPositionShares: '0',
    identityOrderCount: '0',
    accountDailyLossLimitMinorUnits: '0',
    identityDailyLossLimitMinorUnits: '0',
});

function formFromView(view: SmartOrderRuntimeRiskPolicyView): FormState {
    const policy = view.policy;
    if (!policy) return EMPTY_FORM;
    const value = (candidate: number | null) =>
        candidate === null ? '' : String(candidate);
    return Object.freeze({
        buyFeeBps: String(policy.executionPolicy.buyFeeBps),
        minimumBuyFeeMinorUnits: String(
            policy.executionPolicy.minimumBuyFeeMinorUnits,
        ),
        cashBufferMinorUnits: String(
            policy.executionPolicy.cashBufferMinorUnits,
        ),
        accountQuantityShares: value(policy.accountLimits.quantityShares),
        accountNotionalMinorUnits: value(
            policy.accountLimits.notionalMinorUnits,
        ),
        accountCashMinorUnits: value(policy.accountLimits.cashMinorUnits),
        accountPositionShares: value(policy.accountLimits.positionShares),
        accountOrderCount: value(policy.accountLimits.orderCount),
        identityQuantityShares: value(policy.identityLimits.quantityShares),
        identityNotionalMinorUnits: value(
            policy.identityLimits.notionalMinorUnits,
        ),
        identityCashMinorUnits: value(policy.identityLimits.cashMinorUnits),
        identityPositionShares: value(policy.identityLimits.positionShares),
        identityOrderCount: value(policy.identityLimits.orderCount),
        accountDailyLossLimitMinorUnits: String(
            policy.accountDailyLossLimitMinorUnits,
        ),
        identityDailyLossLimitMinorUnits: String(
            policy.identityDailyLossLimitMinorUnits,
        ),
    });
}

function integer(value: string): number | null | undefined {
    if (value === '') return null;
    if (!/^(?:0|[1-9]\d*)$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function formPolicy(form: FormState): SmartOrderRuntimeRiskPolicyEditorInput | null {
    const entries = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, integer(value)]),
    ) as Record<keyof FormState, number | null | undefined>;
    if (Object.values(entries).some((value) => value === undefined)) return null;
    for (const key of [
        'buyFeeBps',
        'minimumBuyFeeMinorUnits',
        'cashBufferMinorUnits',
        'accountDailyLossLimitMinorUnits',
        'identityDailyLossLimitMinorUnits',
    ] as const) {
        if (entries[key] === null) return null;
    }
    const limits = (prefix: 'account' | 'identity'): SmartOrderRiskLimitVector =>
        Object.freeze({
            quantityShares: entries[`${prefix}QuantityShares`],
            notionalMinorUnits: entries[`${prefix}NotionalMinorUnits`],
            cashMinorUnits: entries[`${prefix}CashMinorUnits`],
            positionShares: entries[`${prefix}PositionShares`],
            orderCount: entries[`${prefix}OrderCount`],
        }) as SmartOrderRiskLimitVector;
    return Object.freeze({
        schemaVersion: EDITOR_SCHEMA,
        buyFeeBps: entries.buyFeeBps as number,
        minimumBuyFeeMinorUnits: entries.minimumBuyFeeMinorUnits as number,
        cashBufferMinorUnits: entries.cashBufferMinorUnits as number,
        accountLimits: limits('account'),
        identityLimits: limits('identity'),
        accountDailyLossLimitMinorUnits:
            entries.accountDailyLossLimitMinorUnits as number,
        identityDailyLossLimitMinorUnits:
            entries.identityDailyLossLimitMinorUnits as number,
    });
}

const FIELD_GROUPS = Object.freeze([
    {
        title: '成交成本 projection（minor units）',
        fields: [
            ['buyFeeBps', '買進費率（bps）'],
            ['minimumBuyFeeMinorUnits', '最低買進費用'],
            ['cashBufferMinorUnits', '現金安全 buffer'],
        ],
    },
    {
        title: '單一帳號曝險上限',
        fields: [
            ['accountQuantityShares', '總股數'],
            ['accountNotionalMinorUnits', '總名目金額'],
            ['accountCashMinorUnits', '總現金占用'],
            ['accountPositionShares', '持股股數'],
            ['accountOrderCount', '工作買單數'],
            ['accountDailyLossLimitMinorUnits', '當日損失上限'],
        ],
    },
    {
        title: '同一身分群組曝險上限',
        fields: [
            ['identityQuantityShares', '總股數'],
            ['identityNotionalMinorUnits', '總名目金額'],
            ['identityCashMinorUnits', '總現金占用'],
            ['identityPositionShares', '持股股數'],
            ['identityOrderCount', '工作買單數'],
            ['identityDailyLossLimitMinorUnits', '當日損失上限'],
        ],
    },
] as const);

export function SmartOrderRiskPolicyEditor() {
    const [view, setView] = useState<SmartOrderRuntimeRiskPolicyView | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const operations = useRef(new SmartOrderLogicalOperationRegistry());

    const refresh = useCallback(async () => {
        try {
            const next = await fetchSmartOrderRuntimeRiskPolicy();
            setView(next);
            setForm(formFromView(next));
            setError(null);
        } catch {
            setView(null);
            setError('無法讀取 Runtime RiskPolicy；新增曝險維持封鎖。');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => void refresh(), [refresh]);
    const policy = useMemo(() => formPolicy(form), [form]);

    const publish = async () => {
        if (!policy || !view || saving) return;
        if (
            !window.confirm(
                '發布 RiskPolicy 會使 Runtime 立即回到 reconciling，舊 exposure heads 失效；完整固定帳號對帳完成前不會允許新增曝險。確定發布？',
            )
        ) {
            return;
        }
        const fingerprint = JSON.stringify({
            expectedRevision: view.revision,
            policy,
        });
        const operationId = operations.current.operationIdFor(
            'risk-policy-publish',
            fingerprint,
        );
        setSaving(true);
        setError(null);
        try {
            const next = await publishSmartOrderRuntimeRiskPolicy({
                operationId,
                expectedRevision: view.revision,
                policy,
            });
            operations.current.settle('risk-policy-publish');
            setView(next);
            setForm(formFromView(next));
        } catch (caught) {
            operations.current.settle('risk-policy-publish', caught);
            setError(
                caught instanceof SmartOrderLocalApiError
                    ? `Runtime 拒絕 RiskPolicy（${caught.code}）。`
                    : 'RiskPolicy 發布結果未知；已保留同一 operation ID，請先查核 Runtime。',
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <details className={styles.formSection}>
            <summary>
                Runtime RiskPolicy（{view?.state ?? (loading ? '讀取中' : '不可用')}）
            </summary>
            <p className={styles.fieldHelp}>
                此表單只編輯本機 Runtime 的版本化政策，不使用 localStorage，也不會直接送出任何 broker bytes。發布後必須重新完成固定帳號對帳。
                曝險維度留白代表停用，且帳號與身分群組必須成對留白；費率、buffer 與日損上限不得留白。
            </p>
            {error ? <div className={styles.error} role='alert'>{error}</div> : null}
            {FIELD_GROUPS.map((group) => (
                <section key={group.title} className={styles.formSection}>
                    <h4>{group.title}</h4>
                    <div className={styles.formGrid}>
                        {group.fields.map(([key, label]) => (
                            <label key={key} className={styles.field}>
                                <span>{label}</span>
                                <input
                                    inputMode='numeric'
                                    value={form[key]}
                                    onChange={(event) =>
                                        setForm((current) => ({
                                            ...current,
                                            [key]: event.target.value,
                                        }))
                                    }
                                    disabled={!view || saving}
                                />
                            </label>
                        ))}
                    </div>
                </section>
            ))}
            <div className={styles.actions}>
                <button
                    type='button'
                    className={styles.secondaryButton}
                    onClick={() => void refresh()}
                    disabled={saving}
                >
                    重新讀取
                </button>
                <button
                    type='button'
                    className={styles.primaryButton}
                    onClick={() => void publish()}
                    disabled={!policy || !view || saving}
                >
                    {saving ? '發布中…' : '發布並重新對帳'}
                </button>
            </div>
        </details>
    );
}
