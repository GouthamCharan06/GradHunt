/**
 * GradHunt — Canonical Job Schema
 *
 * Every job from every source is normalized into this shape before it enters
 * the pipeline.  Fields marked "set by classifier" are populated by the
 * LangChain + Hugging Face classification step in Phase 5; until then they
 * remain `undefined`.
 */

// ─── Enums & Taxonomies ─────────────────────────────────────────────────────

/** The approved real-data sources (strictly 6 public ATS providers). */
export type JobSource =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "recruitee"
  | "pinpoint";

/** Predefined role taxonomy used for AI classification. */
export const ROLE_TAXONOMY = [
  "Software Engineering",
  "Data & AI",
  "DevOps & Cloud",
  "Cybersecurity",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Finance",
  "HR",
  "Operations",
  "Customer Support",
  "Research",
  "Other",
  // Granular sub-roles
  "Frontend Development",
  "Backend Development",
  "Full-Stack Development",
  "Mobile Development",
  "DevOps / SRE",
  "Data Science / ML / AI",
  "Data Engineering",
  "Data Analytics",
  "Cloud Engineering",
  "QA / Testing",
  "Product Management",
  "Design (UI/UX)",
  "Technical Writing",
  "IT / System Administration",
  "Business / Operations",
  "Marketing / Growth",
  "Sales / Business Development",
  "Human Resources",
  "Finance / Accounting",
  "Legal / Compliance",
  "Hardware / Embedded",
] as const;

export type RoleCategory = (typeof ROLE_TAXONOMY)[number];

/** Experience-level labels. */
export type ExperienceLevel =
  | "intern"
  | "entry"
  | "junior"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "unknown";

/** Job type (employment kind). */
export type JobType =
  | "full-time"
  | "part-time"
  | "internship"
  | "contract"
  | "freelance"
  | "unknown";

/** Work mode / workplace type (independent from city/country). */
export type WorkMode = "remote" | "hybrid" | "on-site" | "unknown";

// ─── Canonical Job Interface ────────────────────────────────────────────────

export interface Job {
  // ── Identity ──────────────────────────────────────────────────────────
  /** Internal GradHunt ID (deterministic: `${source}::${sourceJobId}`). */
  id: string;

  /** The original job ID as returned by the source API. */
  sourceJobId: string;

  /** Which approved source this job came from. */
  source: JobSource;

  /** Permanent URL to view the full posting on the source site. */
  sourceUrl: string;

  /** Direct URL to apply for this job — MUST be the real source URL.
   *  NEVER fabricated, constructed, or guessed. */
  applicationUrl: string;

  // ── Core Fields ───────────────────────────────────────────────────────
  /** Job title exactly as returned by the source. */
  title: string;

  /** Company / organization name. */
  company: string;

  /** Full job description (HTML or plain text as supplied by source). */
  description: string;

  // ── Location ──────────────────────────────────────────────────────────
  /** City name, normalized to title case (e.g. "Bengaluru", "Mumbai").
   *  "Flexible" if country-wide / not tied to a specific city.
   *  NEVER "Remote" — workMode handles that independently. */
  city: string;

  /** State / region, if available. */
  state?: string;

  /** Country name or ISO code. Guaranteed to be "India" for GradHunt. */
  country: string;

  /** Whether the position is explicitly remote. */
  isRemote: boolean;

  /** Work mode: "remote" | "hybrid" | "on-site" | "unknown". */
  workMode: WorkMode;

  /** Original raw location string from the source API for authentic display. */
  rawLocation: string;

  // ── Timestamps ────────────────────────────────────────────────────────
  /** When the job was first published/created, as ISO-8601 string (if provided by source). */
  postedAt?: string;

  /** When the job was last updated, as ISO-8601 string (if provided by source). */
  updatedAt?: string;

  /** When this listing was last seen active on the source ATS during a refresh run. */
  lastSeenAt?: string;

  /** When this listing was last synchronized/evaluated by the pipeline. */
  lastSyncedAt?: string;

  /** Availability status on the source ATS. */
  sourceStatus?: "active" | "closed" | "unverified";

  /** Which kind of timestamp the source provided ("posted", "updated", "published", "unknown"). */
  timestampKind?: "posted" | "updated" | "published" | "unknown";

  /** Whether the source timestamp is verified and reliable. */
  isTimestampReliable?: boolean;

  /** Whether this job was posted/updated within the last 24 hours. */
  isWithin24Hours?: boolean;

  /** Canonical publication timestamp used for primary sorting, as ISO-8601 string. */
  publishedAt: string;

  /** When GradHunt first fetched / processed this job, as ISO-8601 string. */
  fetchedAt: string;

  // ── Deterministic Candidate Signals ───────────────────────────────────
  /** `true` if cheap title/description heuristics flag this as a likely
   *  fresher or intern role. Set during the candidate-filtering step. */
  isFresherCandidate: boolean;

