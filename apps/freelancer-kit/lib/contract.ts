import { UserFacingError } from "@probes/core";

/**
 * A freelance services agreement, assembled from a template.
 *
 * This is a drafting aid, not legal advice and not a substitute for a lawyer.
 * Two rules it holds to, because breaking either would make it dangerous:
 *
 * 1. It never cites a section, rule or case. Every clause is written in plain
 *    words. A fabricated citation in a contract is worse than no citation, and
 *    a real one applied to the wrong facts is not much better.
 * 2. It never claims the result is enforceable, complete, or right for the
 *    user's situation. It says the opposite, on the document itself.
 */

export type ContractInput = {
  freelancerName: string;
  freelancerAddress: string;
  clientName: string;
  clientAddress: string;
  scope: string;
  deliverables: string;
  /** Total fee in paise, or 0 when billing hourly/retainer. */
  feeMinor: number;
  feeStructure: "fixed" | "hourly" | "monthly-retainer";
  /** Hourly or monthly rate in paise, used for the non-fixed structures. */
  rateMinor: number;
  paymentTermsDays: number;
  advancePct: number;
  lateFeePctPerMonth: number;
  startDate: string;
  endDate: string;
  /** Days of notice either side must give to terminate. */
  noticeDays: number;
  /** City whose courts have jurisdiction. */
  jurisdictionCity: string;
  /** Revision rounds included before extra charges apply. */
  revisionRounds: number;
  ipTransfersOnPayment: boolean;
  confidentialityMonths: number;
};

export type ContractClause = { heading: string; body: string };

export type ContractResult = {
  input: ContractInput;
  title: string;
  preamble: string;
  clauses: ContractClause[];
  signatureBlock: string[];
  warnings: string[];
  reviewNotice: string;
};

