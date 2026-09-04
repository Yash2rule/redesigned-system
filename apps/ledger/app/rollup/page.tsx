import { Container, SectionHeading } from "@probes/ui";
import { RollupView } from "./rollup-view.tsx";

export const dynamic = "force-dynamic";

export default function RollupPage() {
  return (
    <Container className="py-10 sm:py-14">
      <SectionHeading
        eyebrow="Financial year"
        title="Every statement, one year, one spreadsheet"
        body="Pick the statements you have processed in this browser and we will combine them into an Indian financial year — 1 April to 31 March — removing anything that appears in two overlapping exports."
      />
      <div className="mt-6">
        <RollupView />
      </div>
    </Container>
  );
}
