import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { EVENT_NAMES, PROBES } from "../types.ts";
import type {
  ArtifactScope,
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

  /** How long to wait for the filesystem before giving up on it. */
  static FS_PROBE_TIMEOUT_MS = 2_000;

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

  /**
   * Modification times of the files we last read.
   *
   * Loading once per process is not enough. Next bundles route handlers and
   * pages separately, so the module-level store singleton exists more than
   * once in a single server, and a decision written through an API route was
   * invisible to the page that rendered the dashboard. Re-reading when the
   * file changes is cheap at this scale and is simply correct.
   */
  private mtimes = new Map<string, number>();
  private loadedOnce = false;

  /** Rows this process wrote that the filesystem refused. */
  private readonly unflushed: {
    sessions: SessionRow[];
    events: EventRow[];
    intents: IntentRow[];
    corpus: CorpusRow[];
    artifacts: ArtifactRow[];
  } = { sessions: [], events: [], intents: [], corpus: [], artifacts: [] };

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

  /**
   * Probe whether the data directory is usable, once per process.
   *
   * Bounded by a timeout because a filesystem call can hang rather than fail —
   * a wedged or unusual mount makes mkdir block indefinitely, and a visitor's
   * result must never wait on the analytics directory. On timeout we treat the
   * store as unwritable and carry on in memory, which is the same degradation
   * as a read-only filesystem.
   */
  private async ensureDir(): Promise<boolean> {
    if (this.writable !== null) return this.writable;

    const probe = (async () => {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.file(".writable"), "ok");
      return true;
    })();

    let timer: NodeJS.Timeout | undefined;
    const bounded = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), FileStore.FS_PROBE_TIMEOUT_MS);
      // Do not hold the process open on this timer.
      timer.unref?.();
    });

    try {
      this.writable = await Promise.race([probe, bounded]);
    } catch {
      this.writable = false;
    } finally {
      if (timer) clearTimeout(timer);
    }
    // A hung probe must not reject unhandled later.
    probe.catch(() => undefined);
    return this.writable;
  }

  /** Append one row, returning whether it actually reached the disk. */
  private async append(name: string, row: unknown): Promise<boolean> {
    if (!(await this.ensureDir())) return false;
    try {
      await appendFile(this.file(name), `${JSON.stringify(row)}\n`, "utf8");
      return true;
    } catch {
      this.writable = false;
      return false;
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

  private changedOnDisk(): boolean {
    let changed = false;
    for (const name of [
      "sessions.jsonl",
      "events.jsonl",
      "intents.jsonl",
      "corpus.jsonl",
      "artifacts.jsonl",
      "probe-states.json",
    ]) {
      let mtime = 0;
      try {
        mtime = statSync(this.file(name)).mtimeMs;
      } catch {
        mtime = 0;
      }
      if (this.mtimes.get(name) !== mtime) {
        this.mtimes.set(name, mtime);
        changed = true;
      }
    }
    return changed;
  }

  /** Read disk state into memory, on first use and whenever a file changes. */
  private async load(): Promise<void> {
    const changed = this.changedOnDisk();
    if (this.loadedOnce && !changed) return;
    this.loadedOnce = true;

    const [sessions, events, intents, corpus, artifacts] = await Promise.all([
      this.readJsonl<SessionRow>("sessions.jsonl"),
      this.readJsonl<EventRow>("events.jsonl"),
      this.readJsonl<IntentRow>("intents.jsonl"),
      this.readJsonl<CorpusRow>("corpus.jsonl"),
      this.readJsonl<ArtifactRow>("artifacts.jsonl"),
    ]);

    // Disk is the source of truth; rows the filesystem refused are layered on
    // top so a read-only host still sees its own writes for the process life.
    const dedupe = <T extends { id: string }>(disk: T[], pending: T[]): T[] => {
      const byId = new Map(disk.map((row) => [row.id, row]));
      for (const row of pending) if (!byId.has(row.id)) byId.set(row.id, row);
      return [...byId.values()];
    };

    this.memory.sessions = dedupe(sessions, this.unflushed.sessions);
    this.memory.events = dedupe(events, this.unflushed.events);
    this.memory.intents = dedupe(intents, this.unflushed.intents);
    this.memory.corpus = dedupe(corpus, this.unflushed.corpus);
    this.memory.artifacts = new Map(
      dedupe(artifacts, this.unflushed.artifacts).map((row) => [row.id, row]),
    );

    this.memory.states.clear();
    const statesFile = this.file("probe-states.json");
    if (existsSync(statesFile)) {
      try {
        const parsed = JSON.parse(await readFile(statesFile, "utf8")) as ProbeStateRow[];
        for (const state of parsed) this.memory.states.set(state.probe, state);
      } catch {
        // A torn write; defaults are better than a crashed dashboard.
      }
    }
  }

  async ensureSession(row: SessionRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      if (this.memory.sessions.some((s) => s.id === row.id)) return;
      this.memory.sessions.push(row);
      if (!(await this.append("sessions.jsonl", row))) this.unflushed.sessions.push(row);
    });
  }

  async recordEvent(row: EventRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.events.push(row);
      if (!(await this.append("events.jsonl", row))) this.unflushed.events.push(row);
    });
  }

  async saveIntent(row: IntentRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.intents.push(row);
      if (!(await this.append("intents.jsonl", row))) this.unflushed.intents.push(row);
    });
  }

  async saveCorpus(row: CorpusRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      this.memory.corpus.push(row);
      if (!(await this.append("corpus.jsonl", row))) this.unflushed.corpus.push(row);
    });
  }

  async saveArtifact(row: ArtifactRow): Promise<void> {
    await this.serial(async () => {
      await this.load();
      // Last write wins on re-read too, because the JSONL is replayed in order.
      this.memory.artifacts.set(row.id, row);
      if (!(await this.append("artifacts.jsonl", row))) this.unflushed.artifacts.push(row);
    });
  }

  async getArtifact(id: string): Promise<ArtifactRow | null> {
    await this.serial(() => this.load());
    return this.memory.artifacts.get(id) ?? null;
  }

  async listArtifacts(probe: ArtifactScope, limit: number): Promise<ArtifactRow[]> {
    await this.serial(() => this.load());
    return [...this.memory.artifacts.values()]
      .filter((row) => row.probe === probe)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
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
          // Record our own write so the next read does not treat it as an
          // external change and reload redundantly.
          try {
            this.mtimes.set("probe-states.json", statSync(this.file("probe-states.json")).mtimeMs);
          } catch {
            this.mtimes.delete("probe-states.json");
          }
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
