#!/usr/bin/env node
/**
 * Create, configure, deploy and verify the five Vercel projects from the API.
 *
 * This is the non-interactive sibling of `deploy-all.mjs`. That one shells out
 * to the Vercel CLI and needs a human to answer its prompts; this one talks to
 * the REST API with a token, is idempotent, and can run unattended — which is
 * what you want when four projects need the identical treatment.
 *
 *   VERCEL_TOKEN=... DATABASE_URL=... node scripts/vercel-provision.mjs
 *   ... --apps=ledger,admin          # only these
 *   ... --dry-run                    # print what would change, touch nothing
 *   ... --verify-only                # skip create/env/deploy, just check health
 *   ... --sensitive                  # write env vars Vercel can never read back
 *
 * THE TOKEN MATTERS. A project-scoped token (`vcp_...`) can read and deploy
 * the one project it was minted for and nothing else — project creation comes
 * back 403 "You don't have permission to create the project". Mint an account
 * or team token at https://vercel.com/account/settings/tokens with its scope
 * set to the team that owns the projects. The preflight below says so out loud
 * rather than failing four times in a row.
 *
 * ENV VARS ARE WRITTEN AS `encrypted`, NOT `sensitive`, ON PURPOSE. Vercel
 * never returns the value of a `sensitive` variable — not to the dashboard,
 * not to `vercel env pull`, not to this script. That makes "copy DATABASE_URL
 * from the project that already has it" impossible, which is exactly the wall
 * this script was written at. `encrypted` is Vercel's default, is still
 * encrypted at rest, and can be read back by anyone who already has team
 * access. Pass --sensitive if you would rather have the write-only kind and
 * keep the connection string somewhere else.
 */

import { setTimeout as sleep } from "node:timers/promises";

const API = "https://api.vercel.com";
const REPO = "Yash2rule/redesigned-system";
// v13 deployments will not accept `owner/name` — gitSource wants the numeric
// repo id. It is read off the project's own link where possible; this is the
// fallback for a project whose link has not been hydrated yet.
const REPO_ID = 1356471988;
const PRODUCTION_BRANCH = "main";

const APPS = [
  {
    dir: "offer-decoder",
    project: "redesigned-system-offer-decoder",
    probe: "offer-decoder",
    note: "INR probe — Razorpay rail",
  },
  { dir: "ledger", project: "redesigned-system-ledger", probe: "ledger", note: "INR probe — Razorpay rail" },
  {
    dir: "freelancer-kit",
    project: "redesigned-system-freelancer-kit",
    probe: "freelancer-kit",
    note: "INR probe — Razorpay rail",
  },
  { dir: "uptime", project: "redesigned-system-uptime", probe: "uptime", note: "USD probe — Lemon Squeezy rail" },
  {
    dir: "admin",
    project: "redesigned-system-admin",
    probe: "admin",
    note: "Dashboard — needs ADMIN_PASSWORD and the same DATABASE_URL",
    needsAdminPassword: true,
  },
];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const DRY_RUN = flag("dry-run");
const VERIFY_ONLY = flag("verify-only");
const SKIP_DEPLOY = flag("skip-deploy") || VERIFY_ONLY;
const ENV_TYPE = flag("sensitive") ? "sensitive" : "encrypted";
const TOKEN = process.env.VERCEL_TOKEN;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

const only = value("apps");
const targets = only ? APPS.filter((a) => only.split(",").includes(a.dir)) : APPS;

if (!TOKEN) {
  console.error("VERCEL_TOKEN is not set. Mint one at https://vercel.com/account/settings/tokens");
  process.exit(1);
}
if (targets.length === 0) {
  console.error(`--apps=${only} matched nothing. Known: ${APPS.map((a) => a.dir).join(", ")}`);
  process.exit(1);
}

/**
 * The egress path in some environments drops TLS connections mid-handshake,
 * so every call retries. Only transport failures are retried: an HTTP status
 * is an answer, and repeating a 403 helps nobody.
 */
async function api(method, path, body, { tries = 5 } = {}) {
  const url = new URL(API + path);
  if (TEAM_ID && !url.searchParams.has("teamId")) url.searchParams.set("teamId", TEAM_ID);
  let lastError;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : {} };
    } catch (error) {
      lastError = error;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw new Error(`${method} ${path} failed after ${tries} tries: ${lastError?.message}`);
}

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
      return { status: response.status, text: await response.text() };
    } catch {
      await sleep(2 ** attempt * 1000);
    }
  }
  return { status: 0, text: "" };
}

