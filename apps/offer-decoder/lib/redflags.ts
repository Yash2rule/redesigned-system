/**
 * Red-flag clause detection.
 *
 * Deliberately a rule engine, not a model. Every flag names the exact phrase
 * it matched and quotes the sentence it came from, so the candidate can go
 * read their own letter and judge for themselves. A model could find more,
 * but it could not be audited by the person whose career depends on it — and
 * it would occasionally invent a clause that is not in the document.
 *
 * This is an explanation of what a document says. It is not legal advice.
 */

export type FlagSeverity = "high" | "medium" | "low";

export type RedFlag = {
  id: string;
  title: string;
  severity: FlagSeverity;
  /** What this clause means in plain words. */
  meaning: string;
  /** What to actually ask HR. */
  ask: string;
  /** The sentence from the letter that triggered this, trimmed. */
  quote: string;
};

type Rule = {
  id: string;
  title: string;
  severity: FlagSeverity;
  patterns: RegExp[];
  meaning: string;
  ask: string;
  /** Optional extra test on the matched sentence. */
  confirm?: (sentence: string) => boolean;
};

const RULES: Rule[] = [
  {
    id: "bond",
    title: "Employment bond or minimum service period",
    severity: "high",
    patterns: [
      /\b(service|employment)\s*(bond|agreement)\b/i,
      /\bbond\s*(period|amount|of)\b/i,
      /\bminimum\s*(service|tenure|period)\s*of\b/i,
      /\bshall\s*serve\s*(the\s*company\s*)?for\s*a\s*(minimum|period)/i,
    ],
    meaning:
      "You are contractually committed to stay for a set period, and leaving early triggers a payment. Indian courts have struck down bonds that are purely punitive, but fighting one costs time and money you probably don't want to spend.",
    ask: "How much is the bond, what exactly triggers it, and is it reduced pro-rata for the time already served?",
  },
  {
    id: "training-recovery",
    title: "Training cost recovery",
    severity: "high",
    patterns: [
      /\b(training|induction|certification)\s*(cost|expense|fee)s?\s*(will|shall|to)?\s*(be)?\s*(recover|reimburse|repay|refund)/i,
      /\brecover\s*(the\s*)?(cost|expenses)\s*of\s*(the\s*)?training/i,
    ],
    meaning:
      "If you leave within a stated window, the company bills you for training it says it spent on you. The amount is often far larger than the training was worth.",
    ask: "What is the exact rupee figure, how is it calculated, and does it reduce month by month?",
  },
  {
    id: "notice-long",
    title: "Long notice period",
    severity: "medium",
    patterns: [/\bnotice\s*period\b/i, /\bnotice\s*of\s*(\d+|one|two|three|six)\b/i],
    confirm: (sentence) => {
      const days = sentence.match(/(\d{2,3})\s*(days|day)/i);
      const months = sentence.match(/(\d|one|two|three|four|five|six)\s*(months?|month)/i);
      const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
      if (days?.[1] && Number(days[1]) >= 60) return true;
      const raw = months?.[1]?.toLowerCase();
      if (raw) {
        const value = words[raw] ?? Number(raw);
        if (Number.isFinite(value) && value >= 2) return true;
      }
      return false;
    },
    meaning:
      "Two or three months of notice is common in India and is worth planning for: your next employer may not wait that long, and you may be asked to buy the notice out of your own pocket.",
    ask: "Can notice be bought out, at what rate (basic or gross?), and is the company's notice to you the same length as yours to them?",
  },
  {
    id: "notice-asymmetric",
    title: "Notice period may be one-sided",
    severity: "medium",
    patterns: [
      /\bcompany\s*(may|reserves\s*the\s*right\s*to)\s*terminate\s*(your\s*)?(employment|services)?\s*(with|by\s*giving)?\s*(immediate|\d+\s*day)/i,
      /\bterminate\s*(this\s*)?(employment|agreement)\s*(at\s*any\s*time|forthwith|without\s*notice)/i,
      /\bwithout\s*(assigning\s*any\s*)?(reason|cause)\b/i,
    ],
    meaning:
      "The company can end the relationship quickly, or without giving a reason, while your own notice obligation stays long. That asymmetry is normal in Indian offer letters and is still worth seeing clearly.",
    ask: "Is the company's notice period to me the same as mine to the company?",
  },
  {
    id: "non-compete",
    title: "Non-compete clause",
    severity: "medium",
    patterns: [
      /\bnon[\s-]*compet(e|ition)\b/i,
      /\bshall\s*not\s*(directly\s*or\s*indirectly\s*)?(engage|work|be\s*employed)\s*(in|with|for)\s*any\s*(competing|similar|competitor)/i,
    ],
    meaning:
      "Post-employment non-competes are generally unenforceable in India under Section 27 of the Contract Act, which voids agreements in restraint of trade. Companies still include them, and a former employer can still make your life awkward.",
    ask: "How long does this run after I leave, and how broadly is 'competing business' defined?",
  },
  {
    id: "non-solicit",
    title: "Non-solicitation clause",
    severity: "low",
    patterns: [/\bnon[\s-]*solicit(ation)?\b/i, /\bshall\s*not\s*solicit\s*(any\s*)?(employee|client|customer)/i],
    meaning:
      "You cannot recruit former colleagues or approach the company's clients for a stated period. Usually narrower and more enforceable than a non-compete.",
    ask: "How long does this last, and does it cover clients I brought in myself?",
  },
  {
    id: "variable-discretion",
    title: "Variable pay is fully discretionary",
    severity: "high",
    patterns: [
      /\b(variable|bonus|incentive|performance)\s*[^.]{0,80}\b(sole\s*discretion|discretion\s*of\s*(the\s*)?(management|company)|not\s*guaranteed|no\s*guarantee)/i,
      /\b(sole|absolute)\s*discretion\s*of\s*(the\s*)?(management|company|board)[^.]{0,80}\b(variable|bonus|incentive)/i,
    ],
    meaning:
      "The variable portion of your CTC can be paid at any percentage, including zero, and you have no contractual claim on it. Treat it as a possible upside, never as salary.",
    ask: "What percentage of target variable was actually paid company-wide in each of the last two years?",
  },
  {
    id: "clawback",
    title: "Bonus clawback",
    severity: "medium",
    patterns: [
      /\b(joining|sign[\s-]*on|signing|retention|relocation)\s*bonus[^.]{0,120}\b(refund|repay|return|recover|forfeit)/i,
      /\b(refund|repay|return)[^.]{0,80}\b(joining|sign[\s-]*on|retention|relocation)\s*bonus/i,
    ],
    meaning:
      "If you leave inside the stated window you must pay the bonus back — often the gross amount, even though you only ever received the post-tax figure.",
    ask: "Is the repayment the gross or the net amount, and does it reduce month by month?",
  },
  {
    id: "salary-revision",
    title: "Compensation can be revised at the company's discretion",
    severity: "medium",
    patterns: [
      /\b(salary|compensation|ctc|remuneration)[^.]{0,100}\b(may\s*be\s*(revised|modified|changed|altered)|subject\s*to\s*(revision|change))[^.]{0,60}\b(discretion|company|management|time\s*to\s*time)/i,
    ],
    meaning:
      "The employer reserves the right to restructure your pay. In practice this is usually used for reshuffling components rather than cuts, but it is a real clause.",
    ask: "Has the company revised anyone's fixed pay downward in the last two years?",
  },
  {
    id: "probation",
    title: "Probation period, possibly extendable",
    severity: "low",
    patterns: [/\bprobation(ary)?\s*(period|of)\b/i],
    meaning:
      "During probation, notice is usually much shorter on both sides and some benefits may not apply. Extendable probation means the company can keep you in that state longer.",
    ask: "How long is probation, can it be extended, and which benefits don't apply until it ends?",
  },
  {
    id: "ip-assignment",
    title: "Broad intellectual property assignment",
    severity: "medium",
    patterns: [
      /\ball\s*(intellectual\s*property|inventions|works|creations)[^.]{0,120}\b(shall\s*(vest|belong)|assign)/i,
      /\b(assign|transfer)[^.]{0,60}\b(all|any)\s*(rights|intellectual\s*property)[^.]{0,60}\bcompany/i,
    ],
    meaning:
      "Work you create belongs to the employer. Standard — but check whether it is written broadly enough to swallow side projects built on your own time and equipment.",
    ask: "Does this cover work done outside office hours on my own equipment, and can we carve out my existing projects?",
  },
  {
    id: "transfer",
    title: "Transfer or relocation at company discretion",
    severity: "low",
    patterns: [
      /\b(transfer|depute|relocat|post)[a-z]*\s*(you|your\s*services)?[^.]{0,100}\b(any\s*(other\s*)?(location|office|branch|city|place)|group\s*company|affiliate)/i,
    ],
    meaning:
      "You can be moved to another city or another group entity. Worth knowing before you sign a rental agreement.",
    ask: "Is relocation at my cost, and can I decline without it counting as resignation?",
  },
  {
    id: "garden-leave",
    title: "Garden leave",
    severity: "low",
    patterns: [/\bgarden(ing)?\s*leave\b/i],
    meaning:
      "The company can require you to stay away from work while still employed and still bound by your obligations — which delays your start date elsewhere.",
    ask: "Is garden leave paid at full fixed pay, and does it count toward the notice period?",
  },
  {
    id: "no-notice-buyout",
    title: "Notice period cannot be bought out",
    severity: "medium",
    patterns: [
      /\bnotice\s*period[^.]{0,100}\b(cannot|shall\s*not|may\s*not)\s*be\s*(bought|brought)\s*out/i,
      /\bno\s*(buy[\s-]*out|encashment)\s*of\s*notice/i,
    ],
    meaning:
      "You must physically serve the whole notice period. This is the single most common reason people lose a better offer.",
    ask: "Is there any circumstance in which the company waives or shortens notice?",
  },
  {
    id: "offer-lapse",
    title: "Offer can be withdrawn before you join",
    severity: "medium",
    patterns: [
      /\b(offer|this\s*letter)[^.]{0,120}\b(withdraw|revoke|rescind|stand\s*cancelled|null\s*and\s*void)/i,
      /\bsubject\s*to[^.]{0,80}\b(background|verification|reference)\s*check/i,
    ],
    meaning:
      "The offer is conditional until you actually start. Normal — but do not resign from your current job until every condition here is cleared in writing.",
    ask: "Which checks are still pending, and can you confirm in writing once they clear?",
  },
];

