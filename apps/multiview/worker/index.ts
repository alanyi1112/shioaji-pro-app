/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAppRequest, markDeployTimeMigrations, runChipBackfillScheduled, type Env } from "./app";
import { authorizeCloudflarePrincipal } from "./access-control";
import { prepareRequestPrincipal } from "./request-principal";
import { cleanupExpiredCandleCache } from "./cache-maintenance";
import { meterD1Database, recordRuntimeInvocation } from "./runtime-usage";
import { handleRealtimeRoute } from "./realtime-routing";
import { handleLocalShioajiAdapter } from "./local-shioaji-adapter";
import { handleLocalOrderTicketBridge } from "./local-order-ticket-bridge";
import { handleLocalMaintenance } from "./local-maintenance";
import { withLocalLauncherCors } from "./local-launcher-cors";

export { RealtimeMarketHub } from "./realtime-hub";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    recordRuntimeInvocation("request");
    env = { ...env, DB: meterD1Database(env.DB) };
    const url = new URL(request.url);
    if (String(env.DEPLOYMENT_TARGET || "").toLowerCase() === "cloudflare") markDeployTimeMigrations(env.DB);
    const authenticationFailure = await prepareRequestPrincipal(request, env);
    if (authenticationFailure) return authenticationFailure;
    const authorizationFailure = await authorizeCloudflarePrincipal(request, env.DB, env.ACCESS_OWNER_EMAIL);
    if (authorizationFailure) return authorizationFailure;

    const localShioajiResponse = await handleLocalShioajiAdapter(request, env);
    if (localShioajiResponse) return withLocalLauncherCors(request, localShioajiResponse);
    const localOrderTicketResponse = await handleLocalOrderTicketBridge(request, env);
    if (localOrderTicketResponse) return localOrderTicketResponse;
    const localMaintenanceResponse = await handleLocalMaintenance(request, env, ctx, {
      async daily(currentEnv, scheduledTime) {
        const typedEnv = currentEnv as Env;
        await cleanupExpiredCandleCache(typedEnv.DB, new Date(scheduledTime));
        await runChipBackfillScheduled(typedEnv, scheduledTime);
      },
    });
    if (localMaintenanceResponse) return localMaintenanceResponse;

    const realtimeResponse = await handleRealtimeRoute(request, env);
    if (realtimeResponse) return realtimeResponse;

    const appResponse = await handleAppRequest(request, env, ctx);
    if (appResponse) return withLocalLauncherCors(request, appResponse);

    if (url.pathname === "/_vinext/image") {
      if (!env.IMAGES) return new Response("Image optimization is not configured", { status: 404 });
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: ExecutionContext): Promise<void> {
    recordRuntimeInvocation("scheduled");
    env = { ...env, DB: meterD1Database(env.DB) };
    if (String(env.DEPLOYMENT_TARGET || "").toLowerCase() === "cloudflare") markDeployTimeMigrations(env.DB);
    ctx.waitUntil((async () => {
      await cleanupExpiredCandleCache(env.DB, new Date(controller.scheduledTime));
      await runChipBackfillScheduled(env, controller.scheduledTime);
    })());
  },
};

export default worker;
