import path from 'node:path';
import { realpathSync } from 'node:fs';

// 排程只使用專案支援的 Node 24；避免以 shell 當下的 Node 26 安裝永久工作。
export function resolveMonitorLaunchNode({ executable = process.execPath,
    version = process.versions.node, platform = process.platform,
    realpath = realpathSync } = {}) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
    if (!match || Number(match[1]) !== 24 || Number(match[2]) < 15 ||
        !path.isAbsolute(executable ?? '')) throw new Error('monitor_node_24_required');
    if (platform === 'darwin' && executable.startsWith('/opt/homebrew/Cellar/node@24/')) {
        const stable = '/opt/homebrew/opt/node@24/bin/node';
        if (realpath(stable) !== realpath(executable)) throw new Error('monitor_node_stable_path_mismatch');
        return stable;
    }
    return executable;
}
