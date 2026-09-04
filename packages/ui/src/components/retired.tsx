import { Container } from "./primitives.tsx";

/**
 * What a probe shows once it has been retired.
 *
 * Deliberately plain, and deliberately not a sales page. Someone arriving here
 * followed a link that promised a working tool, so the first thing owed to
 * them is a straight answer about why it does not work, and the second is not
 * being asked for anything. No email field, no prices, no waiting list, no
 * "check out my other projects".
 */
export function RetiredPage({ name, message }: { name: string; message: string }) {
  return (
    <Container className="py-20">
      <h1 className="text-3xl font-bold tracking-tight">{name} has ended.</h1>
      <p className="mt-4 max-w-xl leading-relaxed text-[var(--muted)]">{message}</p>
      <p className="mt-4 max-w-xl leading-relaxed text-[var(--muted)]">
        It was an experiment to find out whether enough people wanted this enough to pay for it.
        Not enough did. That is a real answer, and it is the one this was built to get — so it has
        been switched off rather than left running as an empty shopfront.
      </p>
    </Container>
  );
}
