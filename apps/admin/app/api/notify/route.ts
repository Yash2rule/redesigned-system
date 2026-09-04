import { emailConfigured } from "@probes/email";
import { isAuthenticated } from "../../../lib/auth.ts";
import { runOutreach } from "../../../lib/outreach.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/notify — message everyone who left an email.
 *
 * Dry run unless `confirm` is exactly the string "SEND". Requiring a typed
 * word rather than a boolean is deliberate: a stray `true` in a request body
 * should not be able to mail several hundred strangers.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthenticated(request.headers.get("cookie"))) {
    return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  }

  let body: {
    probe?: unknown;
    subject?: unknown;
    message?: unknown;
    productName?: unknown;
    contactEmail?: unknown;
    confirm?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : "";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 5000) : "";
  if (subject.length < 3 || message.length < 20) {
    return new Response(
      JSON.stringify({ error: "A subject and a message of at least 20 characters are required." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const result = await runOutreach({
    probe: typeof body.probe === "string" ? body.probe : "all",
    subject,
    body: message,
    productName:
      typeof body.productName === "string" && body.productName.trim()
        ? body.productName.trim().slice(0, 80)
        : "one of our tools",
    contactEmail:
      typeof body.contactEmail === "string" && body.contactEmail.includes("@")
        ? body.contactEmail.trim()
        : "hello@example.com",
    confirm: body.confirm === "SEND",
  });

  return new Response(JSON.stringify({ ...result, emailLive: emailConfigured() }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
