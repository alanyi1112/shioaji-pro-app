(function initLiveBatchCoordinator(globalScope) {
  const acceptance = globalScope.QuoteChartAcceptance;
  const DEFAULT_OPEN_DELAY_MS = 30000;
  const DEFAULT_CLOSED_DELAY_MS = 300000;
  const BACKGROUND_RETRY_DELAY_MS = 60000;

  function createLiveBatchCoordinator(options = {}) {
    const fetchImpl = options.fetchImpl || globalScope.fetch?.bind(globalScope);
    const setTimeoutImpl = options.setTimeoutImpl || globalScope.setTimeout?.bind(globalScope);
    const clearTimeoutImpl = options.clearTimeoutImpl || globalScope.clearTimeout?.bind(globalScope);
    const windowTarget = options.windowTarget || globalScope.window || globalScope;
    const documentTarget = options.documentTarget || globalScope.document;
    const isHidden = options.isHidden || (() => documentTarget?.hidden === true);
    const isOnline = options.isOnline || (() => globalScope.navigator?.onLine !== false);

    if (!fetchImpl || !setTimeoutImpl || !clearTimeoutImpl) {
      throw new Error("live_batch_coordinator_dependencies_missing");
    }

    const subscriptions = new Map();
    let timer = null;
    let inFlight = false;
    let rerunRequested = false;
    let pollDelay = DEFAULT_OPEN_DELAY_MS;

    function clearScheduledRun() {
      if (timer === null) return;
      clearTimeoutImpl(timer);
      timer = null;
    }

    function schedule(delay = pollDelay) {
      if (timer !== null || !subscriptions.size) return;
      timer = setTimeoutImpl(() => {
        void run();
      }, delay);
    }

    function requestImmediate() {
      if (!subscriptions.size) return;
      if (inFlight) {
        rerunRequested = true;
        return;
      }
      clearScheduledRun();
      schedule(0);
    }

    async function run() {
      timer = null;
      if (!subscriptions.size) return;
      if (inFlight) {
        rerunRequested = true;
        return;
      }
      if (isHidden() || !isOnline()) {
        schedule(BACKGROUND_RETRY_DELAY_MS);
        return;
      }

      inFlight = true;
      rerunRequested = false;
      const snapshot = [...subscriptions.entries()];
      const snapshotById = new Map(snapshot);
      try {
        acceptance?.increment("requestCount");
        const response = await fetchImpl("/api/candles/batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requests: snapshot.map(([id, item]) => ({ id, ...item.request })),
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.reasonCode || "batch_refresh_failed");

        const sessions = (payload.items || [])
          .map((item) => item?.payload?.quote?.marketSession)
          .filter(Boolean);
        pollDelay = sessions.some((session) => session === "open" || session === "regular")
          ? DEFAULT_OPEN_DELAY_MS
          : DEFAULT_CLOSED_DELAY_MS;

        for (const item of payload.items || []) {
          const key = String(item.id);
          const snapshotSubscription = snapshotById.get(key);
          const subscription = subscriptions.get(key);
          if (!snapshotSubscription || subscription?.token !== snapshotSubscription.token) continue;
          try {
            if (item?.ok) subscription.onPayload(item);
            else subscription.onError(item);
          } catch {
            // A panel callback must not prevent the remaining panels from updating.
          }
        }
      } catch (error) {
        for (const [id, item] of snapshot) {
          if (subscriptions.get(id)?.token !== item.token) continue;
          try {
            item.onError(error);
          } catch {
            // Keep the coordinator alive even if a panel-level error hook fails.
          }
        }
      } finally {
        inFlight = false;
        if (!subscriptions.size) return;
        if (rerunRequested) requestImmediate();
        else schedule();
      }
    }

    windowTarget?.addEventListener?.("online", requestImmediate);
    documentTarget?.addEventListener?.("visibilitychange", () => {
      if (!isHidden()) requestImmediate();
    });

    return {
      subscribe(id, request, onPayload, onError = () => {}) {
        const key = String(id);
        const token = Symbol(key);
        subscriptions.set(key, { request, onPayload, onError, token });
        requestImmediate();
        return () => {
          if (subscriptions.get(key)?.token !== token) return;
          subscriptions.delete(key);
          if (!subscriptions.size) clearScheduledRun();
        };
      },
    };
  }

  globalScope.QuoteChartLiveBatch = {
    createLiveBatchCoordinator,
  };
})(globalThis);
