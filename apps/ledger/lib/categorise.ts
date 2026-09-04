/**
 * Merchant categorisation for Indian bank and UPI narrations.
 *
 * A rules engine rather than a model, for three reasons: it costs nothing to
 * run, it gives the same answer twice, and every categorisation can be
 * explained by naming the keyword that produced it. The UI shows that keyword,
 * so a wrong guess is visible and correctable rather than mysterious.
 */

export type CategoryId =
  | "salary"
  | "client-payment"
  | "interest-income"
  | "refund"
  | "other-income"
  | "rent"
  | "utilities"
  | "telecom-internet"
  | "software-saas"
  | "advertising"
  | "professional-fees"
  | "travel"
  | "fuel"
  | "food-delivery"
  | "groceries"
  | "shopping"
  | "healthcare"
  | "education"
  | "entertainment"
  | "insurance"
  | "investments"
  | "loan-emi"
  | "credit-card"
  | "taxes"
  | "bank-charges"
  | "cash-withdrawal"
  | "transfer"
  | "uncategorised";

export type Category = {
  id: CategoryId;
  label: string;
  direction: "in" | "out" | "either";
  /**
   * Whether an expense in this category commonly carries GST that a
   * registered business might claim. Advisory only — a bank statement never
   * shows a tax component, and eligibility depends on the invoice.
   */
  commonlyCarriesGst: boolean;
  /** Whether this is typically a business rather than personal expense. */
  businessLikely: boolean;
};