const money = (minor: number): string =>
  `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function buildContract(input: ContractInput): ContractResult {
  const warnings: string[] = [];
  const freelancer = input.freelancerName.trim();
  const client = input.clientName.trim();

  if (!freelancer || !client) {
    throw new UserFacingError("Both names are needed before we can draft anything.", 400);
  }
  if (!input.scope.trim()) {
    throw new UserFacingError(
      "Describe the work. A contract whose scope clause is vague is the single most common reason freelance disputes go badly.",
      400,
    );
  }

  const feeDescription =
    input.feeStructure === "fixed"
      ? `a fixed fee of ${money(input.feeMinor)} for the whole of the Services`
      : input.feeStructure === "hourly"
        ? `${money(input.rateMinor)} per hour of work performed, billed monthly in arrears`
        : `a retainer of ${money(input.rateMinor)} per month`;

  const clauses: ContractClause[] = [
    {
      heading: "1. What is being done",
      body: `The Freelancer will provide the following services to the Client (the "Services"):\n\n${input.scope.trim()}\n\n${
        input.deliverables.trim()
          ? `The following are to be delivered:\n\n${input.deliverables.trim()}`
          : "The parties will agree the specific deliverables in writing before work begins."
      }\n\nAnything not described above is outside this agreement. If the Client asks for it, it is new work and is charged separately.`,
    },
    {
      heading: "2. When",
      body: `Work begins on ${input.startDate || "the date both parties sign"} and continues until ${
        input.endDate || "the Services are complete"
      }. Timelines assume the Client provides information, access, feedback and approvals promptly. Where the Client's delay holds up the work, delivery dates move by at least the length of that delay.`,
    },
    {
      heading: "3. Money",
      body: `The Client will pay ${feeDescription}.${
        input.advancePct > 0
          ? ` ${input.advancePct}% is payable in advance, before work begins. The balance is payable as set out below.`
          : ""
      }\n\nInvoices are payable within ${input.paymentTermsDays} days of the invoice date. Amounts are exclusive of GST; where GST applies it will be charged in addition and shown separately on the invoice.${
        input.lateFeePctPerMonth > 0
          ? `\n\nOverdue amounts carry interest at ${input.lateFeePctPerMonth}% per month from the due date until paid. The Freelancer may also pause work while an invoice is overdue, without that pause being a breach of this agreement.`
          : ""
      }\n\nThe Client pays any bank charges, currency conversion costs or payment-platform fees on payments made to the Freelancer.`,
    },
    {
      heading: "4. Changes and revisions",
      body: `${
        input.revisionRounds > 0
          ? `The fee includes ${input.revisionRounds} round${input.revisionRounds === 1 ? "" : "s"} of revisions on each deliverable. Further rounds, and any change to the agreed scope, are charged separately at rates agreed in writing before that work starts.`
          : "Any change to the agreed scope is charged separately at rates agreed in writing before that work starts."
      }`,
    },
    {
      heading: "5. Who owns the work",
      body: input.ipTransfersOnPayment
        ? `On receipt of payment in full, the Freelancer assigns to the Client all rights in the final deliverables produced under this agreement.\n\nUntil payment is received in full, all rights remain with the Freelancer and the Client has no licence to use the deliverables.\n\nThe Freelancer keeps ownership of anything created before this agreement, and of general tools, libraries, methods and know-how used in the work. Where any of that is embedded in a deliverable, the Client gets a perpetual, non-exclusive licence to use it as part of that deliverable.`
        : `The Freelancer retains ownership of all work produced under this agreement and grants the Client a perpetual, non-exclusive licence to use the deliverables for the purpose described in clause 1.`,
    },
    {
      heading: "6. Portfolio",
      body: `The Freelancer may describe the work and show the deliverables in a portfolio or case study, unless the Client objects in writing. Anything the Client has marked confidential is excluded.`,
    },
    {
      heading: "7. Confidentiality",
      body: `Each party will keep the other's confidential information confidential, and will not use it for anything other than performing this agreement. This obligation continues for ${input.confidentialityMonths} months after this agreement ends.\n\nThis does not apply to information that is already public, that the receiving party already had, or that it is required to disclose by law or by a court.`,
    },
    {
      heading: "8. The Freelancer is not an employee",
      body: `The Freelancer is an independent contractor. Nothing here creates employment, partnership, or an agency relationship. The Freelancer decides how and when the work is done, uses their own equipment, may work for others, and is responsible for their own taxes and statutory filings. The Client is not responsible for provident fund, gratuity, leave or any other employment benefit.`,
    },
    {
      heading: "9. Ending it",
      body: `Either party may end this agreement by giving ${input.noticeDays} days' written notice.\n\nOn termination, the Client pays for all work done up to the termination date, including work in progress. Any advance already paid is set off against that amount; if an advance exceeds the value of work done, the balance is refunded.\n\nEither party may end this agreement immediately if the other materially breaches it and does not fix the breach within 15 days of being told about it in writing.`,
    },
    {
      heading: "10. What the Freelancer promises, and what they do not",
      body: `The Freelancer will perform the Services with reasonable skill and care, and warrants that the work is original and does not knowingly infringe anyone else's rights.\n\nThe Freelancer does not guarantee any particular business outcome — revenue, ranking, traffic, funding or otherwise.\n\nNeither party is liable to the other for indirect or consequential loss, or for loss of profit, revenue or data. Each party's total liability under this agreement is limited to the total fees paid or payable under it. Nothing in this clause limits liability that cannot be limited by law.`,
    },
    {
      heading: "11. Law and disputes",
      body: `This agreement is governed by the laws of India. The parties will try in good faith to resolve any dispute by discussion first. Failing that, the courts at ${input.jurisdictionCity || "the Client's city"} have jurisdiction.`,
    },
    {
      heading: "12. The whole agreement",
      body: `This document is the entire agreement between the parties on this subject and replaces anything discussed or written earlier. It can only be changed in writing, signed by both parties. If any part of it is found unenforceable, the rest continues to apply.`,
    },
  ];

  if (input.paymentTermsDays > 45) {
    warnings.push(
      `${input.paymentTermsDays}-day payment terms are long for freelance work. Thirty days is common and fifteen is achievable with a new client who wants the work started quickly.`,
    );
  }
  if (input.advancePct === 0) {
    warnings.push(
      "No advance. An advance is the cheapest protection a freelancer has: it filters out clients who were never going to pay, and it means a walked-away project is not a total loss. Even 25% changes the dynamic.",
    );
  }
  if (input.lateFeePctPerMonth === 0) {
    warnings.push(
      "No late fee. A late-payment clause is rarely enforced in court, but having it in writing is what makes a follow-up email land.",
    );
  }
  if (!input.ipTransfersOnPayment) {
    warnings.push(
      "You have kept ownership and granted a licence instead. That is a legitimate choice, and it is also the thing clients most often push back on — decide before you send it whether you will hold the line.",
    );
  }

  return {
    input,
    title: "Freelance Services Agreement",
    preamble: `This agreement is made between ${freelancer}${
      input.freelancerAddress.trim() ? `, of ${input.freelancerAddress.trim()}` : ""
    } (the "Freelancer") and ${client}${
      input.clientAddress.trim() ? `, of ${input.clientAddress.trim()}` : ""
    } (the "Client"), on ${input.startDate || "the date of the last signature below"}.`,
    clauses,
    signatureBlock: [
      `For the Freelancer: ${freelancer}`,
      "Signature: ______________________    Date: ______________",
      "",
      `For the Client: ${client}`,
      "Signature: ______________________    Date: ______________",
      "Name and designation: ______________________",
    ],
    warnings,
    reviewNotice:
      "This is a drafting aid, produced from a template and the details you entered. It is not legal advice, it has not been reviewed by a lawyer for your situation, and no clause here is guaranteed to be enforceable. Read every clause before you send it. For anything with real money or real risk in it, have a lawyer read it first — an hour of their time costs less than one dispute.",
  };
}
