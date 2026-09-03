import path from "node:path";
import { env } from "../env.ts";
import { FileStore } from "./file-store.ts";
import { PgStore } from "./pg-store.ts";
import type { Store } from "./types.ts";

export { FileStore } from "./file-store.ts";
export { PgStore, CREATE_TABLES_SQL } from "./pg-store.ts";
export type { Store } from "./types.ts";
export * as schema from "./schema.ts";

let cached: Store | null = null;

/**
 * Postgres when DATABASE_URL is set, JSON files otherwise. One instance per
 * process so the Postgres pool is not recreated on every request.
 */
export function getStore(): Store {
  if (cached) return cached;
  const url = env.databaseUrl;
  cached = url ? new PgStore(url) : new FileStore(env.dataDir ?? path.join(process.cwd(), ".data"));
  return cached;
}

/** Tests use this to point the store at a scratch directory. */
export function setStore(store: Store | null): void {
  cached = store;
}