/** Explain a 403 on project creation in terms of the fix, not the status code. */
function tokenCannotCreate(missing) {
  return [
    "",
    missing.length === 1
      ? "This token cannot create projects, and this one does not exist yet:"
      : `This token cannot create projects, and ${missing.length} of them do not exist yet:`,
    ...missing.map((name) => `  - ${name}`),
    "",
    TOKEN.startsWith("vcp_")
      ? "The token starts with `vcp_`, which is a PROJECT-scoped token: it can read"
      : "Project creation came back 403: this token's scope or role does not cover",
    TOKEN.startsWith("vcp_")
      ? "and deploy the single project it was minted for, and nothing else."
      : "creating projects in this team.",
    "",
    "Mint an account or team token instead:",
    "  https://vercel.com/account/settings/tokens  →  Scope: the owning team",
    "",
    "Or create the projects by hand once (Vercel dashboard → Add New → Project),",
    "with Root Directory apps/<app> and 'Include files outside the Root",
    "Directory' ON, and then re-run this with --verify-only.",
    "",
  ].join("\n");
}

/** Fail early if the token cannot even read, and report what already exists. */
async function preflight() {
  const { status, body } = await api("GET", "/v9/projects?limit=100");
  if (status !== 200) {
    console.error(`Token cannot list projects (${status}): ${body?.error?.message ?? ""}`);
    process.exit(1);
  }
  const names = new Set(body.projects.map((p) => p.name));
  const missing = targets.filter((a) => !names.has(a.project));
  if (missing.length > 0) {
    console.log(`${missing.length} project(s) to create: ${missing.map((a) => a.project).join(", ")}`);
  }
  return { projects: body.projects, missing: missing.map((a) => a.project) };
}

async function ensureProject(app, existing) {
  const found = existing.find((p) => p.name === app.project);
  if (found) {
    console.log(`  project exists (${found.id})`);
    return found;
  }
  if (DRY_RUN) {
    console.log(`  would create project ${app.project} (root apps/${app.dir})`);
    return null;
  }
  const { status, body } = await api("POST", "/v11/projects", {
    name: app.project,
    framework: "nextjs",
    rootDirectory: `apps/${app.dir}`,
    gitRepository: { type: "github", repo: REPO },
  });
  if (status === 403) {
    console.error(tokenCannotCreate(absent));
    process.exit(1);
  }
  if (status >= 300) throw new Error(`create ${app.project}: ${status} ${JSON.stringify(body)}`);
  console.log(`  created project (${body.id})`);
  return body;
}

/**
 * `sourceFilesOutsideRootDirectory` is the one that is not optional: each
 * app's vercel.json builds with `cd ../..`, so a project that only uploads
 * its own folder fails on a missing lockfile.
 */
