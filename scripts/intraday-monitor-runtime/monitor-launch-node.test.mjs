import { describe, it, expect } from 'vitest';
import { resolveMonitorLaunchNode } from './monitor-launch-node.mjs';

describe('monitor launch Node contract', () => {
    it('拒絕 unsupported 版本，不因 PATH 指向 Node 26 而重新產生排程', () => {
        for (const version of ['26.0.0', '25.0.0', '24.14.0', '22.18.0', '24.19.0-rc']) {
            expect(() => resolveMonitorLaunchNode({ version, executable: '/tmp/node' })).toThrow('monitor_node_24_required');
        }
    });
    it('Homebrew Node 24 採穩定 opt 路徑，升 patch 版不綁 Cellar 版本', () => {
        expect(resolveMonitorLaunchNode({ version: '24.19.0', platform: 'darwin',
            executable: '/opt/homebrew/Cellar/node@24/24.19.0/bin/node',
            realpath: () => '/verified/node24' })).toBe('/opt/homebrew/opt/node@24/bin/node');
    });
    it('穩定路徑指向另一個 binary 時拒絕', () => {
        expect(() => resolveMonitorLaunchNode({ version: '24.19.0', platform: 'darwin',
            executable: '/opt/homebrew/Cellar/node@24/24.19.0/bin/node', realpath: (value) => value })).toThrow('monitor_node_stable_path_mismatch');
    });
    it('其他平台保留已驗證的 absolute Node 24 path', () => {
        expect(resolveMonitorLaunchNode({ version: '24.15.0', platform: 'linux', executable: '/usr/bin/node' })).toBe('/usr/bin/node');
        expect(() => resolveMonitorLaunchNode({ version: '24.19.0', executable: 'node' })).toThrow('monitor_node_24_required');
    });
});
