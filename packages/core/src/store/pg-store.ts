import { and, desc, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { EVENT_NAMES, PROBES, isEventName, isProbeId } from "../types.ts";
import type {
  ArtifactRow,
  CorpusRow,
  EventName,
  EventRow,
  FunnelRow,
  IntentRow,
  Json,
  ProbeDecision,
  ProbeId,
  ProbeStateRow,
  SessionRow,
} from "../types.ts";
import * as t from "./schema.ts";
import type { Store } from "./types.ts";

/** DDL kept as plain SQL so no migration tooling is needed to stand this up. */
export const CREATE_TABLES_SQL = `
create table if not exists sessions (
  id text primary key,
  probe text not null,
  created_at timestamptz not null default now(),
  user_agent text,
  referrer text
);
create index if not exists sessions_probe_idx on sessions (probe, created_at);

create table if not exists events (
  id text primary key,
  session_id text not null,
  probe text not null,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_probe_name_idx on events (probe, name);
create index if not exists events_session_idx on events (session_id);

create table if not exists intents (
  id text primary key,
  session_id text not null,
  probe text not null,
  email text not null,
  plan text not null,
  amount_minor bigint not null,
  currency text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists intents_probe_idx on intents (probe, created_at);

create table if not exists corpus (
  id text primary key,
  probe text not null,
  kind text not null,
  input_hash text not null,
  input jsonb not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists corpus_probe_idx on corpus (probe, created_at);
create unique index if not exists corpus_probe_hash_idx on corpus (probe, input_hash);

create table if not exists artifacts (
  id text primary key,
  probe text not null,
  session_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists artifacts_probe_idx on artifacts (probe, created_at);

create table if not exists probe_states (
  probe text primary key,
  decision text not null default 'undecided',
  note text,
  updated_at timestamptz not null default now()
);
`;

export class PgStore implements Store {
  readonly kind = "postgres" as const;

  private readonly sql: postgres.Sql;
  private readonly db: PostgresJsDatabase<typeof t>;
  private migrated: Promise<void> | null = null;

  constructor(url: string) {
    // Serverless-friendly pool: Supabase/Neon free tiers cap connections hard.
    this.sql = postgres(url, { max: 3, idle_timeout: 20, prepare: false });
    this.db = drizzle(this.sql, { schema: t });
  }

  /** Idempotent, run-once-per-process DDL. Cheaper than shipping a migrator. */
  private ready(): Promise<void> {
    this.migrated ??= this.sql.unsafe(CREATE_TABLES_SQL).then(() => undefined);
    return this.migrated;
  }

  async ensureSession(row: SessionRow): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.sessions)
      .values({
        id: row.id,
        probe: row.probe,
        createdAt: new Date(row.createdAt),
        userAgent: row.userAgent,
        referrer: row.referrer,
      })
      .onConflictDoNothing();
  }

  async recordEvent(row: EventRow): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.events)
      .values({
        id: row.id,
        sessionId: row.sessionId,
        probe: row.probe,
        name: row.name,
        props: row.props,
        createdAt: new Date(row.createdAt),
      })
      .onConflictDoNothing();
  }

  async saveIntent(row: IntentRow): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.intents)
      .values({
        id: row.id,
        sessionId: row.sessionId,
        probe: row.probe,
        email: row.email,
        plan: row.plan,
        amountMinor: row.amountMinor,
        currency: row.currency,
        note: row.note,
        createdAt: new Date(row.createdAt),
      })
      .onConflictDoNothing();
  }

  async saveCorpus(row: CorpusRow): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.corpus)
      .values({
        id: row.id,
        probe: row.probe,
        kind: row.kind,
        inputHash: row.inputHash,
        input: row.input,
        output: row.output,
        createdAt: new Date(row.createdAt),
      })
      .onConflictDoNothing();
  }

  async saveArtifact(row: ArtifactRow): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.artifacts)
      .values({
        id: row.id,
        probe: row.probe,
        sessionId: row.sessionId,
        payload: row.payload,
        createdAt: new Date(row.createdAt),
      })
      .onConflictDoNothing();
  }

  async getArtifact(id: string): Promise<ArtifactRow | null> {
    await this.ready();
    const [row] = await this.db.select().from(t.artifacts).where(eq(t.artifacts.id, id)).limit(1);
    if (!row || !isProbeId(row.probe)) return null;
    return {
      id: row.id,
      probe: row.probe,
      sessionId: row.sessionId,
      payload: row.payload as Json,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getProbeStates(): Promise<ProbeStateRow[]> {
    await this.ready();
    const rows = await this.db.select().from(t.probeStates);
    const byProbe = new Map(rows.map((r) => [r.probe, r]));
    return PROBES.map((probe) => {
      const row = byProbe.get(probe);
      const decision = row?.decision;
      return {
        probe,
        decision:
          decision === "keep" || decision === "kill" ? decision : ("undecided" as ProbeDecision),
        note: row?.note ?? null,
        updatedAt: (row?.updatedAt ?? new Date(0)).toISOString(),
      };
    });
  }

  async setProbeDecision(
    probe: ProbeId,
    decision: ProbeDecision,
    note: string | null,
  ): Promise<void> {
    await this.ready();
    await this.db
      .insert(t.probeStates)
      .values({ probe, decision, note, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: t.probeStates.probe,
        set: { decision, note, updatedAt: new Date() },
      });
  }

  async funnel(): Promise<FunnelRow[]> {
    await this.ready();
    // Distinct sessions per (probe, event), matching FileStore's definition.
    const eventRows = await this.db
      .select({
        probe: t.events.probe,
        name: t.events.name,
        sessions: sql<number>`count(distinct ${t.events.sessionId})::int`,
      })
      .from(t.events)
      .groupBy(t.events.probe, t.events.name);

    const sessionRows = await this.db
      .select({ probe: t.sessions.probe, total: sql<number>`count(*)::int` })
      .from(t.sessions)
      .groupBy(t.sessions.probe);

    const intentRows = await this.db
      .select({
        probe: t.intents.probe,
        total: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${t.intents.amountMinor}), 0)::bigint`,
      })
      .from(t.intents)
      .groupBy(t.intents.probe);

    return PROBES.map((probe) => {
      const counts = Object.fromEntries(EVENT_NAMES.map((n) => [n, 0])) as Record<EventName, number>;
      for (const row of eventRows) {
        if (row.probe === probe && isEventName(row.name)) counts[row.name] = Number(row.sessions);
      }
      const intent = intentRows.find((r) => r.probe === probe);
      return {
        probe,
        sessions: Number(sessionRows.find((r) => r.probe === probe)?.total ?? 0),
        counts,
        intents: Number(intent?.total ?? 0),
        intentValueMinor: Number(intent?.value ?? 0),
      };
    });
  }

  async recentIntents(limit: number): Promise<IntentRow[]> {
    await this.ready();
    const rows = await this.db
      .select()
      .from(t.intents)
      .orderBy(desc(t.intents.createdAt))
      .limit(limit);
    return rows.flatMap((r) =>
      isProbeId(r.probe)
        ? [
            {
              id: r.id,
              sessionId: r.sessionId,
              probe: r.probe,
              email: r.email,
              plan: r.plan,
              amountMinor: Number(r.amountMinor),
              currency: r.currency === "USD" ? ("USD" as const) : ("INR" as const),
              note: r.note,
              createdAt: r.createdAt.toISOString(),
            },
          ]
        : [],
    );
  }

  async listCorpus(probe: ProbeId, kind: string | null, limit: number): Promise<CorpusRow[]> {
    await this.ready();
    const where = kind === null ? eq(t.corpus.probe, probe) : and(eq(t.corpus.probe, probe), eq(t.corpus.kind, kind));
    const rows = await this.db
      .select()
      .from(t.corpus)
      .where(where)
      .orderBy(desc(t.corpus.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      probe,
      kind: r.kind,
      inputHash: r.inputHash,
      input: r.input as Json,
      output: r.output as Json,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async corpusCounts(): Promise<Record<string, number>> {
    await this.ready();
    const rows = await this.db
      .select({ probe: t.corpus.probe, total: sql<number>`count(*)::int` })
      .from(t.corpus)
      .groupBy(t.corpus.probe);
    const out: Record<string, number> = Object.fromEntries(PROBES.map((p) => [p, 0]));
    for (const row of rows) out[row.probe] = Number(row.total);
    return out;
  }

  /** Only used by scripts; serverless request handlers should never call this. */
  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
