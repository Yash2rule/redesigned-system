import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A guard for a layout bug that cost an afternoon to track down.
 *
 * `DataTable` puts a wide table inside an `overflow-x-auto` wrapper so it
 * scrolls inside its card instead of dragging the page sideways. That works
 * for normal flow content — but Tailwind's `sr-only` is `position: absolute`,
 * and an overflow ancestor only clips absolutely positioned descendants when
 * it is also their containing block. Without `relative` on the wrapper, the
 * screen-reader labels in the comparison table escaped the scroll container
 * and made the whole page scroll 151px sideways on a 390px viewport.
 *
 * CSS layout cannot be asserted without a browser, so this checks the class is
 * still there. The real verification is the Playwright pass, which measures
 * document overflow at 390px on every probe.
 */
describe("DataTable scroll container", () => {
  const source = readFileSync(
    path.join(import.meta.dirname, "result-view.tsx"),
    "utf8",
  );

  it("keeps `relative` alongside `overflow-x-auto`", () => {
    const wrapper = source.match(/className="([^"]*overflow-x-auto[^"]*)"/);
    expect(wrapper, "the overflow wrapper should still exist").toBeTruthy();
    expect(wrapper?.[1]).toContain("relative");
  });

  it("still constrains the table so it scrolls rather than reflows", () => {
    expect(source).toMatch(/min-w-\[\d+rem\]/);
  });

  it("explains why `relative` is there, so nobody tidies it away", () => {
    expect(source).toContain("position: absolute");
    expect(source).toMatch(/sr-only/);
  });
});
