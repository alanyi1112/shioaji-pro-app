export class LatestWinsScheduler {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private latestJob: (() => void) | null = null;

    constructor(private readonly delayMs = 120) {
        if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 500) {
            throw new RangeError('delayMs must be between 0 and 500');
        }
    }

    schedule(job: () => void) {
        this.latestJob = job;
        if (this.timer !== null) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            const latest = this.latestJob;
            this.latestJob = null;
            latest?.();
        }, this.delayMs);
    }

    invalidate() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.latestJob = null;
    }

    hasPendingJob() {
        return this.timer !== null;
    }
}
