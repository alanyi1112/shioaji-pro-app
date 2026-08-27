declare const domainIdBrand: unique symbol;

export type DomainId<Name extends string> = string & {
    readonly [domainIdBrand]: Name;
};

/**
 * Canonical Taiwan stock contract identity shared by the smart-order domain
 * modules. Keeping this type in an import-free module lets pure verifiers use
 * it without loading the application/Vite-facing smart-order implementation.
 */
export type CanonicalContractKey = DomainId<'CanonicalContractKey'>;
