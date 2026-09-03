import { createCheckoutRoute } from "@probes/app-kit";
import { config } from "../../../lib/config.ts";

export const runtime = "nodejs";
export const POST = createCheckoutRoute("ledger", config.plans);
