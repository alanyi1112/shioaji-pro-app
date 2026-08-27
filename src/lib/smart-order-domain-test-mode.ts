// Production and direct Node/tsx imports always resolve this real module.
// Vitest alone aliases the import to the sibling test-mode module in vite.config.ts.
export const SMART_ORDER_DOMAIN_TEST_MODE = false;
