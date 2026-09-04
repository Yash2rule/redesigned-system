import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Container } from "@probes/ui";
import { ADMIN_COOKIE, adminConfigured, checkPassword, sessionToken } from "../../lib/auth.ts";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function signIn(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    if (!checkPassword(password)) redirect("/login?error=1");
    const jar = await cookies();
    jar.set(ADMIN_COOKIE, sessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    redirect("/");
  }

  if (!adminConfigured()) {
    return (
      <Container className="py-20">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard is closed</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          <code className="rounded bg-slate-100 px-1.5 py-0.5">ADMIN_PASSWORD</code> is not set, so
          this dashboard will not serve anything. That is deliberate: the funnel data includes the
          email address of everyone who asked to be told when payments open, and an unset password
          must never mean an open door.
        </p>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          Set it to something at least 8 characters long and redeploy.
        </p>
      </Container>
    );
  }

  return (
    <Container className="py-20">
      <h1 className="text-2xl font-bold tracking-tight">Probe dashboard</h1>
      <form action={signIn} className="mt-6 max-w-sm">
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
        />
        {error ? (
          <p role="alert" className="mt-3 text-sm text-rose-700">
            That password is wrong.
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Sign in
        </button>
      </form>
    </Container>
  );
}
