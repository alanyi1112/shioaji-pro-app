import type { Plugin } from 'vite';

export interface IntradayMonitorLocalApiGatewayOptions {
    appSupportRoot: string;
    runtimeFactory?: (appSupportRoot: string) => {
        service: object;
        close(): void;
    };
}

export function intradayMonitorLocalApiGateway(
    options: IntradayMonitorLocalApiGatewayOptions,
): Plugin;
