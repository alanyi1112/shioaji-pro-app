import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from "jose";

export type DeploymentTarget = "codex-sites" | "cloudflare" | "local";

export type RequestPrincipal = {
  kind: "identity" | "user" | "service" | "local" | "anonymous";
  deploymentTarget: DeploymentTarget;
  userId: string | null;
  accessUserId?: string | null;
  accessRole?: "owner" | "member" | null;
};

export type RequestPrincipalEnv = {
  DEPLOYMENT_TARGET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

type VerifyOptions = { fetchImpl?: typeof fetch };

class RequestAuthenticationError extends Error {
  readonly reason: string;
  readonly status: number;

  constructor(reason: string, status = 403) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

const principalByRequest = new WeakMap<Request, RequestPrincipal>();
const remoteJwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizedTarget(env: RequestPrincipalEnv, request: Request): DeploymentTarget {
  if (["localhost", "127.0.0.1", "::1"].includes(new URL(request.url).hostname)) return "local";
  return String(env.DEPLOYMENT_TARGET || "codex-sites").trim().toLowerCase() === "cloudflare" ? "cloudflare" : "codex-sites";
}

function normalizedTeamDomain(value: string | undefined) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(text)) throw new RequestAuthenticationError("access_configuration_missing", 503);
  return text;
}

function machineRoute(request: Request) {
  const path = new URL(request.url).pathname;
  return path === "/api/health"
    || path === "/api/realtime/ingest"
    || path.startsWith("/api/internal/");
}

function remoteJwks(url: URL, fetchImpl?: typeof fetch) {
  if (fetchImpl) return createRemoteJWKSet(url, { [customFetch]: fetchImpl });
  const key = url.href;
  const cached = remoteJwksByUrl.get(key);
  if (cached) return cached;
  const created = createRemoteJWKSet(url);
  remoteJwksByUrl.set(key, created);
  return created;
}

export async function verifyCloudflareAccessToken(
  token: string,
  env: RequestPrincipalEnv,
  options: VerifyOptions = {},
): Promise<JWTPayload> {
  const issuer = normalizedTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = String(env.ACCESS_AUD || "").trim();
  if (!audience) throw new RequestAuthenticationError("access_configuration_missing", 503);
  const { payload } = await jwtVerify(token, remoteJwks(new URL(`${issuer}/cdn-cgi/access/certs`), options.fetchImpl), {
    issuer,
    audience,
    algorithms: ["RS256"],
  });
  return payload;
}

export async function prepareRequestPrincipal(
  request: Request,
  env: RequestPrincipalEnv,
  options: VerifyOptions = {},
): Promise<Response | null> {
  const deploymentTarget = normalizedTarget(env, request);
  if (deploymentTarget === "local") {
    const localUserId = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "local-sites-user";
    principalByRequest.set(request, { kind: "local", deploymentTarget, userId: localUserId });
    return null;
  }

  if (deploymentTarget === "codex-sites") {
    const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || null;
    principalByRequest.set(request, { kind: email ? "user" : "anonymous", deploymentTarget, userId: email });
    return null;
  }

  const token = request.headers.get("cf-access-jwt-assertion")?.trim();
  if (!token) return authenticationFailure("missing_access_token", 403);
  try {
    const payload = await verifyCloudflareAccessToken(token, env, options);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (email) {
      principalByRequest.set(request, { kind: "identity", deploymentTarget, userId: email, accessRole: null, accessUserId: null });
      return null;
    }
    if (!machineRoute(request)) throw new RequestAuthenticationError("user_email_missing", 403);
    principalByRequest.set(request, { kind: "service", deploymentTarget, userId: null });
    return null;
  } catch (error) {
    if (error instanceof RequestAuthenticationError) return authenticationFailure(error.reason, error.status);
    return authenticationFailure("invalid_access_token", 403);
  }
}

export function requestPrincipal(request: Request): RequestPrincipal {
  return principalByRequest.get(request) || {
    kind: "anonymous",
    deploymentTarget: "codex-sites",
    userId: null,
  };
}

export function authorizeRequestPrincipal(
  request: Request,
  access: { accessUserId: string; role: "owner" | "member" },
) {
  const principal = requestPrincipal(request);
  if (principal.deploymentTarget !== "cloudflare" || principal.kind !== "identity" || !principal.userId) {
    throw new RequestAuthenticationError("invalid_authorization_state", 500);
  }
  principalByRequest.set(request, {
    ...principal,
    kind: "user",
    accessUserId: access.accessUserId,
    accessRole: access.role,
  });
}

export function requestUserId(request: Request) {
  return requestPrincipal(request).userId;
}

export function hasTrustedPrincipal(request: Request) {
  return ["user", "service", "local"].includes(requestPrincipal(request).kind);
}

export function deploymentTargetForRequest(request: Request) {
  return requestPrincipal(request).deploymentTarget;
}

export function authenticationFailure(reason = "authentication_required", status = 401) {
  return new Response(JSON.stringify({ ok: false, reasonCode: reason }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
