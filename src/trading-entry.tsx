import { StrictMode, useEffect, useState } from 'react';
import type { Root } from 'react-dom/client';
import App from './App';
import { OnboardingSetup } from './components/onboarding-setup';
import { startAnalytics } from './lib/analytics';
import { bootstrap } from './lib/boot';
import { startRuntimeModeSync } from './lib/runtime-mode';
import { isTauri, loadDesktopSettings } from './lib/tauri';
import { initTheme } from './lib/theme-store';
import { startTriggerEngine } from './lib/trigger-engine';

// Keep the normal trading application as one static module graph. Loading its
// Vanilla Extract styles through several concurrent dynamic imports can race
// the Vite compiler during a cold start and leave onboarding-setup.css.ts
// without generated CSS.
function AppGate() {
    const [needsSetup, setNeedsSetup] = useState<boolean | null>(
        isTauri ? null : false,
    );
    useEffect(() => {
        if (!isTauri) return;
        void loadDesktopSettings().then((settings) =>
            setNeedsSetup(!settings.apiKey || !settings.secretKey),
        );
    }, []);
    if (needsSetup === null) return null;
    return needsSetup ? <OnboardingSetup /> : <App />;
}

export function renderTradingApp(root: Root) {
    initTheme();
    startAnalytics();
    startTriggerEngine();
    startRuntimeModeSync();
    bootstrap();

    root.render(
        <StrictMode>
            <AppGate />
        </StrictMode>,
    );
}
