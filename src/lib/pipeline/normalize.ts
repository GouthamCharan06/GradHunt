/**
 * GradHunt — Phase 3: Authoritative Location Resolution & Generic Normalization
 *
 * Converts raw source records into the canonical Job schema.
 *
 * Core architectural guarantees:
 *   1. Authoritative Job Location: Location resolution operates ONLY on the job's
 *      own location and workplace metadata. Company office footprints must NEVER
 *      be used to convert an international job into an Indian job.
 *   2. Strict India Geography: Only jobs where the actual position is explicitly in
 *      India (Indian city/state or India-specific remote) are classified as India.
 *      Generic "Remote" without India association is strictly non-India.
 *   3. Decoupled Fields: `country`, `city`, and `workMode` are independent.
 *      "Remote" is NEVER used as a city.
 *   4. Generic Company Formatting: No company allowlists or hardcoded override maps.
 *      Every company from any source is formatted deterministically and treated equally.
 *   5. Generic Role Classification: Deterministic title-based taxonomy classification
 *      without requiring LLM calls for standard job titles.
 */

import { createHash } from "crypto";
import { Job, JobSource, WorkMode, RoleCategory, ROLE_TAXONOMY } from "../types/job";
import {
  GreenhouseRawJob,
  LeverRawJob,
  AshbyRawJob,
  SmartRecruitersRawJob,
  RecruiteeRawJob,
  PinpointRawJob,
} from "../adapters/types";

// ─── Canonical Indian Cities & Aliases ────────────────────────────────────────

export const INDIAN_CITY_CANONICAL_MAP: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  bombay: "Mumbai",
  mumbai: "Mumbai",
  delhi: "New Delhi",
  "new delhi": "New Delhi",
  ncr: "New Delhi NCR",
  "delhi ncr": "New Delhi NCR",
  hyderabad: "Hyderabad",
  secunderabad: "Hyderabad",
  pune: "Pune",
  poona: "Pune",
  chennai: "Chennai",
  madras: "Chennai",
  noida: "Noida",
  "greater noida": "Noida",
  kolkata: "Kolkata",
  calcutta: "Kolkata",
  ahmedabad: "Ahmedabad",
  jaipur: "Jaipur",
  chandigarh: "Chandigarh",
  mohali: "Mohali",
  kochi: "Kochi",
  cochin: "Kochi",
  thiruvananthapuram: "Thiruvananthapuram",
  trivandrum: "Thiruvananthapuram",
  indore: "Indore",
  bhopal: "Bhopal",
  coimbatore: "Coimbatore",
  nagpur: "Nagpur",
  vadodara: "Vadodara",
  baroda: "Vadodara",
  lucknow: "Lucknow",
  kanpur: "Kanpur",
  patna: "Patna",
  bhubaneswar: "Bhubaneswar",
  visakhapatnam: "Visakhapatnam",
  vizag: "Visakhapatnam",
  surat: "Surat",
  mysore: "Mysuru",
  mysuru: "Mysuru",
  mangaluru: "Mangaluru",
  mangalore: "Mangaluru",
  goa: "Goa",
  panaji: "Goa",
  dehradun: "Dehradun",
};

export const INDIAN_STATES: string[] = [
  "andhra pradesh",
  "arunachal pradesh",
  "assam",
  "bihar",
  "chhattisgarh",
  "goa",
  "gujarat",
  "haryana",
  "himachal pradesh",
  "jharkhand",
  "karnataka",
  "kerala",
  "madhya pradesh",
  "maharashtra",
  "manipur",
  "meghalaya",
  "mizoram",
  "nagaland",
  "odisha",
  "punjab",
  "rajasthan",
  "sikkim",
  "tamil nadu",
  "telangana",
  "tripura",
  "uttar pradesh",
  "uttarakhand",
  "west bengal",
  "delhi",
  "chandigarh",
  "jammu and kashmir",
  "ladakh",
  "puducherry",
];

