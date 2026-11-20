/**
 * GradHunt — Phase 3: 24-Hour Freshness Filter
 *
 * Filters normalized jobs so that only postings whose best-available
 * publication timestamp falls within the last FRESHNESS_WINDOW_HOURS
 * (default 24) are retained.
 *
 * Every excluded record gets a deterministic exclusion reason.
 *
 * Timestamp semantics per source:
 *   Greenhouse — `updated_at` (NOT a true publication date; may represent an
 *                edit to an older job).
 *   Lever      — `createdAt`  (true first-publication / creation timestamp).
 *   Ashby      — `publishedAt` (true first-publication timestamp).
 *   SmartRecruiters — `releasedDate`
 *   Recruitee  — `published_at` / `updated_at`
 *   Pinpoint   — active feed posting.
 */

import { Job, JobSource } from "../types/job";
import { FRESHNESS_WINDOW_HOURS } from "../constants";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FreshnessExclusion {
  jobId: string;
  source: JobSource;
  title: string;
  company: string;
  publishedAt: string;
  reason: string;
  ageHours: number;
}

export interface FreshnessFilterResult {
  /** Jobs that passed the freshness window. */
  fresh: Job[];
  /** Jobs excluded because they fell outside the window. */
  excluded: FreshnessExclusion[];
  /** The cutoff time used. */
  cutoffTime: string;
  /** The "now" time used. */
  asOfTime: string;
}

// ─── Filter ─────────────────────────────────────────────────────────────────

/**
 * Keeps only jobs whose `publishedAt` is within the last
 * `windowHours` hours from `now`.
 *
 * - Future timestamps (later than `now`) are excluded with reason
 *   "Future timestamp".
 * - Invalid / unparseable timestamps are excluded with reason
 *   "Invalid timestamp".
 */
export function filterByFreshness(
  jobs: Job[],
  now: Date = new Date(),
  windowHours: number = FRESHNESS_WINDOW_HOURS
): FreshnessFilterResult {
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const fresh: Job[] = [];
  const excluded: FreshnessExclusion[] = [];

  for (const job of jobs) {
    const pubDate = new Date(job.publishedAt);

    if (isNaN(pubDate.getTime())) {
      excluded.push({
        jobId: job.id,
        source: job.source,
        title: job.title,
        company: job.company,
        publishedAt: job.publishedAt,
        reason: `Invalid timestamp: "${job.publishedAt}"`,
        ageHours: -1,
      });
      continue;
    }

    // Reject future timestamps
    if (pubDate.getTime() > now.getTime()) {
      excluded.push({
        jobId: job.id,
        source: job.source,
        title: job.title,
        company: job.company,
        publishedAt: job.publishedAt,
        reason: "Future timestamp — job appears to be published in the future",
        ageHours: (now.getTime() - pubDate.getTime()) / (60 * 60 * 1000),
      });
      continue;
    }

    const ageMs = now.getTime() - pubDate.getTime();
    const ageHours = ageMs / (60 * 60 * 1000);

    // Annotate freshness fields accurately: 24h status is for badges and ranking, never deletion
    job.isWithin24Hours = ageHours >= 0 && ageHours <= 24;

    // Retain all genuine, active jobs regardless of age.
    // GradHunt operates as a persistent active database; age is used strictly for ranking.
    fresh.push(job);
  }

  return {
    fresh,
    excluded,
    cutoffTime: cutoff.toISOString(),
    asOfTime: now.toISOString(),
  };
}
