/**
 * Composing plain-text email.
 *
 * Text only, on purpose. HTML email means tracking pixels, a rendering matrix
 * to test, and a spam-filter argument to have — none of which a one-person
 * product needs, and the first of which we would rather not do at all.
 */

export type EmailBody = {
  greeting?: string;
  paragraphs: string[];
  bullets?: string[];
  /** Rendered as "Label: url" so it is readable and unclickable-safe. */
  links?: { label: string; url: string }[];
  signoff?: string;
};

const WRAP = 72;

/** Hard-wrap a paragraph, never mid-word. */
function wrap(text: string, width = WRAP): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

export function plainTextEmail(body: EmailBody): string {
  const parts: string[] = [];
  if (body.greeting) parts.push(wrap(body.greeting));
  for (const paragraph of body.paragraphs) parts.push(wrap(paragraph));
  if (body.bullets?.length) {
    parts.push(body.bullets.map((bullet) => wrap(`- ${bullet}`, WRAP - 2)).join("\n"));
  }
  if (body.links?.length) {
    parts.push(body.links.map((link) => `${link.label}:\n${link.url}`).join("\n\n"));
  }
  if (body.signoff) parts.push(wrap(body.signoff));
  return parts.join("\n\n");
}

/**
 * The footer every message carries.
 *
 * States why the person is receiving it and how to stop. Not legal boilerplate
 * — the reason is specific to how we got their address, because "you signed up
 * somewhere" is the thing that makes people press spam.
 */
export function unsubscribeFooter(reason: string, contactEmail: string): string {
  return [
    "—",
    wrap(reason),
    wrap(`Reply to this message with "stop" and you will not hear from us again. Questions go to ${contactEmail} and reach a person.`),
  ].join("\n");
}