export const CATEGORIES: Record<CategoryId, Category> = {
  salary: { id: "salary", label: "Salary received", direction: "in", commonlyCarriesGst: false, businessLikely: false },
  "client-payment": { id: "client-payment", label: "Client / invoice payment", direction: "in", commonlyCarriesGst: false, businessLikely: true },
  "interest-income": { id: "interest-income", label: "Interest received", direction: "in", commonlyCarriesGst: false, businessLikely: false },
  refund: { id: "refund", label: "Refund / reversal", direction: "in", commonlyCarriesGst: false, businessLikely: false },
  "other-income": { id: "other-income", label: "Other money in", direction: "in", commonlyCarriesGst: false, businessLikely: false },
  rent: { id: "rent", label: "Rent", direction: "out", commonlyCarriesGst: false, businessLikely: true },
  utilities: { id: "utilities", label: "Electricity, water, gas", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  "telecom-internet": { id: "telecom-internet", label: "Mobile & internet", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  "software-saas": { id: "software-saas", label: "Software & subscriptions", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  advertising: { id: "advertising", label: "Advertising & marketing", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  "professional-fees": { id: "professional-fees", label: "Professional fees", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  travel: { id: "travel", label: "Travel & transport", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  fuel: { id: "fuel", label: "Fuel", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  "food-delivery": { id: "food-delivery", label: "Food & dining", direction: "out", commonlyCarriesGst: true, businessLikely: false },
  groceries: { id: "groceries", label: "Groceries", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  shopping: { id: "shopping", label: "Shopping", direction: "out", commonlyCarriesGst: true, businessLikely: false },
  healthcare: { id: "healthcare", label: "Health & medical", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  education: { id: "education", label: "Education", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  entertainment: { id: "entertainment", label: "Entertainment", direction: "out", commonlyCarriesGst: true, businessLikely: false },
  insurance: { id: "insurance", label: "Insurance", direction: "out", commonlyCarriesGst: true, businessLikely: false },
  investments: { id: "investments", label: "Investments & savings", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  "loan-emi": { id: "loan-emi", label: "Loan EMI", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  "credit-card": { id: "credit-card", label: "Credit card payment", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  taxes: { id: "taxes", label: "Tax paid", direction: "out", commonlyCarriesGst: false, businessLikely: true },
  "bank-charges": { id: "bank-charges", label: "Bank charges", direction: "out", commonlyCarriesGst: true, businessLikely: true },
  "cash-withdrawal": { id: "cash-withdrawal", label: "Cash withdrawal", direction: "out", commonlyCarriesGst: false, businessLikely: false },
  transfer: { id: "transfer", label: "Transfer between own accounts", direction: "either", commonlyCarriesGst: false, businessLikely: false },
  uncategorised: { id: "uncategorised", label: "Not categorised", direction: "either", commonlyCarriesGst: false, businessLikely: false },
};

type Rule = {
  category: CategoryId;
  /** Matched case-insensitively against the narration. */
  keywords: string[];
  /** Only apply to money in / money out. */
  direction?: "in" | "out";
  /** Higher wins when two rules match. */
  weight?: number;
};

// Ordered roughly by specificity; ties break on `weight`, then on order.
const RULES: Rule[] = [
  // --- money in -----------------------------------------------------------
  { category: "salary", keywords: ["salary", "sal cr", "salcr", "payroll", "wages", "stipend"], direction: "in", weight: 10 },
  { category: "interest-income", keywords: ["int.pd", "int pd", "interest credit", "interest paid", "sb int", "fd interest", "int cr"], direction: "in", weight: 9 },
  { category: "refund", keywords: ["refund", "reversal", "rev of", "cashback", "chargeback"], direction: "in", weight: 9 },
  { category: "client-payment", keywords: ["invoice", "inv no", "consulting", "retainer", "professional charges", "upwork", "payoneer", "wise", "paypal", "stripe", "razorpay payout", "freelance"], weight: 8 },

  // --- taxes and statutory (before generic transfers) ----------------------
  // "gst" on its own is too greedy: bank fee lines routinely read
  // "SMS CHARGES INCL GST", which is a bank charge, not a tax payment.
  { category: "taxes", keywords: ["gst payment", "gst chln", "gst challan", "cgst", "sgst", "igst", "gstn", "income tax", "itns", "tds ", "tds-", "advance tax", "self assessment", "challan", "tin nsdl"], weight: 12 },

  // --- housing and bills ---------------------------------------------------
  { category: "rent", keywords: ["rent", "nobroker", "rentpay", "landlord", "housing society", "maintenance charges"], direction: "out", weight: 9 },
  { category: "utilities", keywords: ["electricity", "bescom", "mseb", "msedcl", "tneb", "tangedco", "adani electricity", "tata power", "torrent power", "bses", "cesc", "water bill", "jal board", "indane", "hp gas", "bharatgas", "gail", "mahanagar gas", "igl bill"], direction: "out", weight: 9 },
  { category: "telecom-internet", keywords: ["airtel", "jio", "vodafone", "vi recharge", "bsnl", "act fibernet", "hathway", "excitel", "tikona", "broadband", "recharge"], direction: "out", weight: 8 },

  // --- business ------------------------------------------------------------
  { category: "software-saas", keywords: ["aws", "amazon web serv", "google cloud", "gcp", "azure", "digitalocean", "vercel", "netlify", "cloudflare", "github", "gitlab", "atlassian", "jira", "slack", "notion", "figma", "adobe", "canva", "openai", "anthropic", "zoho", "freshworks", "hubspot", "mailchimp", "sendgrid", "twilio", "godaddy", "namecheap", "hostinger", "digital ocean", "jetbrains", "linear app", "dropbox", "zoom.us", "microsoft 365", "office 365"], direction: "out", weight: 10 },
  { category: "advertising", keywords: ["google ads", "google adwords", "facebook ads", "meta platforms", "linkedin ads", "instagram ads", "taboola", "outbrain"], direction: "out", weight: 11 },
  { category: "professional-fees", keywords: ["chartered accountant", "ca fees", "audit fee", "legal fees", "advocate", "consultancy", "company secretary", "cleartax", "quickbooks", "tally"], direction: "out", weight: 8 },

  // --- daily life ----------------------------------------------------------
  { category: "travel", keywords: ["uber", "ola", "rapido", "irctc", "indigo", "air india", "spicejet", "vistara", "akasa", "makemytrip", "goibibo", "cleartrip", "yatra", "redbus", "abhibus", "oyo", "airbnb", "booking.com", "namma yatri", "metro rail", "dmrc", "bmrcl", "fastag", "toll"], direction: "out", weight: 9 },
  { category: "fuel", keywords: ["petrol", "diesel", "fuel", "indian oil", "iocl", "bharat petroleum", "bpcl", "hindustan petroleum", "hpcl", "shell ", "nayara", "reliance petro"], direction: "out", weight: 9 },
  { category: "food-delivery", keywords: ["swiggy", "zomato", "eatsure", "dominos", "mcdonald", "kfc", "pizza hut", "burger king", "starbucks", "chaayos", "third wave", "blue tokai", "restaurant", "cafe ", "bakery", "eatfit", "box8", "faasos", "behrouz", "biryani"], direction: "out", weight: 8 },
  { category: "groceries", keywords: ["bigbasket", "blinkit", "zepto", "instamart", "dmart", "d mart", "reliance fresh", "more retail", "spencer", "nature basket", "licious", "freshtohome", "country delight", "milkbasket", "kirana", "supermarket", "provision"], direction: "out", weight: 8 },
  { category: "shopping", keywords: ["amazon", "flipkart", "myntra", "ajio", "nykaa", "meesho", "tatacliq", "snapdeal", "decathlon", "ikea", "croma", "reliance digital", "vijay sales", "lenskart", "boat lifestyle", "shoppers stop", "lifestyle stores", "westside", "zara", "h&m", "uniqlo"], direction: "out", weight: 6 },
  { category: "healthcare", keywords: ["apollo", "pharmeasy", "1mg", "tata 1mg", "netmeds", "medplus", "practo", "fortis", "manipal", "narayana", "max healthcare", "aiims", "diagnostic", "pathology", "dr lal", "metropolis", "thyrocare", "hospital", "clinic", "pharmacy", "chemist"], direction: "out", weight: 8 },
  { category: "education", keywords: ["udemy", "coursera", "edx", "byju", "unacademy", "vedantu", "scaler", "upgrad", "great learning", "school fee", "college fee", "tuition", "university"], direction: "out", weight: 8 },
  { category: "entertainment", keywords: ["netflix", "spotify", "hotstar", "jiocinema", "sonyliv", "zee5", "prime video", "youtube premium", "bookmyshow", "pvr", "inox", "cinepolis", "gaana", "wynk", "audible", "kindle"], direction: "out", weight: 9 },
  { category: "insurance", keywords: ["insurance", "lic of india", "lic premium", "policybazaar", "hdfc life", "icici pru", "sbi life", "max life", "bajaj allianz", "star health", "niva bupa", "acko", "digit insurance"], direction: "out", weight: 9 },
  { category: "investments", keywords: ["zerodha", "groww", "upstox", "angel one", "icici direct", "kotak securities", "hdfc securities", "mutual fund", "sip ", " sip", "nps ", "ppf", "cams", "kfintech", "bse star", "nse ", "indmoney", "coin dcx", "wazirx", "smallcase", "recurring deposit", "fixed deposit", "rd instal"], direction: "out", weight: 9 },
  { category: "loan-emi", keywords: ["emi", "loan repay", "loan instal", "home loan", "car loan", "personal loan", "bajaj finserv", "hdb financial", "tata capital", "lending"], direction: "out", weight: 8 },
  { category: "credit-card", keywords: ["credit card", "cc payment", "card payment", "autopay cc", "billdesk cc", "cred "], direction: "out", weight: 8 },
  { category: "bank-charges", keywords: ["charges", "chrg", "service charge", "amc ", "annual fee", "sms charge", "atm decline", "penalty", "min bal", "gst on"], direction: "out", weight: 7 },
  { category: "cash-withdrawal", keywords: ["atm", "cash wdl", "cash withdrawal", "self withdrawal", "nfs "], direction: "out", weight: 9 },
  { category: "transfer", keywords: ["self transfer", "own account", "to self", "self/", "imps self"], weight: 7 },
];

export type Categorisation = {
  category: CategoryId;
  /** The keyword that decided it, so the user can see why. */
  matchedOn: string | null;
  /** "rule" when a keyword matched, "direction" when we fell back on sign. */
  basis: "rule" | "direction" | "none";
};

export function categorise(narration: string, amountMinor: number): Categorisation {
  const text = narration.toLowerCase();
  const direction = amountMinor >= 0 ? "in" : "out";

  let bestRule: { rule: Rule; keyword: string } | null = null;
  for (const rule of RULES) {
    if (rule.direction && rule.direction !== direction) continue;
    for (const keyword of rule.keywords) {
      if (!text.includes(keyword)) continue;
      const currentWeight = bestRule?.rule.weight ?? 0;
      const candidateWeight = rule.weight ?? 5;
      // Prefer higher weight, then the longer (more specific) keyword.
      if (
        candidateWeight > currentWeight ||
        (candidateWeight === currentWeight && keyword.length > (bestRule?.keyword.length ?? 0))
      ) {
        bestRule = { rule, keyword };
      }
      break;
    }
  }

  if (bestRule) {
    return { category: bestRule.rule.category, matchedOn: bestRule.keyword.trim(), basis: "rule" };
  }

  // No keyword matched. Money in with no clue is "other income"; money out
  // stays explicitly uncategorised rather than being guessed into a bucket.
  if (direction === "in") return { category: "other-income", matchedOn: null, basis: "direction" };
  return { category: "uncategorised", matchedOn: null, basis: "none" };
}
