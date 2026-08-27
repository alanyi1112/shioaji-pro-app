export interface SmartOrderManualResolutionPolicyRow {
    readonly reasonCode: string;
    readonly requiredEvidence: readonly string[];
    readonly allowedOperations: readonly string[];
    readonly breakGlassAllowed: boolean;
    readonly oldIntentDisposition: 'never_resend';
}

export const SMART_ORDER_MANUAL_RESOLUTION_POLICY_SCHEMA_VERSION: string;
export const SMART_ORDER_MANUAL_RESOLUTION_POLICY: readonly SmartOrderManualResolutionPolicyRow[];
export function smartOrderManualResolutionPolicyRow(
    reasonCode: string,
): SmartOrderManualResolutionPolicyRow | undefined;
