import { spawn } from 'node:child_process';

const DEFAULT_SOUND = '/System/Library/Sounds/Glass.aiff';

export function notifySmartOrderAuthorizationRequired({
    platform = process.platform,
    spawnImpl = spawn,
    testRun = process.env.VITEST === 'true',
} = {}) {
    if (testRun || platform !== 'darwin' || typeof spawnImpl !== 'function') {
        return false;
    }
    try {
        const child = spawnImpl('/usr/bin/afplay', [DEFAULT_SOUND], {
            detached: true,
            stdio: 'ignore',
        });
        child.once?.('error', () => {});
        child.unref?.();
        return true;
    } catch {
        return false;
    }
}
