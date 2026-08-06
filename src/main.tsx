// src/main.tsx

// polyfills MUST stay the first import — patches globals (structuredClone,
// AbortSignal.timeout, …) before any dependency module evaluates
import './lib/polyfills';
import { StrictMode, useEffect, useState } from 'react';
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

async function render() {
    if (isMultiViewLauncher) {
        const [{ MultiViewLauncher }, { initTheme }] = await Promise.all([
            import('./components/multiview-launcher'),
            import('./lib/theme-store'),
        ]);
        initTheme();
        root.render(
            <StrictMode>
                <MultiViewLauncher />
            </StrictMode>,
        );
        return;
    }

    const [
        { default: App },
        { OnboardingSetup },
        { startAnalytics },
        { bootstrap },
        { isTauri, loadDesktopSettings },
        { initTheme },
        { startTriggerEngine },
        { startRuntimeModeSync },
    ] = await Promise.all([
        import('./App'),
        import('./components/onboarding-setup'),
        import('./lib/analytics'),
        import('./lib/boot'),
        import('./lib/tauri'),
        import('./lib/theme-store'),
        import('./lib/trigger-engine'),
        import('./lib/runtime-mode'),
    ]);

    initTheme();
    startAnalytics();
    startTriggerEngine();
    startRuntimeModeSync();
    bootstrap();

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

    root.render(
        <StrictMode>
            <AppGate />
        </StrictMode>,
    );
}

void render();