// Common foreign geographic indicators (words that clearly indicate non-India)
const FOREIGN_LOCATIONS_REGEX =
  /\b(united states|usa?|canada|singapore|united kingdom|uk|great britain|england|scotland|germany|france|spain|barcelona|madrid|australia|sydney|melbourne|japan|tokyo|brazil|ireland|dublin|netherlands|amsterdam|poland|warsaw|sweden|stockholm|switzerland|zurich|mexico|italy|rome|milan|colombia|costa rica|philippines|manila|china|beijing|shanghai|taiwan|taipei|new zealand|auckland|portugal|lisbon|austria|vienna|belgium|brussels|czech|prague|romania|bucharest|hungary|budapest|israel|tel aviv|chicago|seattle|atlanta|austin|denver|boston|san francisco|los angeles|new york|california|texas|washington|virginia|georgia|florida|illinois|colorado|ohio|pennsylvania|north carolina|michigan|arizona)\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function titleCase(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function makeDedupKey(source: JobSource, sourceJobId: string): string {
  return sha256(`${source}:${sourceJobId}`);
}

export function makeCrossDedupKey(company: string, title: string, city: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return `${norm(company)}|${norm(title)}|${norm(city)}`;
}

// ─── Generic Company Formatting ───────────────────────────────────────────────

/**
 * Generically formats any company name.
 * Uses verbatim source company name if provided, or formats the slug deterministically.
 * NEVER uses a fixed company allowlist or hardcoded overrides.
 */
export function formatCompanyName(
  sourceProvidedCompany: string | undefined,
  slugFallback: string = ""
): string {
  if (sourceProvidedCompany && sourceProvidedCompany.trim().length > 0) {
    const trimmed = sourceProvidedCompany.trim();
    // If it doesn't look like a raw hyphenated slug, return verbatim
    if (!trimmed.includes("-") && !trimmed.includes("_")) {
      return trimmed;
    }
    // If it looks like a slug and no separate fallback was provided, format it
    if (!slugFallback || slugFallback.trim().length === 0) {
      slugFallback = trimmed;
    } else {
      return trimmed;
    }
  }
  if (!slugFallback || slugFallback.trim().length === 0) {
    return "Unknown";
  }
  // Deterministically split slug by hyphens or underscores and title-case words
  return slugFallback
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => {
      // Keep existing short uppercase acronyms like "AI"
      if (w.length <= 3 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

// ─── Authoritative Location Parser ────────────────────────────────────────────

export interface LocationParseOptions {
  sourceCountry?: string;
  sourceWorkplaceType?: string;
  sourceIsRemote?: boolean;
}

export interface ParsedLocation {
  city: string;
  state?: string;
  country: string;
  isRemote: boolean;
  workMode: WorkMode;
  isIndia: boolean;
  isIndiaRemote: boolean;
  rawLocation: string;
}

/**
 * Deterministically parses a job's OWN location metadata.
 * Authoritative: Company office locations are NOT used.
 */
export function parseLocation(
  raw: string | undefined | null,
  options: LocationParseOptions = {}
): ParsedLocation {
  const rawLocation = (raw ?? "").trim();
  const lower = rawLocation.toLowerCase();

  // 1. Detect Work Mode independently
  let workMode: WorkMode = "unknown";
  const hasRemoteKeyword =
    lower.includes("remote") ||
    lower.includes("work from home") ||
    lower.includes("wfh") ||
    options.sourceIsRemote === true ||
    options.sourceWorkplaceType?.toLowerCase() === "remote";

  const hasHybridKeyword =
    lower.includes("hybrid") ||
    options.sourceWorkplaceType?.toLowerCase() === "hybrid";

  const hasOnsiteKeyword =
    options.sourceWorkplaceType?.toLowerCase() === "onsite" ||
    options.sourceWorkplaceType?.toLowerCase() === "on-site";

  if (hasHybridKeyword) {
    workMode = "hybrid";
  } else if (hasRemoteKeyword) {
    workMode = "remote";
  } else if (hasOnsiteKeyword) {
    workMode = "on-site";
  }

  const isRemote = workMode === "remote";

  // 2. Check for explicit India cues in the job's OWN location
  const hasIndiaWord = /\bindia\b/i.test(lower);
  // Standalone uppercase IN (e.g. ", IN", "(IN)", "/IN", "- IN") or IND
  // Must NOT match lowercase English preposition "in" (e.g. "Remote in the US, Canada")
  const hasIndCountryCode =
    /(?:,|\/|\(|\[|-)\s*IN\s*(?:,|\/|\)|\]|-|$)/.test(rawLocation) ||
    /\bIND\b/i.test(rawLocation);
  const hasSourceIndiaCountry =
    options.sourceCountry?.toUpperCase() === "IN" ||
    options.sourceCountry?.toUpperCase() === "IND" ||
    options.sourceCountry?.toLowerCase() === "india";

  // Check for Indian city matches (sorted by length descending to match "new delhi" before "delhi")
  const sortedCityKeys = Object.keys(INDIAN_CITY_CANONICAL_MAP).sort(
    (a, b) => b.length - a.length
  );

  let matchedIndianCity: string | undefined;
  for (const cityKey of sortedCityKeys) {
    const regex = new RegExp(`\\b${cityKey}\\b`, "i");
    if (regex.test(lower)) {
      matchedIndianCity = INDIAN_CITY_CANONICAL_MAP[cityKey];
      break;
    }
  }

  // Check for Indian state matches
  let matchedIndianState: string | undefined;
  for (const stateName of INDIAN_STATES) {
    const regex = new RegExp(`\\b${stateName}\\b`, "i");
    if (regex.test(lower)) {
      matchedIndianState = titleCase(stateName);
      break;
    }
  }

  const hasIndiaSignal = Boolean(
    hasIndiaWord || hasIndCountryCode || hasSourceIndiaCountry || matchedIndianCity || matchedIndianState
  );

  // Check for explicit foreign locations (e.g. "Seattle, San Francisco, New York... Remote in the US, Canada")
  const hasExplicitForeign = FOREIGN_LOCATIONS_REGEX.test(lower);

  // If the location has foreign indicators AND does not explicitly list India, it is strictly foreign
  if (hasExplicitForeign && !hasIndiaWord && !hasIndCountryCode && !matchedIndianCity && !matchedIndianState) {
    return parseForeignLocation(rawLocation, options, workMode, isRemote);
  }

  // If no India signal is found at all, it cannot be classified as India
  // (Crucial: generic "Remote" with zero India indicator is strictly non-India)
  if (!hasIndiaSignal) {
    return parseForeignLocation(rawLocation, options, workMode, isRemote);
  }

  // 3. Indian Location Confirmed
  const country = "India";
  const isIndiaRemote = isRemote;

  let city = "Pan-India";
  if (matchedIndianCity) {
    city = matchedIndianCity;
  } else if (matchedIndianState) {
    city = matchedIndianState;
  } else if (isIndiaRemote) {
    city = "Pan-India";
  }

  if (workMode === "unknown" && city !== "Pan-India") {
    workMode = "on-site";
  }

  return {
    city,
    state: matchedIndianState,
    country,
    isRemote,
    workMode,
    isIndia: true,
    isIndiaRemote,
    rawLocation: rawLocation || "India",
  };
}

function parseForeignLocation(
  rawLocation: string,
  options: LocationParseOptions,
  workMode: WorkMode,
  isRemote: boolean
): ParsedLocation {
  const cleaned = rawLocation
    .replace(/\(HQ\)/gi, "")
    .replace(/\(Headquarters\)/gi, "")
    .replace(/\(Main\)/gi, "")
    .trim();

  const parts = cleaned
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let foreignCity = "Unknown";
  let foreignCountry = options.sourceCountry || "Unknown";

  if (parts.length === 1) {
    if (parts[0].toLowerCase() === "remote") {
      foreignCity = "Unknown";
      foreignCountry = options.sourceCountry || "Unknown";
    } else if (isRemote) {
      foreignCity = "Flexible";
      foreignCountry = options.sourceCountry || parts[0];
    } else {
      foreignCity = parts[0];
      foreignCountry = options.sourceCountry || parts[0];
    }
  } else if (parts.length >= 2) {
    foreignCity = parts[0];
    foreignCountry = options.sourceCountry || parts[parts.length - 1];
  }

  if (workMode === "unknown" && foreignCity !== "Unknown") {
    workMode = "on-site";
  }

  return {
    city: foreignCity,
    country: foreignCountry,
    isRemote,
    workMode,
    isIndia: false,
    isIndiaRemote: false,
    rawLocation: rawLocation || "Unknown",
  };
}

// ─── Generic Role Classifier ──────────────────────────────────────────────────

/**
 * Deterministically classifies standard technical and entry-level roles
 * based on title patterns. Generic across all companies.
 */
export function classifyRoleDeterministically(title: string): RoleCategory {
  const t = title.toLowerCase();

  if (/\b(frontend|front-end|front end|react|angular|vue)\b/i.test(t)) {
    return "Frontend Development";
  }
  if (/\b(backend|back-end|back end|node|django|golang|java developer|rails)\b/i.test(t)) {
    return "Backend Development";
  }
  if (/\b(fullstack|full-stack|full stack)\b/i.test(t)) {
    return "Full-Stack Development";
  }
  if (/\b(mobile|ios|android|flutter|react native)\b/i.test(t)) {
    return "Mobile Development";
  }
  if (/\b(devops|sre|site reliability|infrastructure|cloud|platform engineer)\b/i.test(t)) {
    return "DevOps / SRE";
  }
  if (/\b(data scien|machine learning|\bml\b|\bai\b|deep learning|llm|nlp)\b/i.test(t)) {
    return "Data Science / ML / AI";
  }
  if (/\b(data engineer|etl|big data|data pipeline)\b/i.test(t)) {
    return "Data Engineering";
  }
  if (/\b(data analy|business analyst|analytics)\b/i.test(t)) {
    return "Data Analytics";
  }
  if (/\b(qa\b|quality assurance|testing|test engineer|sdet)\b/i.test(t)) {
    return "QA / Testing";
  }
  if (/\b(cyber|security|infosec|soc analyst)\b/i.test(t)) {
    return "Cybersecurity";
  }
  if (/\b(software|sde|developer|programmer|application engineer|engineer)\b/i.test(t)) {
    return "Software Engineering";
  }
  if (/\b(product manager|product associate|associate product)\b/i.test(t)) {
    return "Product Management";
  }
  if (/\b(ui|ux|designer|product design)\b/i.test(t)) {
    return "Design (UI/UX)";
  }
  if (/\b(technical writer|documentation)\b/i.test(t)) {
    return "Technical Writing";
  }
  if (/\b(system admin|it support|helpdesk|network)\b/i.test(t)) {
    return "IT / System Administration";
  }
  if (/\b(operations|business operations)\b/i.test(t)) {
    return "Business / Operations";
  }
  if (/\b(marketing|growth|seo|content)\b/i.test(t)) {
    return "Marketing / Growth";
  }
  if (/\b(sales|business development|bdr|sdr)\b/i.test(t)) {
    return "Sales / Business Development";
  }
  if (/\b(hr|human resources|people ops|talent)\b/i.test(t)) {
    return "Human Resources";
  }
  if (/\b(finance|accounting|accountant)\b/i.test(t)) {
    return "Finance / Accounting";
  }
  if (/\b(support|customer success|customer service)\b/i.test(t)) {
    return "Customer Support";
  }
  if (/\b(research|researcher|scientist)\b/i.test(t)) {
    return "Research";
  }
  if (/\b(hardware|embedded|firmware|iot)\b/i.test(t)) {
    return "Hardware / Embedded";
  }

  return "Other";
}

// ─── Normalization Result ────────────────────────────────────────────────────

export interface NormalizationExclusion {
  sourceJobId: string;
  source: JobSource;
  reason: string;
  title?: string;
}

export interface NormalizationResult {
  jobs: Job[];
  excluded: NormalizationExclusion[];
  timestampKind: string;
}

// ─── Greenhouse Normalizer ───────────────────────────────────────────────────

export function normalizeGreenhouse(
  records: GreenhouseRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (raw.id == null) {
      excluded.push({
        sourceJobId: "unknown",
        source: "greenhouse",
        reason: "Missing job ID",
        title: raw.title,
      });
      continue;
    }
    const sourceJobId = String(raw.id);

    if (!raw.title || raw.title.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "greenhouse",
        reason: "Missing or empty title",
      });
      continue;
    }

    if (!raw.absolute_url || raw.absolute_url.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "greenhouse",
        reason: "Missing application URL (absolute_url)",
        title: raw.title,
      });
      continue;
    }

    if (!raw.updated_at || raw.updated_at.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "greenhouse",
        reason: "Missing timestamp (updated_at)",
        title: raw.title,
      });
      continue;
    }

    const parsedTimestamp = new Date(raw.updated_at);
    if (isNaN(parsedTimestamp.getTime())) {
      excluded.push({
        sourceJobId,
        source: "greenhouse",
        reason: `Invalid timestamp: "${raw.updated_at}"`,
        title: raw.title,
      });
      continue;
    }

    // Authoritative location: Use ONLY the job's own location string.
    // Company office locations are NOT used.
    const loc = parseLocation(raw.location?.name);
    const company = formatCompanyName(raw._company, raw._boardSlug);
    const role = classifyRoleDeterministically(raw.title);

    const ageMs = new Date(fetchedAt).getTime() - parsedTimestamp.getTime();
    const isWithin24Hours = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;

    const job: Job = {
      id: `greenhouse::${sourceJobId}`,
      sourceJobId,
      source: "greenhouse",
      sourceUrl: raw.absolute_url,
      applicationUrl: raw.absolute_url,
      title: raw.title.trim(),
      company,
      description: raw.content ?? "",
      city: loc.city,
      state: loc.state,
      country: loc.country,
      isRemote: loc.isRemote,
      workMode: loc.workMode,
      rawLocation: loc.rawLocation,
      publishedAt: parsedTimestamp.toISOString(),
      postedAt: parsedTimestamp.toISOString(),
      updatedAt: parsedTimestamp.toISOString(),
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: "updated",
      isTimestampReliable: true,
      isWithin24Hours,
      fetchedAt,
      isFresherCandidate: false,
      role,
      dedupKey: makeDedupKey("greenhouse", sourceJobId),
      crossDedupKey: makeCrossDedupKey(company, raw.title.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "updated" };
}

