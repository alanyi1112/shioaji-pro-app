import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { createConnection } from 'node:net';

const SLOT = Symbol.for('realtimestock.multiview.listener-liveness.v1');
export const LISTENER_GRACE_MS = 60_000;
export const LISTENER_POLL_MS = 5_000;

export function createListenerLivenessState(graceMs = LISTENER_GRACE_MS) {
  if (!Number.isFinite(graceMs) || graceMs <= 0) throw new TypeError('invalid_listener_grace');
  let armed = false, missingSince = null, failed = false;
  return {
    arm() { armed = true; },
    observe(listening, now) {
      if (failed) return false;
      if (listening) { armed = true; missingSince = null; return false; }
      if (!armed) return false;
      missingSince ??= now;
      if (now - missingSince < graceMs) return false;
      failed = true;
      return true;
    },
    resetGrace() { missingSince = null; },
    snapshot() { return { armed, missingSince, failed, graceMs }; },
  };
}

// A retained Node handle is not sufficient evidence that the kernel listener is
// reachable. This is a bounded loopback TCP handshake: no HTTP, SSE or payload.
export function probeLocalListener(port = 5174) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once('error', () => done(false));
    socket.once('connect', () => done(true));
  });
}

// Process-scoped ownership survives Vite's config-module replacement. Old timers
// must not observe an obsolete server while its replacement starts listening.
export function installListenerLivenessGuard(server, options = {}) {
  const host = options.host ?? process;
  const previous = host[SLOT];
  const state = previous?.state ?? createListenerLivenessState(options.graceMs);
  previous?.stop();
  state.resetGrace();
  const clock = options.clock ?? (() => performance.now());
  const clear = options.clearTimer ?? clearInterval;
  const start = options.startTimer ?? setInterval;
  const probe = options.probe ?? probeLocalListener;
  const fail = options.fail ?? (() => {
    process.stderr.write('{"event":"multiview_listener_lost","reason":"listener_closed_beyond_grace","exitCode":86}\n');
    process.exit(86);
  });
  let stopped = false;
  let pending = false;
  let timer;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clear(timer);
    server.httpServer?.removeListener('listening', tick);
    host.removeListener('SIGTERM', stop);
    host.removeListener('SIGINT', stop);
    if (host[SLOT]?.stop === stop) delete host[SLOT];
  };
  const tick = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      const listening = server.httpServer?.listening === true;
      if (listening) state.arm();
      let reachable = false;
      if (listening) {
        try { reachable = await probe(); } catch { /* fail closed, without raw errors */ }
      }
      if (!stopped && state.observe(listening && reachable, clock())) {
        stop();
        fail();
      }
    } finally {
      pending = false;
    }
  };
  timer = start(tick, options.pollMs ?? LISTENER_POLL_MS);
  timer.unref?.();
  host.once('SIGTERM', stop);
  host.once('SIGINT', stop);
  host[SLOT] = { state, stop };
  // Capture the first listen even when it closes before the next 5-second tick.
  server.httpServer?.once('listening', tick);
  tick();
  return { state, stop };
}

/** @returns {import('vite').Plugin} */
export function localListenerLivenessPlugin() {
  return {
    name: 'multiview-local-listener-liveness',
    apply: 'serve',
    configureServer(server) {
      installListenerLivenessGuard(server);
      server.middlewares.use((request, response, next) => {
        if (request.url === '/api/health') response.setHeader('x-multiview-listener-guard', 'v1');
        next();
      });
    },
  };
}