  /** Detected experience category ("0-1", "0-2", "0-3", "internship", "unknown"). */
  experienceRange?: "0-1" | "0-2" | "0-3" | "internship" | "experienced" | "unknown";

  // ── AI-Classified Fields (set by classifier — Phase 5/6) ─────────────
  /** Classified role from the ROLE_TAXONOMY or semantically normalized. */
  role?: RoleCategory;

  /** Semantically normalized title/role (e.g. "Software Engineer" for "SDE-1", "SWE I"). */
  normalized_role?: string;

  /** High-level role cluster from controlled taxonomy. */
  role_cluster?: string;

  /** Classified job type. */
  jobType?: JobType;

  /** Classified experience level. */
  experienceLevel?: ExperienceLevel;

  /** Minimum years of experience parsed or classified. */
  experience_min_years?: number | null;

  /** Maximum years of experience parsed or classified. */
  experience_max_years?: number | null;

  /** Whether the role is suitable for fresher/entry-level candidates. */
  is_fresher_relevant?: boolean;

  /** Whether the role is an internship. */
  is_internship?: boolean;

  /** Whether the classifier deems this genuinely suitable for freshers. */
  isFresherEligible?: boolean;

  /** Relevance score for freshers/students (0–100). */
  relevanceScore?: number;

  /** Explanation of why this job scored as it did. */
  relevanceExplanation?: string;

  /** Concise 1-2 sentence reasoning summary for logs/auditing. */
  reasoning_summary?: string;

  /** Status of LLM classification for this listing. */
  classificationStatus?: "llm_success" | "llm_cached" | "llm_failed" | "llm_not_run";

  /** Error message if LLM classification failed. */
  llmError?: string;

  /** Key extracted skills or technologies (e.g. ["Python", "React", "SQL"]). */
  skills?: string[];

  /** Confidence levels for semantic classifications. */
  confidence?: {
    role?: "high" | "medium" | "low";
    city?: "high" | "medium" | "low";
    work_mode?: "high" | "medium" | "low";
  };

  /** Classifier-refined city (may fix casing, abbreviations, etc.). */
  classifiedCity?: string;

  /** Classifier-refined country. */
  classifiedCountry?: string;

  // ── Pipeline Metadata ─────────────────────────────────────────────────
  /** SHA-256 of `source + sourceJobId` — used for fast dedup lookups. */
  dedupKey: string;

  /** Normalized `company|title|city` — used for cross-source dedup. */
  crossDedupKey: string;

  /** Whether this job survived all pipeline steps and is ready to serve. */
  isActive: boolean;

  /** ISO-8601 timestamp of the last classification run for this job. */
  classifiedAt?: string;
}

// ─── Refresh Run & Observability Types ─────────────────────────────────────

export interface ProviderResult {
  source: JobSource;
  status: "success" | "error" | "skipped";
  fetchedCount: number;
  durationMs: number;
  error?: string;
}

export interface FreshnessDistribution {
  "0-7d": number;
  "8-30d": number;
  "31-60d": number;
  "61-90d": number;
  "90d+": number;
  oldestPostingDate: string | null;
  newestPostingDate: string | null;
}

export interface RefreshRunRecord {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  status: "running" | "completed" | "failed";
  trigger: "manual" | "cron" | "startup" | "interval_24h";
  providerResults: Record<JobSource, ProviderResult>;
  counts: {
    rawFetched: number;
    normalized: number;
    indiaEligible: number;
    hardRejected: number;
    duplicatesRemoved: number;
    newlyAdded: number;
    updated: number;
    retainedUnchanged: number;
    removedUnavailable: number;
    staleHidden: number;
    totalActive: number;
  };
  llm: {
    candidates: number;
    invoked: number;
    succeeded: number;
    failed: number;
    cached: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
  freshnessDistribution: FreshnessDistribution;
  error?: string;
}

// ─── Source-Adapter Return Type ─────────────────────────────────────────────

/** What each source adapter must return. */
export interface SourceFetchResult {
  source: JobSource;
  jobs: Job[];
  fetchedAt: string;
  errors: SourceError[];
  /** How long the fetch took, in milliseconds. */
  durationMs: number;
}

export interface SourceError {
  source: JobSource;
  message: string;
  code?: string;
  statusCode?: number;
  timestamp: string;
}

// ─── Pipeline State ─────────────────────────────────────────────────────────

export interface PipelineResult {
  /** All jobs that passed every pipeline stage. */
  jobs: Job[];

  /** Per-source fetch metadata. */
  sourceResults: SourceFetchResult[];

  /** Aggregate pipeline stats. */
  stats: PipelineStats;

  /** When the pipeline last completed successfully. */
  lastRefreshedAt: string;
}

export interface PipelineStats {
  totalFetched: number;
  afterFreshnessFilter: number;
  afterCandidateFilter: number;
  afterDedup: number;
  afterClassification: number;
  errors: SourceError[];
  durationMs: number;
}