// ─── Lever Normalizer ────────────────────────────────────────────────────────

export function normalizeLever(
  records: LeverRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (!raw.id || raw.id.trim().length === 0) {
      excluded.push({
        sourceJobId: "unknown",
        source: "lever",
        reason: "Missing job ID",
        title: raw.text,
      });
      continue;
    }

    if (!raw.text || raw.text.trim().length === 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "lever",
        reason: "Missing or empty title (text)",
      });
      continue;
    }

    if (!raw.hostedUrl || raw.hostedUrl.trim().length === 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "lever",
        reason: "Missing application URL (hostedUrl)",
        title: raw.text,
      });
      continue;
    }

    if (raw.createdAt == null || raw.createdAt <= 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "lever",
        reason: "Missing or invalid timestamp (createdAt)",
        title: raw.text,
      });
      continue;
    }

    const parsedTimestamp = new Date(raw.createdAt);
    if (isNaN(parsedTimestamp.getTime())) {
      excluded.push({
        sourceJobId: raw.id,
        source: "lever",
        reason: `Invalid timestamp: createdAt=${raw.createdAt}`,
        title: raw.text,
      });
      continue;
    }

    // Authoritative location: Lever job's location and workplaceType
    const loc = parseLocation(raw.categories?.location, {
      sourceCountry: raw.country,
      sourceWorkplaceType: raw.workplaceType,
    });
    const company = formatCompanyName(undefined, raw._companySlug);
    const role = classifyRoleDeterministically(raw.text);

    const description = [raw.description, raw.additional]
      .filter(Boolean)
      .join("\n");

    const ageMs = new Date(fetchedAt).getTime() - parsedTimestamp.getTime();
    const isWithin24Hours = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;

    const job: Job = {
      id: `lever::${raw.id}`,
      sourceJobId: raw.id,
      source: "lever",
      sourceUrl: raw.hostedUrl,
      applicationUrl: raw.hostedUrl,
      title: raw.text.trim(),
      company,
      description,
      city: loc.city,
      state: loc.state,
      country: loc.country,
      isRemote: loc.isRemote,
      workMode: loc.workMode,
      rawLocation: loc.rawLocation,
      publishedAt: parsedTimestamp.toISOString(),
      postedAt: parsedTimestamp.toISOString(),
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: "posted",
      isTimestampReliable: true,
      isWithin24Hours,
      fetchedAt,
      isFresherCandidate: false,
      role,
      dedupKey: makeDedupKey("lever", raw.id),
      crossDedupKey: makeCrossDedupKey(company, raw.text.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "created" };
}

