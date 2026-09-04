#!/usr/bin/env node
/**
 * One-command deploy of all five apps to Vercel.
 *
 * Does nothing clever: it runs `vercel` in each app directory in turn, with
 * the repository root as the build context, and prints the URLs at the end.
 * The value is that it is the same five commands every time, in the right
 * order, with the admin app last so its DATABASE_URL matches whatever the
 * probes were just given.
 *
 *   pnpm deploy:all             # preview deployments
 *   pnpm deploy:all -- --prod   # production
 *
 * Prerequisites, all of which this script checks for:
 *   npm i -g vercel && vercel login
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const APPS = [
  { dir: "offer-decoder", note: "INR probe — Razorpay rail" },
  { dir: "ledger", note: "INR probe — Razorpay rail" },
  { dir: "freelancer-kit", note: "INR probe — Razorpay rail" },
  { dir: "uptime", note: "USD probe — Lemon Squeezy rail" },
  { dir: "admin", note: "Dashboard — needs ADMIN_PASSWORD and the same DATABASE_URL" },
];

const prod = process.argv.includes("--prod");

function have(command) {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

if (!have("vercel")) {
  console.error(
    [
      "The Vercel CLI is not installed.",
      "",
      "  npm i -g vercel",
      "  vercel login",
      "",
      "Then run this again.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Deploying ${APPS.length} apps to ${prod ? "PRODUCTION" : "preview"}.\n` +
    `Each one prompts on first run to link a Vercel project — say yes, and give\n` +
    `each a distinct name. After that it remembers.\n`,
);

const results = [];
let failed = 0;

for (const app of APPS) {
  const cwd = path.join(root, "apps", app.dir);
  if (!existsSync(cwd)) {
    console.error(`Skipping ${app.dir}: directory not found.`);
    failed += 1;
    continue;
  }

  console.log(`\n── ${app.dir} ${"─".repeat(Math.max(0, 40 - app.dir.length))}`);
  console.log(`   ${app.note}`);

  const args = ["deploy", ...(prod ? ["--prod"] : []), "--yes"];
  const result = spawnSync("vercel", args, { cwd, stdio: ["inherit", "pipe", "inherit"] });
  const output = (result.stdout ?? "").toString().trim();
  process.stdout.write(output ? `${output}\n` : "");

  if (result.status !== 0) {
    console.error(`   FAILED: ${app.dir}`);
    failed += 1;
    continue;
  }

  const url = output.split("\n").reverse().find((line) => line.startsWith("https://"));
  results.push({ app: app.dir, url: url ?? "(no URL in output)" });
}

console.log("\n\nDeployed:");
for (const entry of results) console.log(`  ${entry.app.padEnd(18)} ${entry.url}`);

if (failed > 0) {
  console.error(`\n${failed} app(s) failed. Nothing was rolled back — fix and re-run.`);
  process.exit(1);
}

console.log(
  [
    "",
    "Now do these three things, in this order:",
    "",
    "  1. Set DATABASE_URL on all five projects, to the SAME database.",
    "     Without it every app writes to its own ephemeral disk and the",
    "     dashboard sees nothing. This is the whole point of the exercise.",
    "",
    "  2. Set ADMIN_PASSWORD on the admin project. Until you do, the",
    "     dashboard refuses to serve.",
    "",
    "  3. Open <each-url>/api/health and confirm the capability flags say",
    "     what you expect.",
    "",
    "     vercel env add DATABASE_URL production",
    "",
  ].join("\n"),
);
