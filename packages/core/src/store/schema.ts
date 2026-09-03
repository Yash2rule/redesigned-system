import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One schema shared by every probe. `probe` is the discriminator on every
 * table so the admin dashboard is a single grouped query rather than a union
 * across four sets of tables.
 */

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    probe: text("probe").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    referrer: text("referrer"),
  },
  (t) => [index("sessions_probe_idx").on(t.probe, t.createdAt)],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    probe: text("probe").notNull(),
    name: text("name").notNull(),
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_probe_name_idx").on(t.probe, t.name),
    index("events_session_idx").on(t.sessionId),
  ],
);

export const intents = pgTable(
  "intents",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    probe: text("probe").notNull(),
    email: text("email").notNull(),
    plan: text("plan").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intents_probe_idx").on(t.probe, t.createdAt)],
);

/**
 * Every anonymised input/output pair, per probe. This is the data moat: the
 * comparison feature in the offer decoder and the categorisation quality in
 * the ledger both improve as this table grows.
 *
 * `input` is redacted before it ever reaches here — see corpus/redact.ts.
 */
export const corpus = pgTable(
  "corpus",
  {
    id: text("id").primaryKey(),
    probe: text("probe").notNull(),
    kind: text("kind").notNull(),
    inputHash: text("input_hash").notNull(),
    input: jsonb("input").notNull(),
    output: jsonb("output").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("corpus_probe_idx").on(t.probe, t.createdAt),
    uniqueIndex("corpus_probe_hash_idx").on(t.probe, t.inputHash),
  ],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    probe: text("probe").notNull(),
    sessionId: text("session_id"),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifacts_probe_idx").on(t.probe, t.createdAt)],
);

export const probeStates = pgTable("probe_states", {
  probe: text("probe").primaryKey(),
  decision: text("decision").notNull().default("undecided"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