// ─── Ashby Normalizer ────────────────────────────────────────────────────────

export function normalizeAshby(
  records: AshbyRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (!raw.id || raw.id.trim().length === 0) {
      excluded.push({
        sourceJobId: "unknown",
        source: "ashby",
        reason: "Missing job ID",
        title: raw.title,
      });
      continue;
    }

    if (!raw.title || raw.title.trim().length === 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "ashby",
        reason: "Missing or empty title",
      });
      continue;
    }

    if (!raw.jobUrl || raw.jobUrl.trim().length === 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "ashby",
        reason: "Missing application URL (jobUrl)",
        title: raw.title,
      });
      continue;
    }

    if (!raw.publishedAt || raw.publishedAt.trim().length === 0) {
      excluded.push({
        sourceJobId: raw.id,
        source: "ashby",
        reason: "Missing timestamp (publishedAt)",
        title: raw.title,
      });
      continue;
    }

    const parsedTimestamp = new Date(raw.publishedAt);
    if (isNaN(parsedTimestamp.getTime())) {
      excluded.push({
        sourceJobId: raw.id,
        source: "ashby",
        reason: `Invalid timestamp: "${raw.publishedAt}"`,
        title: raw.title,
      });
      continue;
    }

    // Authoritative location: Ashby job's location and isRemote
    const loc = parseLocation(raw.location, {
      sourceIsRemote: raw.isRemote,
    });
    const company = formatCompanyName(raw._company, raw._companySlug);
    const role = classifyRoleDeterministically(raw.title);

    const ageMs = new Date(fetchedAt).getTime() - parsedTimestamp.getTime();
    const isWithin24Hours = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;

    const job: Job = {
      id: `ashby::${raw.id}`,
      sourceJobId: raw.id,
      source: "ashby",
      sourceUrl: raw.jobUrl,
      applicationUrl: raw.jobUrl,
      title: raw.title.trim(),
      company,
      description: raw.descriptionHtml ?? raw.descriptionPlain ?? "",
      city: loc.city,
      state: loc.state,
      country: loc.country,
      isRemote: loc.isRemote,
      workMode: loc.workMode,
      rawLocation: loc.rawLocation,
      publishedAt: parsedTimestamp.toISOString(),
      postedAt: parsedTimestamp.toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : undefined,
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: "published",
      isTimestampReliable: true,
      isWithin24Hours,
      fetchedAt,
      isFresherCandidate: false,
      role,
      dedupKey: makeDedupKey("ashby", raw.id),
      crossDedupKey: makeCrossDedupKey(company, raw.title.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "published" };
}

