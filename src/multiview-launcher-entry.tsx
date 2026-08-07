import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { MultiViewLauncher } from './components/multiview-launcher';
import { initTheme } from './lib/theme-store';

export function renderMultiViewLauncher(root: Root) {
    initTheme();
    root.render(
        <StrictMode>
            <MultiViewLauncher />
        </StrictMode>,
    );
}
