// src/main.tsx

// polyfills MUST stay the first import — patches globals (structuredClone,
// AbortSignal.timeout, …) before any dependency module evaluates
import './lib/polyfills';
import { createRoot } from 'react-dom/client';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element #root not found');
}

const root = createRoot(rootElement);
const isMultiViewLauncher =
    new URLSearchParams(window.location.search).get('popout') ===
    'multiview-launcher';
const isStockScreener =
    new URLSearchParams(window.location.search).get('popout') === 'screener';

async function render() {
    if (isMultiViewLauncher) {
        const { renderMultiViewLauncher } = await import(
            './multiview-launcher-entry'
        );
        renderMultiViewLauncher(root);
        return;
    }
    if (isStockScreener) {
        const { renderStockScreener } = await import('./stock-screener-entry');
        renderStockScreener(root);
        return;
    }

    const { renderTradingApp } = await import('./trading-entry');
    renderTradingApp(root);
}

void render();
