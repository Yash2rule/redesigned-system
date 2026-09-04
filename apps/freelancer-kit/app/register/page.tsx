import { Container, SectionHeading } from "@probes/ui";
import { RegisterView } from "./register-view.tsx";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <Container className="py-10 sm:py-14">
      <SectionHeading
        eyebrow="Financial year"
        title="Your invoice register"
        body="Every invoice you have raised here, for one Indian financial year, with the totals a CA asks for. This is what you invoiced — not what you were paid."
      />
      <div className="mt-6">
        <RegisterView />
      </div>
    </Container>
  );
}
