/**
 * GradHunt — Constants
 *
 * Central location for all application-wide constants.
 */

/**
 * GradHunt — Constants
 *
 * Central location for all application-wide constants.
 * Note: GradHunt operates as a persistent, continuously refreshed job database.
 * Listings remain active as long as they are verified on their public sources.
 */

/**
 * Historical window reference for freshness diagnostics (in hours).
 * Freshness is used for ranking, badges, and sorting (newest first);
 * active jobs are NEVER deleted merely because they are older than this window.
 */
export const FRESHNESS_WINDOW_HOURS = parseInt(process.env.FRESHNESS_WINDOW_HOURS || "720", 10);

/** How often the cron job runs (in minutes) — 6 hours. */
export const REFRESH_INTERVAL_MINUTES = 360;

/** Request timeout for source adapters (in milliseconds). */
export const SOURCE_FETCH_TIMEOUT_MS = 30_000;

/** Maximum number of retries for source fetch failures. */
export const SOURCE_FETCH_MAX_RETRIES = 2;

/** Delay between retries (in milliseconds). */
export const SOURCE_FETCH_RETRY_DELAY_MS = 1_000;

/** Default page size for the /api/jobs endpoint. */
export const API_DEFAULT_PAGE_SIZE = 10;

/** Maximum page size for the /api/jobs endpoint. */
export const API_MAX_PAGE_SIZE = 100;

/**
 * Gemini Pricing Configuration (per million tokens).
 * Configurable via environment variables with sensible defaults for Gemini Flash models.
 */
export const GEMINI_CONFIG = {
  defaultModel: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  inputCostPerMillion: parseFloat(process.env.GEMINI_INPUT_COST_PER_MILLION || "0.075"),
  outputCostPerMillion: parseFloat(process.env.GEMINI_OUTPUT_COST_PER_MILLION || "0.30"),
} as const;

/**
 * Deterministic keyword lists for fresher/intern candidate filtering.
 * All matching is case-insensitive.
 */
export const FRESHER_TITLE_KEYWORDS = [
  "intern",
  "internship",
  "fresher",
  "fresh graduate",
  "graduate",
  "entry level",
  "entry-level",
  "trainee",
  "apprentice",
  "junior",
  "new grad",
  "new graduate",
  "campus",
  "co-op",
  "coop",
  "placement",
  "scholar",
  "fellow",
  "fellowship",
] as const;

export const FRESHER_DESCRIPTION_KEYWORDS = [
  "0-1 years",
  "0 to 1 year",
  "0-2 years",
  "0 to 2 years",
  "0-3 years",
  "0 to 3 years",
  "no experience required",
  "no prior experience",
  "freshers welcome",
  "fresh graduates",
  "recent graduate",
  "recent graduates",
  "currently pursuing",
  "currently enrolled",
  "final year",
  "penultimate year",
  "graduating in",
  "expected graduation",
] as const;

/**
 * Public Source Discovery Configuration.
 *
 * ARCHITECTURAL RULE:
 * These seeds represent public ATS endpoints and slugs technically required to
 * query public job boards. They are NEVER treated as an allowlist or company universe.
 * Any company returned by any supported source is automatically processed, normalized,
 * and displayed on GradHunt.
 */
export const SOURCE_DISCOVERY_CONFIG = {
  /** Public Greenhouse job board slugs */
  greenhouse: [
    // Global tech employers with verified hiring in India
    "airbnb",
    "canonical",
    "cloudflare",
    "cockroachlabs",
    "databricks",
    "datadog",
    "discord",
    "dropbox",
    "duolingo",
    "figma",
    "gitlab",
    "instacart",
    "lyft",
    "mongodb",
    "okta",
    "ramp",
    "reddit",
    "robinhood",
    "rubrik",
    "samsara",
    "stripe",
    "twilio",
    "verkada",
    "zscaler",
    // Prominent employers with active Indian engineering centers & internship programs
    "inmobi",
    "glance",
    "purestorage",
    "netskope",
    "elastic",
    "toast",
    "deliveroo",
    "groww",
    "slice",
    "sumologic",
    "launchdarkly",
    "adyen",
    "anthropic",
    "smartsheet",
    "speechify",
    "coursera",
    "newrelic",
    "devrev",
    "jumio",
    "entrupy",
    "instawork",
    "hackerrank",
    "singlestore",
    "enterpret",
    "quince",
    "sonicwall",
    "alphasense",
    "commerceiq",
    "grafanalabs",
    "pubmatic",
    "porter",
    "fastly",
  ] as const,

  /** Public Lever company slugs */
  lever: [
    "spotify",
    "palantir",
    "coupa",
    "wealthfront",
    "paytm",
    "ciandt",
    "zoox",
    "outreach",
    "meesho",
    "cred",
    "pocketfm",
    "fi",
    "porter",
  ] as const,

  /** Public Ashby company slugs */
  ashby: [
    "ramp",
    "notion",
    "linear",
    "mercury",
    "openai",
    "cursor",
    "midjourney",
    "replit",
    "cohere",
    "anyscale",
    "hex",
    "hightouch",
    "bureau",
    "thoughtworks",
    "elevenlabs",
    "sarvam-ai",
    "spotdraft",
    "certifyos",
    "aiprise",
    "genera",
    "smallest",
    "bolna",
    "sycamore",
    "navi",
  ] as const,

  /**
   * Public SmartRecruiters company identifiers.
   * SmartRecruiters hosts public job postings under:
   * https://api.smartrecruiters.com/v1/companies/{company}/postings
   * Fully paginated with offset & limit up to 100 per page.
   */
  smartrecruiters: [
    "averydennison",
    "smartrecruiters",
    "publicisgroupe",
    "criteo",
    "skechers",
    "visa",
    "ubisoft",
    "square",
    "block",
    "ikea",
  ] as const,

  /**
   * Public Recruitee company subdomains.
   * Recruitee hosts unauthenticated public job offers under:
   * https://{company}.recruitee.com/api/offers/
   */
  recruitee: [
    "clanx",
    "fulfilio",
    "deephealth",
    "mgid",
    "bunq",
    "tacnique",
    "blendle",
  ] as const,

  /**
   * Public Pinpoint company subdomains.
   * Pinpoint hosts unauthenticated public job postings under:
   * https://{company}.pinpointhq.com/postings.json
   */
  pinpoint: [
    "cgt",
    "bluecross",
    "butlins",
    "pinpoint",
    "riverisland",
  ] as const,
} as const;

/** Aliases for backwards compatibility with existing adapter imports */
export const GREENHOUSE_BOARDS = SOURCE_DISCOVERY_CONFIG.greenhouse;
export const LEVER_COMPANIES = SOURCE_DISCOVERY_CONFIG.lever;
export const ASHBY_COMPANIES = SOURCE_DISCOVERY_CONFIG.ashby;
export const SMARTRECRUITERS_COMPANIES = SOURCE_DISCOVERY_CONFIG.smartrecruiters;
export const RECRUITEE_COMPANIES = SOURCE_DISCOVERY_CONFIG.recruitee;
export const PINPOINT_COMPANIES = SOURCE_DISCOVERY_CONFIG.pinpoint;

/**
 * Active Feed Freshness Policy.
 * The default user-facing feed displays postings within this maximum age in days
 * (default 90 days). Older postings remain retained and synchronized in the database
 * but are excluded from the default feed unless explicitly queried or requested.
 */
export const DEFAULT_ACTIVE_FEED_MAX_AGE_DAYS = parseInt(
  process.env.ACTIVE_FEED_MAX_AGE_DAYS || "90",
  10
);
