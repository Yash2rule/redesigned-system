import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { EVENT_NAMES, PROBES } from "../types.ts";
import type {
  ArtifactRow,
  CorpusRow,
  EventName,
  EventRow,
  FunnelRow,
  IntentRow,
  ProbeDecision,
  ProbeId,
  ProbeStateRow,
  SessionRow,
} from "../types.ts";
import type { Store } from "./types.ts";

/**
 * Zero-dependency store used whenever DATABASE_URL is absent.
 *
 * Append-only JSONL for the high-volume collections (a single write() of a
 * short line to an O_APPEND fd does not interleave in practice, which is all
 * the durability a validation probe needs), and read-modify-write via a
 * temp-file rename for the tiny mutable ones.
 *
 * On a read-only or ephemeral filesystem (Vercel), writes fail and we fall
 * back to process memory. That is a real limitation, surfaced in /api/health
 * and called out as handoff item #1: without DATABASE_URL, funnel data does
 * not survive a redeploy.
 */
export class FileStore implements Store {
  readonly kind = "file" as const;

  private readonly dir: string;
  private writable: boolean | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  // Mirrors of on-disk state, also the fallback when the FS is read-only.
  private readonly memory: {
    sessions: SessionRow[];
    events: EventRow[];
    intents: IntentRow[];
    corpus: CorpusRow[];
    artifacts: Map<string, ArtifactRow>;
    states: Map<ProbeId, ProbeStateRow>;
  } = {
    sessions: [],
    events: [],
    intents: [],
    corpus: [],
    artifacts: new Map(),
    states: new Map(),
  };

  private loaded = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Serialise all mutations; JSONL appends are cheap so this is not a bottleneck. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  private async ensureDir(): Promise<boolean> {
    if (this.writable !== null) return this.writable;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.file(".writable"), "ok");
      this.writable = true;
    } catch {
      this.writable = false;
    }
    return this.writable;
  }

  private async append(name: string, row: unknown): Promise<void> {
    if (await this.ensureDir()) {
      try {
        await appendFile(this.file(name), `${JSON.stringify(row)}\n`, "utf8");
      } catch {
        this.writable = false;
      }
    }
  }

  private async readJsonl<T>(name: string): Promise<T[]> {
    const file = this.file(name);
    if (!existsSync(file)) return [];
    try {
      const raw = await readFile(file, "utf8");
      const out: T[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed) as T);
        } catch {
          // A torn final line from a crashed write. Skip it rather than
          // failing the whole dashboard.
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Load disk state into memory once per process. */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const [sessions, events, intents, corpus, artifacts] = await Promise.all([
      this.readJsonl<SessionRow>("sessions.jsonl"),
      this.readJsonl<EventRow>("events.jsonl"),
      this.readJsonl<IntentRow>("intents.jsonl"),
      this.readJsonl<CorpusRow>("corpus.jsonl"),
      this.readJsonl<ArtifactRow>("artifacts.jsonl"),
    ]);
    const byId = new Map(this.memory.sessions.map((s) => [s.id, s]));
    for (const s of sessions) byId.set(s.id, s);
    this.memory.sessions = [...byId.values()];
    this.memory.events = [...events, ...this.memory.events];
    this.memory.intents = [...intents, ...this.memory.intents];
    this.memory.corpus = [...corpus, ...this.memory.corpus];
    for (const a of artifacts) this.memory.artifacts.set(a.id, a);

    const statesFile = this.file("probe-states.json");
    if (existsSync(statesFile)) {
      try {
        const parsed = JSON.parse(await readFile(statesFile, "utf8")) as ProbeStateRow[];
        for (const s of parsed) this.memory.states.set(s.probe, s);
      } catch {
        // fall through to defaults
      }
    }
  }

  async ensureSession(row: SessionRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      if (this.memory.sessions.some((s) => s.id === row.id)) return;
      this.memory.sessions.push(row);
      await this.append("sessions.jsonl", row);
    });
  }

  async recordEvent(row: EventRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.events.push(row);
      await this.append("events.jsonl", row);
    });
  }

  async saveIntent(row: IntentRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.intents.push(row);
      await this.append("intents.jsonl", row);
    });
  }

  async saveCorpus(row: CorpusRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.corpus.push(row);
      await this.append("corpus.jsonl", row);
    });
  }

  async saveArtifact(row: ArtifactRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.artifacts.set(row.id, row);
      await this.append("artifacts.jsonl", row);
    });
  }

  async getArtifact(id: string): Promise<ArtifactRow | null> {
    await this.serial(() => this.load());
    return this.memory.artifacts.get(id) ?? null;
  }

  async getProbeStates(): Promise<ProbeStateRow[]> {
    await this.serial(() => this.load());
    return PROBES.map(
      (probe) =>
        this.memory.states.get(probe) ?? {
          probe,
          decision: "undecided" as ProbeDecision,
          note: null,
          updatedAt: new Date(0).toISOString(),
        },
    );
  }

  async setProbeDecision(probe: ProbeId, decision: ProbeDecision, note: string | null): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.states.set(probe, {
        probe,
        decision,
        note,
        updatedAt: new Date().toISOString(),
      });
      if (await this.ensureDir()) {
        try {
          const tmp = this.file(`probe-states.${process.pid}.tmp`);
          await writeFile(tmp, JSON.stringify([...this.memory.states.values()], null, 2), "utf8");
          await rename(tmp, this.file("probe-states.json"));
        } catch {
          this.writable = false;
        }
      }
    });
  }

  async funnel(): Promise<FunnelRow[]> {
    await this.serial(() => this.load());
    return PROBES.map((probe) => {
      const counts = Object.fromEntries(EVENT_NAMES.map((n) => [n, 0])) as Record<EventName, number>;
      // Count distinct sessions per event, not raw events: three page views by
      // one visitor is one visitor, and a funnel that says otherwise lies.
      const seen = new Map<EventName, Set<string>>(EVENT_NAMES.map((n) => [n, new Set<string>()]));
      for (const e of this.memory.events) {
        if (e.probe !== probe) continue;
        seen.get(e.name)?.add(e.sessionId);
      }
      for (const name of EVENT_NAMES) counts[name] = seen.get(name)?.size ?? 0;
      const intents = this.memory.intents.filter((i) => i.probe === probe);
      return {
        probe,
        sessions: this.memory.sessions.filter((s) => s.probe === probe).length,
        counts,
        intents: intents.length,
        intentValueMinor: intents.reduce((sum, i) => sum + i.amountMinor, 0),
      };
    });
  }

  async recentIntents(limit: number): Promise<IntentRow[]> {
    await this.serial(() => this.load());
    return [...this.memory.intents]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listCorpus(probe: ProbeId, kind: string | null, limit: number): Promise<CorpusRow[]> {
    await this.serial(() => this.load());
    return this.memory.corpus
      .filter((row) => row.probe === probe && (kind === null || row.kind === kind))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async corpusCounts(): Promise<Record<string, number>> {
    await this.serial(() => this.load());
    const out: Record<string, number> = Object.fromEntries(PROBES.map((p) => [p, 0]));
    for (const row of this.memory.corpus) out[row.probe] = (out[row.probe] ?? 0) + 1;
    return out;
  }
}