async function ensureSettings(project, app) {
  const wanted = {
    framework: "nextjs",
    rootDirectory: `apps/${app.dir}`,
    sourceFilesOutsideRootDirectory: true,
  };
  const drift = Object.entries(wanted).filter(([k, v]) => project[k] !== v);
  if (drift.length === 0) {
    console.log("  settings already correct");
    return;
  }
  if (DRY_RUN) {
    console.log(`  would set ${drift.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    return;
  }
  const { status, body } = await api("PATCH", `/v9/projects/${project.id}`, wanted);
  if (status >= 300) throw new Error(`settings ${app.project}: ${status} ${JSON.stringify(body)}`);
  console.log(`  set ${drift.map(([k]) => k).join(", ")}`);
}

async function upsertEnv(project, key, val) {
  const { body } = await api("GET", `/v10/projects/${project.id}/env`);
  const existing = (body.envs ?? []).find((e) => e.key === key && e.target?.includes("production"));
  if (DRY_RUN) {
    console.log(`  would ${existing ? "update" : "add"} ${key} (${ENV_TYPE})`);
    return;
  }
  if (existing) {
    const { status } = await api("PATCH", `/v10/projects/${project.id}/env/${existing.id}`, {
      value: val,
      type: ENV_TYPE,
      target: ["production", "preview"],
    });
    console.log(`  ${status < 300 ? "updated" : `FAILED (${status}) to update`} ${key}`);
    return;
  }
  const { status, body: created } = await api("POST", `/v10/projects/${project.id}/env`, {
    key,
    value: val,
    type: ENV_TYPE,
    target: ["production", "preview"],
  });
  console.log(`  ${status < 300 ? "added" : `FAILED (${status}) to add ${JSON.stringify(created)}`} ${key}`);
}

async function deploy(project, app) {
  const { status, body } = await api("POST", "/v13/deployments", {
    name: app.project,
    project: project.id,
    target: "production",
    gitSource: {
      type: "github",
      repoId: project.link?.repoId ?? REPO_ID,
      ref: PRODUCTION_BRANCH,
    },
  });
  if (status >= 300) throw new Error(`deploy ${app.project}: ${status} ${JSON.stringify(body)}`);
  console.log(`  deploying ${body.id}`);
  return body.id;
}

async function waitForDeployment(id, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const { body } = await api("GET", `/v13/deployments/${id}`);
    const state = body.readyState ?? body.status;
    if (state !== last) {
      console.log(`  ${state}`);
      last = state;
    }
    if (state === "READY") return { ok: true, url: body.url, body };
    if (["ERROR", "CANCELED", "DELETED"].includes(state)) return { ok: false, url: body.url, body };
    await sleep(10_000);
  }
  return { ok: false, url: undefined, body: { error: "timed out" } };
}

/**
 * READY only means the build finished. Verification means the running app
 * answers, and answers as itself — a project pointed at the wrong root
 * directory builds and serves happily, it just serves the wrong probe.
 */
async function verify(app) {
  const base = `https://${app.project}.vercel.app`;
  const health = await get(`${base}/api/health`);
  if (health.status !== 200) {
    return { ok: false, base, detail: `GET /api/health → ${health.status || "no response"}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(health.text);
  } catch {
    return { ok: false, base, detail: "/api/health did not return JSON" };
  }
  const identity = parsed.probe ?? parsed.app;
  if (identity !== app.probe) {
    return { ok: false, base, detail: `/api/health says "${identity}", expected "${app.probe}" — wrong root directory?` };
  }
  const home = await get(base);
  const caps = parsed.capabilities ?? {};
  const notes = [
    `database=${caps.database === true}`,
    `home=${home.status}`,
    ...(app.needsAdminPassword ? [`passwordSet=${parsed.passwordSet === true}`] : []),
  ];
  const ok = home.status === 200 && (!app.needsAdminPassword || parsed.passwordSet === true);
  return { ok, base, detail: notes.join(" "), caps };
}

const results = [];
const { projects: existing, missing: absent } = await preflight();

for (const app of targets) {
  console.log(`\n── ${app.dir}  (${app.note})`);
  try {
    const project = VERIFY_ONLY
      ? existing.find((p) => p.name === app.project)
      : await ensureProject(app, existing);

    if (project && !VERIFY_ONLY) {
      await ensureSettings(project, app);
      if (process.env.DATABASE_URL) await upsertEnv(project, "DATABASE_URL", process.env.DATABASE_URL);
      else console.log("  DATABASE_URL not in this shell — skipped (the app will fall back to local files)");
      if (app.needsAdminPassword) {
        if (process.env.ADMIN_PASSWORD) await upsertEnv(project, "ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);
        else console.log("  ADMIN_PASSWORD not in this shell — the dashboard will refuse to serve");
      }
    }

    if (project && !SKIP_DEPLOY && !DRY_RUN) {
      const id = await deploy(project, app);
      const done = await waitForDeployment(id);
      if (!done.ok) {
        results.push({ app: app.dir, ok: false, detail: `build did not reach READY (${done.body?.error ?? ""})` });
        continue;
      }
    }

    if (DRY_RUN || !project) {
      results.push({ app: app.dir, ok: null, detail: "dry run" });
      continue;
    }

    const checked = await verify(app);
    console.log(`  ${checked.ok ? "verified" : "PROBLEM"}: ${checked.detail}`);
    results.push({ app: app.dir, ok: checked.ok, detail: checked.detail, url: checked.base });
  } catch (error) {
    console.error(`  FAILED: ${error.message}`);
    results.push({ app: app.dir, ok: false, detail: error.message });
  }
}

console.log("\n\nResult:");
for (const r of results) {
  const mark = r.ok === null ? "–" : r.ok ? "ok" : "!!";
  console.log(`  ${mark}  ${r.app.padEnd(16)} ${r.url ?? ""}  ${r.detail ?? ""}`);
}
const failed = results.filter((r) => r.ok === false).length;
if (failed > 0) {
  console.error(`\n${failed} app(s) are not right. Nothing was rolled back.`);
  process.exit(1);
}