// ─── SmartRecruiters Normalizer ──────────────────────────────────────────────

export function normalizeSmartRecruiters(
  records: SmartRecruitersRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (!raw.id) {
      excluded.push({
        sourceJobId: "unknown",
        source: "smartrecruiters",
        reason: "Missing job ID",
        title: raw.name,
      });
      continue;
    }
    const sourceJobId = String(raw.id);

    if (!raw.name || raw.name.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "smartrecruiters",
        reason: "Missing or empty title",
      });
      continue;
    }

    const applicationUrl =
      raw.applyUrl ||
      raw.postingUrl ||
      `https://jobs.smartrecruiters.com/${raw._companySlug}/${raw.id}`;
    const sourceUrl =
      raw.postingUrl ||
      `https://jobs.smartrecruiters.com/${raw._companySlug}/${raw.id}`;

    let publishedAt: string;
    if (raw.releasedDate && raw.releasedDate.trim().length > 0) {
      const parsed = new Date(raw.releasedDate);
      if (isNaN(parsed.getTime())) {
        publishedAt = fetchedAt;
      } else {
        publishedAt = parsed.toISOString();
      }
    } else {
      publishedAt = fetchedAt;
    }

    // Combine sections if available
    const descParts: string[] = [];
    if (raw.jobAd?.sections?.companyDescription?.text) {
      descParts.push(raw.jobAd.sections.companyDescription.text);
    }
    if (raw.jobAd?.sections?.jobDescription?.text) {
      descParts.push(raw.jobAd.sections.jobDescription.text);
    }
    if (raw.jobAd?.sections?.qualifications?.text) {
      descParts.push(raw.jobAd.sections.qualifications.text);
    }
    if (raw.jobAd?.sections?.additionalInformation?.text) {
      descParts.push(raw.jobAd.sections.additionalInformation.text);
    }
    const description = descParts.length > 0 ? descParts.join("\n\n") : raw.name;

    // Location parsing
    const rawLoc =
      raw.location?.fullLocation ||
      [raw.location?.city, raw.location?.region, raw.location?.country].filter(Boolean).join(", ");
    const loc = parseLocation(rawLoc, {
      sourceCountry: raw.location?.country,
      sourceIsRemote: Boolean(raw.location?.remote),
    });

    const isRemote = Boolean(raw.location?.remote);
    const isHybrid = Boolean(raw.location?.hybrid);
    const workMode: WorkMode = isRemote ? "remote" : isHybrid ? "hybrid" : "on-site";

    const parsedPub = new Date(publishedAt);
    const ageMs = new Date(fetchedAt).getTime() - parsedPub.getTime();
    const isWithin24Hours = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;

    const companyName = raw.company?.name || formatCompanyName(raw._companySlug);
    const role = classifyRoleDeterministically(raw.name);

    let jobType: "full-time" | "part-time" | "internship" | "contract" | "freelance" | "unknown" = "full-time";
    const empTypeLabel = (raw.typeOfEmployment?.label || raw.typeOfEmployment?.id || "").toLowerCase();
    if (empTypeLabel.includes("intern")) {
      jobType = "internship";
    } else if (empTypeLabel.includes("part")) {
      jobType = "part-time";
    } else if (empTypeLabel.includes("contract") || empTypeLabel.includes("temp")) {
      jobType = "contract";
    }

    const job: Job = {
      id: `smartrecruiters::${sourceJobId}`,
      sourceJobId,
      source: "smartrecruiters",
      sourceUrl,
      applicationUrl,
      title: raw.name.trim(),
      company: companyName,
      description,
      city: loc.city || (loc.country === "India" ? "Bengaluru" : "Unknown"),
      state: loc.state,
      country: loc.country,
      isRemote,
      workMode,
      rawLocation: rawLoc || "Unknown",
      publishedAt,
      postedAt: publishedAt,
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: "posted",
      isTimestampReliable: true,
      isWithin24Hours,
      fetchedAt,
      isFresherCandidate: false,
      role,
      jobType,
      dedupKey: makeDedupKey("smartrecruiters", sourceJobId),
      crossDedupKey: makeCrossDedupKey(companyName, raw.name.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "posted" };
}

