import { expect, it, vi } from 'vitest';
import { createAppUpdateChecker } from './app-update-client';
const rev = (n: number) => n.toString().repeat(64);
function fixture() {
    let now = 0, revision = rev(2);
    const checkpoint = vi.fn(() => true), reload = vi.fn(), canReload = vi.fn(() => true);
    const readRevision = vi.fn(async () => ({ revision }));
    const checker = createAppUpdateChecker({ loadedRevision: rev(1), readRevision, checkpoint, reload, canReload, now: () => now });
    return { ...checker, reload, checkpoint, canReload, readRevision, time: (n: number) => { now = n; }, revision: (v: string) => { revision = v; } };
}
it('錯過HMR也能由兩次穩定版本確認後先保存再重載，僅一次', async () => {
    const f = fixture(); await f.check(); expect(f.reload).not.toHaveBeenCalled();
    f.time(2_000); await f.check(); expect(f.checkpoint).toHaveBeenCalledOnce(); expect(f.reload).toHaveBeenCalledOnce();
    expect(f.checkpoint.mock.invocationCallOrder[0]).toBeLessThan(f.reload.mock.invocationCallOrder[0]!);
    await f.check(); expect(f.reload).toHaveBeenCalledOnce();
});
it('同版與連續變更中的版本不重載', async () => {
    const f = fixture(); f.revision(rev(1)); await f.check(); f.time(30_000); await f.check(); expect(f.checkpoint).not.toHaveBeenCalled();
    f.revision(rev(2)); await f.check(); f.time(31_000); f.revision(rev(3)); await f.check(); f.time(32_000); await f.check(); expect(f.reload).not.toHaveBeenCalled();
    f.time(33_000); await f.check(); expect(f.reload).toHaveBeenCalledOnce();
});
it('操作中或保存失敗就保留畫面，下一次可安全接續', async () => {
    const f = fixture(); await f.check(); f.time(3_000); f.canReload.mockReturnValue(false); await f.check(); expect(f.checkpoint).not.toHaveBeenCalled();
    f.canReload.mockReturnValue(true); f.checkpoint.mockReturnValue(false); await f.check(); expect(f.reload).not.toHaveBeenCalled();
    f.checkpoint.mockReturnValue(true); await f.check(); expect(f.reload).toHaveBeenCalledOnce();
});
it('斷網、失敗、非法版本不重載且需重新確認', async () => {
    const f = fixture(); await f.check(); f.time(3_000); f.readRevision.mockRejectedValueOnce(Error('offline')); await f.check();
    await f.check(); expect(f.reload).not.toHaveBeenCalled(); f.time(6_000); f.revision('invalid'); await f.check(); expect(f.reload).not.toHaveBeenCalled();
});
it('停止或在途請求回應太晚不重載；不發平行檢查', async () => {
    const f = fixture(); let resolve!: (v: {revision: string}) => void;
    f.readRevision.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = f.check(); await f.check(); expect(f.readRevision).toHaveBeenCalledOnce(); f.stop(); resolve({revision: rev(2)}); await pending; await f.check(); expect(f.reload).not.toHaveBeenCalled();
});
