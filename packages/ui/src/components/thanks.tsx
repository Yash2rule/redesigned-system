import Link from "next/link";
import { Container } from "./primitives.tsx";

/**
 * Shared post-checkout / post-intent page. Says the same honest thing in
 * every probe: we took an email, we will send exactly one message.
 */
export function ThanksPage({ backLabel }: { backLabel: string }) {
  return (
    <Container className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">Thank you.</h1>
      <p className="mt-4 max-w-xl leading-relaxed text-[var(--muted)]">
        We have your email and the plan you picked. You will get exactly one message when payments
        open, and nothing else — no newsletter, no drip sequence. If you paid, the receipt comes
        from the payment provider directly.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
      >
        {backLabel}
      </Link>
    </Container>
  );
}

export function NotFoundPage({ backLabel }: { backLabel: string }) {
  return (
    <Container className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">Nothing here.</h1>
      <p className="mt-4 text-[var(--muted)]">
        That page does not exist, or a saved result has expired.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
      >
        {backLabel}
      </Link>
    </Container>
  );
}