// ─── Recruitee Normalizer ────────────────────────────────────────────────────

export function normalizeRecruitee(
  records: RecruiteeRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (raw.id == null) {
      excluded.push({
        sourceJobId: "unknown",
        source: "recruitee",
        reason: "Missing job ID",
        title: raw.title,
      });
      continue;
    }
    const sourceJobId = String(raw.id);

    if (!raw.title || raw.title.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "recruitee",
        reason: "Missing or empty title",
      });
      continue;
    }

    const applicationUrl =
      raw.careers_apply_url ||
      raw.careers_url ||
      `https://${raw._companySlug}.recruitee.com/o/${raw.id}`;
    const sourceUrl =
      raw.careers_url ||
      `https://${raw._companySlug}.recruitee.com/o/${raw.id}`;

    let publishedAt = fetchedAt;
    const dateStr = raw.published_at || raw.updated_at;
    if (dateStr && dateStr.trim().length > 0) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        publishedAt = parsed.toISOString();
      }
    }

    const rawLoc =
      raw.location ||
      [raw.city, raw.state_name, raw.country].filter(Boolean).join(", ");
    const loc = parseLocation(rawLoc, {
      sourceCountry: raw.country,
      sourceIsRemote: Boolean(raw.remote),
    });

    const isRemote = Boolean(raw.remote);
    const isHybrid = !isRemote && !raw.on_site;
    const workMode: WorkMode = isRemote ? "remote" : isHybrid ? "hybrid" : "on-site";

    const parsedPub = new Date(publishedAt);
    const ageMs = new Date(fetchedAt).getTime() - parsedPub.getTime();
    const isWithin24Hours = ageMs >= 0 && ageMs <= 24 * 60 * 60 * 1000;

    const companyName = raw._company || formatCompanyName(raw._companySlug);
    const description = [raw.description || "", raw.requirements || ""].filter(Boolean).join("\n\n") || raw.title;
    const role = classifyRoleDeterministically(raw.title);

    let jobType: "full-time" | "part-time" | "internship" | "contract" | "freelance" | "unknown" = "full-time";
    if (/\b(intern|internship|co-?op)\b/i.test(raw.title)) {
      jobType = "internship";
    }

    const job: Job = {
      id: `recruitee::${sourceJobId}`,
      sourceJobId,
      source: "recruitee",
      sourceUrl,
      applicationUrl,
      title: raw.title.trim(),
      company: companyName,
      description,
      city: loc.city || (loc.country === "India" ? "Bengaluru" : "Unknown"),
      state: loc.state,
      country: loc.country,
      isRemote,
      workMode,
      rawLocation: rawLoc || "Unknown",
      publishedAt,
      postedAt: publishedAt,
      updatedAt: raw.updated_at ? new Date(raw.updated_at).toISOString() : undefined,
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: raw.published_at ? "published" : "updated",
      isTimestampReliable: true,
      isWithin24Hours,
      fetchedAt,
      isFresherCandidate: false,
      role,
      jobType,
      dedupKey: makeDedupKey("recruitee", sourceJobId),
      crossDedupKey: makeCrossDedupKey(companyName, raw.title.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "published" };
}