/**
 * Split into clauses without eating decimal points or "Rs." abbreviations.
 *
 * Line breaks are split on FIRST, and horizontal whitespace collapsed only
 * within a line. An offer letter is a line-structured document and its line
 * breaks are the most reliable clause boundary in it — collapsing them into
 * spaces before splitting left the whole numbered TERMS section as one
 * 2,000-character blob. Every flag then quoted the same opening chunk of it,
 * and the notice-period flag quoted the salary table, which reads exactly like
 * the invention the quote exists to rule out.
 *
 * Numbered markers get their own boundary because a paste out of a PDF often
 * arrives with the line breaks already flattened, and "…bought out. 2. The
 * Joining Bonus…" splits at neither full stop: the first is followed by a
 * digit rather than a capital, and the second is preceded by one.
 */
function sentences(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split(
      /\n+|(?=\b\d{1,2}\.\s+[A-Z])|(?<![A-Z][a-z]?)(?<!\d)\.(?=\s+[A-Z(])|(?<=[;:])\s+(?=[A-Z])/,
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

export function detectRedFlags(text: string): RedFlag[] {
  const found: RedFlag[] = [];
  const parts = sentences(text);

  for (const rule of RULES) {
    for (const sentence of parts) {
      if (!rule.patterns.some((pattern) => pattern.test(sentence))) continue;
      if (rule.confirm && !rule.confirm(sentence)) continue;
      found.push({
        id: rule.id,
        title: rule.title,
        severity: rule.severity,
        meaning: rule.meaning,
        ask: rule.ask,
        quote: sentence.length > 320 ? `${sentence.slice(0, 317)}…` : sentence,
      });
      break; // one flag per rule, quoting the first place it appears
    }
  }

  const weight = { high: 0, medium: 1, low: 2 } as const;
  return found.sort((a, b) => weight[a.severity] - weight[b.severity]);
}

/** Clauses whose ABSENCE is itself worth flagging. */
export function detectMissingClauses(text: string): string[] {
  const missing: string[] = [];
  const has = (pattern: RegExp) => pattern.test(text);

  if (!has(/\b(provident\s*fund|\bpf\b|epf)/i)) {
    missing.push("No mention of provident fund. Confirm PF is deducted and matched — it is statutory for most employers.");
  }
  if (!has(/\bgratuity\b/i)) {
    missing.push("No mention of gratuity. It becomes payable after five years of continuous service.");
  }
  if (!has(/\bnotice\s*period\b/i)) {
    missing.push("No notice period stated. Get it in writing before you resign anywhere else.");
  }
  if (!has(/\b(working\s*hours|shift|timing)\b/i)) {
    missing.push("No working hours or shift expectations stated. Worth asking, especially if the role supports another time zone.");
  }
  // "Leave Travel Allowance" is a salary component, not a leave policy, so the
  // pattern has to ask for policy words specifically.
  if (
    !has(
      /\b(earned|casual|sick|annual|privilege|maternity|paternity)\s*leave\b|\bleave\s*(policy|entitlement|balance|encash)|\bpaid\s*time\s*off\b|\bpto\b|\bholiday\s*(list|calendar|policy)\b|\bvacation\s*(policy|days)\b/i,
    )
  ) {
    missing.push("No leave policy mentioned. Ask for the numbers: earned leave, casual, sick, and whether leave carries forward.");
  }
  if (!has(/\b(appraisal|increment|review|revision)\b/i)) {
    missing.push("No appraisal cycle mentioned. Ask when your first review falls — joining in the wrong month can cost you a full cycle.");
  }
  return missing;
}
