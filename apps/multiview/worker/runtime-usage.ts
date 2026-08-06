type InvocationKind = "request" | "scheduled";
type CacheEvent = "hit" | "miss" | "stale" | "read_failure" | "write_failure";

type RuntimeCounters = {
  startedAt: string;
  requests: number;
  scheduledInvocations: number;
  d1Queries: number;
  d1Writes: number;
  cacheHits: number;
  cacheMisses: number;
  cacheStale: number;
  cacheReadFailures: number;
  cacheWriteFailures: number;
};

const counters: RuntimeCounters = {
  startedAt: new Date().toISOString(),
  requests: 0,
  scheduledInvocations: 0,
  d1Queries: 0,
  d1Writes: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheStale: 0,
  cacheReadFailures: 0,
  cacheWriteFailures: 0,
};

const databaseProxies = new WeakMap<object, D1Database>();
const rawStatements = new WeakMap<object, D1PreparedStatement>();
const statementSql = new WeakMap<object, string>();

function isWriteSql(sql: string) {
  return /^(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|PRAGMA\s+(?!table_info))/i.test(sql.trim());
}

function recordStatement(sql: string) {
  if (isWriteSql(sql)) counters.d1Writes += 1;
  else counters.d1Queries += 1;
}

function wrapStatement(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
  const proxy = new Proxy(statement as object, {
    get(target, property, receiver) {
      if (property === "bind") {
        return (...values: unknown[]) => wrapStatement(Reflect.apply(Reflect.get(target, property, receiver) as (...args: unknown[]) => D1PreparedStatement, target, values), sql);
      }
      if (["first", "all", "raw", "run"].includes(String(property))) {
        return (...values: unknown[]) => {
          recordStatement(sql);
          return Reflect.apply(Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown, target, values);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as D1PreparedStatement;
  rawStatements.set(proxy as object, statement);
  statementSql.set(proxy as object, sql);
  return proxy;
}

export function meterD1Database(database?: D1Database): D1Database | undefined {
  if (!database) return undefined;
  const key = database as object;
  const existing = databaseProxies.get(key);
  if (existing) return existing;
  const proxy = new Proxy(database as object, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => wrapStatement(Reflect.apply(Reflect.get(target, property, receiver) as (value: string) => D1PreparedStatement, target, [sql]), sql);
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          for (const statement of statements) recordStatement(statementSql.get(statement as object) || "SELECT 1");
          const unwrapped = statements.map((statement) => rawStatements.get(statement as object) || statement);
          return Reflect.apply(Reflect.get(target, property, receiver) as (values: D1PreparedStatement[]) => Promise<D1Result<unknown>[]>, target, [unwrapped]);
        };
      }
      if (property === "exec") {
        return (sql: string) => {
          for (const statement of sql.split(";").map((value) => value.trim()).filter(Boolean)) recordStatement(statement);
          return Reflect.apply(Reflect.get(target, property, receiver) as (value: string) => Promise<D1ExecResult>, target, [sql]);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as D1Database;
  databaseProxies.set(key, proxy);
  databaseProxies.set(proxy as object, proxy);
  return proxy;
}

export function recordRuntimeInvocation(kind: InvocationKind) {
  if (kind === "request") counters.requests += 1;
  else counters.scheduledInvocations += 1;
}

export function recordCacheEvent(event: CacheEvent) {
  if (event === "hit") counters.cacheHits += 1;
  else if (event === "miss") counters.cacheMisses += 1;
  else if (event === "stale") counters.cacheStale += 1;
  else if (event === "read_failure") counters.cacheReadFailures += 1;
  else counters.cacheWriteFailures += 1;
}

export function runtimeUsageSummary() {
  return {
    scope: "worker_isolate",
    startedAt: counters.startedAt,
    requests: counters.requests,
    scheduledInvocations: counters.scheduledInvocations,
    d1: { queries: counters.d1Queries, writes: counters.d1Writes },
    cache: {
      hits: counters.cacheHits,
      misses: counters.cacheMisses,
      stale: counters.cacheStale,
      readFailures: counters.cacheReadFailures,
      writeFailures: counters.cacheWriteFailures,
    },
  };
}

export function resetRuntimeUsageForTest() {
  counters.startedAt = new Date().toISOString();
  counters.requests = 0;
  counters.scheduledInvocations = 0;
  counters.d1Queries = 0;
  counters.d1Writes = 0;
  counters.cacheHits = 0;
  counters.cacheMisses = 0;
  counters.cacheStale = 0;
  counters.cacheReadFailures = 0;
  counters.cacheWriteFailures = 0;
}