// ─── Pinpoint Normalizer ─────────────────────────────────────────────────────

export function normalizePinpoint(
  records: PinpointRawJob[],
  fetchedAt: string
): NormalizationResult {
  const jobs: Job[] = [];
  const excluded: NormalizationExclusion[] = [];

  for (const raw of records) {
    if (!raw.id) {
      excluded.push({
        sourceJobId: "unknown",
        source: "pinpoint",
        reason: "Missing job ID",
        title: raw.title,
      });
      continue;
    }
    const sourceJobId = String(raw.id);

    if (!raw.title || raw.title.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "pinpoint",
        reason: "Missing or empty title",
      });
      continue;
    }

    if (!raw.url || raw.url.trim().length === 0) {
      excluded.push({
        sourceJobId,
        source: "pinpoint",
        reason: "Missing application URL (url)",
        title: raw.title,
      });
      continue;
    }

    const applicationUrl = raw.url;
    const sourceUrl = raw.url;
    const publishedAt = fetchedAt; // Active listings on live board

    const rawLoc =
      raw.location?.name ||
      [raw.location?.city, raw.location?.province].filter(Boolean).join(", ");
    const loc = parseLocation(rawLoc, {
      sourceIsRemote: raw.workplace_type === "remote",
    });

    const isRemote = raw.workplace_type === "remote";
    const isHybrid = raw.workplace_type === "hybrid";
    const workMode: WorkMode = isRemote ? "remote" : isHybrid ? "hybrid" : "on-site";

    const companyName = raw._company || formatCompanyName(raw._companySlug);
    const description =
      [
        raw.description || "",
        raw.key_responsibilities || "",
        raw.skills_knowledge_expertise || "",
      ]
        .filter(Boolean)
        .join("\n\n") || raw.title;

    const role = classifyRoleDeterministically(raw.title);

    let jobType: "full-time" | "part-time" | "internship" | "contract" | "freelance" | "unknown" = "full-time";
    const empType = (raw.employment_type_text || raw.employment_type || "").toLowerCase();
    if (empType.includes("intern") || /\b(intern|internship|co-?op)\b/i.test(raw.title)) {
      jobType = "internship";
    } else if (empType.includes("part")) {
      jobType = "part-time";
    } else if (empType.includes("contract")) {
      jobType = "contract";
    }

    const job: Job = {
      id: `pinpoint::${sourceJobId}`,
      sourceJobId,
      source: "pinpoint",
      sourceUrl,
      applicationUrl,
      title: raw.title.trim(),
      company: companyName,
      description,
      city: loc.city || (loc.country === "India" ? "Bengaluru" : "Unknown"),
      state: loc.state,
      country: loc.country,
      isRemote,
      workMode,
      rawLocation: rawLoc || "Unknown",
      publishedAt,
      postedAt: publishedAt,
      lastSeenAt: fetchedAt,
      lastSyncedAt: fetchedAt,
      sourceStatus: "active",
      classificationStatus: "llm_not_run",
      timestampKind: "published",
      isTimestampReliable: true,
      isWithin24Hours: true, // Currently active on feed
      fetchedAt,
      isFresherCandidate: false,
      role,
      jobType,
      dedupKey: makeDedupKey("pinpoint", sourceJobId),
      crossDedupKey: makeCrossDedupKey(companyName, raw.title.trim(), loc.city),
      isActive: true,
    };

    jobs.push(job);
  }

  return { jobs, excluded, timestampKind: "published" };
}
