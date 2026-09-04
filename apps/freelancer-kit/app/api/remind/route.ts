import { emailConfigured } from "@probes/email";
import { computeAdvanceTax } from "../../../lib/advance-tax.ts";
import { buildReminder, saveReminder } from "../../../lib/reminders.ts";
import { str, toMinor } from "../../../lib/handlers.ts";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /api/remind — remember someone before their advance-tax due dates.
 *
 * Recomputes the schedule server-side from the same inputs rather than trusting
 * a client-supplied one: the reminder is only useful if the amount in it is the
 * amount the engine would produce today.
 */
export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = str(body.email, 254);
  if (!EMAIL.test(email)) {
    return Response.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const result = computeAdvanceTax({
    grossReceiptsMinor: toMinor(body.grossReceipts),
    expensesMinor: toMinor(body.expenses),
    otherIncomeMinor: toMinor(body.otherIncome),
    basis: str(body.basis) === "actual-books" ? "actual-books" : "presumptive-44ada",
    regime: str(body.regime) === "old" ? "old" : "new",
    deductionsMinor: toMinor(body.deductions),
    tdsDeductedMinor: toMinor(body.tdsDeducted),
    alreadyPaidMinor: toMinor(body.alreadyPaid),
  });

  if (!result.advanceTaxDue) {
    return Response.json(
      {
        error:
          "On these numbers no advance tax is payable, so there is nothing to remind you about. Recompute if your income changes.",
      },
      { status: 400 },
    );
  }

  const reminder = buildReminder(email, result);
  if (reminder.instalments.length === 0) {
    return Response.json(
      { error: "Every instalment date for this year has already passed." },
      { status: 400 },
    );
  }

  const id = await saveReminder(reminder);
  return Response.json({
    id,
    email: reminder.email,
    dueDates: reminder.instalments.map((instalment) => instalment.dueDate),
    // Never let someone believe they are covered when they are not.
    live: emailConfigured(),
  });
}


