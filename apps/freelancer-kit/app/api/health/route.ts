import { createHealthRoute } from "@probes/app-kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createHealthRoute("freelancer-kit");
