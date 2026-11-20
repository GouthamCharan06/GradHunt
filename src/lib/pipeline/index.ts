/**
 * GradHunt — Complete Job Ingestion & Tagging Pipeline
 *
 * Runs the end-to-end pipeline:
 *   raw fetch → normalize → India-only filter → candidate eligibility filter
 *   → freshness window filter → deduplication → LLM classification/tagging
 *
 * Enforces:
 *   1. Deterministic normalization into canonical Job schema
 *   2. Strict India-only opportunities enforcement using job's own location
 *   3. Separation of freshness and experience eligibility
 *   4. Deterministic candidate heuristics (disqualifying senior/experienced roles)
 *   5. Deduplication across exact source IDs and cross-source postings
 *   6. Controlled LLM tagging for role, city, and workMode with stable caching
 *
 * Exposes detailed stage-by-stage counts for full transparency and zero mock data.
 */

import { Job, JobSource, WorkMode } from "../types/job";
import { AllSourcesResult } from "../adapters";
import {
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  normalizeSmartRecruiters,
  normalizeRecruitee,
  normalizePinpoint,
  NormalizationExclusion,
} from "./normalize";
import { filterByFreshness, FreshnessExclusion } from "./freshness";
import { filterFresherCandidates, CandidateSignal } from "./candidate-filter";
import { deduplicateJobs } from "./dedup";
import { classifyJobsBatch } from "../classification";
import { GeminiUsageMetrics } from "../classification/types";
import { FRESHNESS_WINDOW_HOURS } from "../constants";

// ─── Pipeline Result Types ──────────────────────────────────────────────────

export interface Phase3PipelineResult {
  /** Eligible fresher/intern candidate jobs in India within the freshness window (deduplicated & tagged). */
  fresherCandidates: Job[];
  /** Alias for backward compatibility with store callers expecting all fresh eligible opportunities. */
  allNormalizedFresh: Job[];
  /** Jobs not qualifying as fresher/intern opportunities (disqualified experienced/senior roles). */
  nonCandidates: Job[];

  /** Stage-by-stage counts. */
  counts: Phase3Counts;

  /** Per-source breakdowns. */
  perSource: Record<string, Phase3SourceCounts>;

  /** India-specific metrics. */
  indiaMetrics: {
    rawRecords: number;
    outsideIndiaExcluded: number;
    validIndianRecords: number;
    indianRemoteRecords: number;
    uniqueCountries: string[];
    uniqueCities: string[];
    workModeCounts: Record<WorkMode, number>;
    finalAvailableOpportunities: number;
  };

  /** Deduplication metrics. */
  dedupMetrics: {
    duplicatesRemoved: number;
  };

  /** LLM Tagging metrics. */
  llmMetrics: {
    total: number;
    cached: number;
    llm: number;
    deterministicFallback: number;
    failed: number;
    durationMs: number;
  };

  /** Gemini usage and cost metrics. */
  usage?: GeminiUsageMetrics;

  /** Diagnostic details. */
  diagnostics: Phase3Diagnostics;

  durationMs: number;
}

export interface Phase3Counts {
  rawTotal: number;
  normalizedTotal: number;
  normalizationExcluded: number;
  outsideIndiaExcluded: number;
  validIndianTotal: number;
  freshTotal: number;
  freshnessExcluded: number;
  within24HoursTotal: number;
  fresherCandidates: number;
  internshipsTotal: number;
  entryLevel0to3Total: number;
  nonCandidates: number;
  duplicatesRemoved: number;
  finalActiveOpportunities: number;
}

export interface Phase3SourceCounts {
  raw: number;
  normalized: number;
  excludedNormalization: number;
  outsideIndiaExcluded: number;
  validIndian: number;
  within24Hours: number;
  recent: number;
  internships: number;
  entryLevel0to3: number;
  fresherCandidates: number;
  nonCandidates: number;
  fresh: number;
  freshnessExcluded: number;
  staleExcluded: number;
  duplicatesRemoved: number;
  finalEligible: number;
  timestampKind: string;
  allHaveApplicationUrl: boolean;
}

export interface IndiaExclusion {
  jobId: string;
  source: JobSource;
  title: string;
  company: string;
  country: string;
  rawLocation: string;
  reason: string;
}

export interface Phase3Diagnostics {
  normalizationExclusions: NormalizationExclusion[];
  indiaExclusions: {
    total: number;
    sample: IndiaExclusion[];
  };
  freshnessExclusions: {
    total: number;
    sampleOldest: FreshnessExclusion[];
    sampleNewest: FreshnessExclusion[];
  };
  candidateSignals: {
    total: number;
    samples: CandidateSignal[];
  };
  freshnessWindow: {
    cutoffTime: string;
    asOfTime: string;
    windowHours: number;
  };
}

// ─── Pipeline Execution ────────────────────────────────────────────────────

export async function runPhase3Pipeline(
  sourceResult: AllSourcesResult,
  now: Date = new Date(),
  onProgress?: (progressText: string) => void
): Promise<Phase3PipelineResult> {
  const startTime = Date.now();
  const fetchedAt = now.toISOString();

  // ── Stage 1: Normalization ──────────────────────────────────────────
  const ghNorm = normalizeGreenhouse(sourceResult.greenhouse.records, fetchedAt);
  const lvNorm = normalizeLever(sourceResult.lever.records, fetchedAt);
  const abNorm = normalizeAshby(sourceResult.ashby.records, fetchedAt);
  const srNorm = normalizeSmartRecruiters(sourceResult.smartrecruiters.records, fetchedAt);
  const rcNorm = normalizeRecruitee(sourceResult.recruitee.records, fetchedAt);
  const ppNorm = normalizePinpoint(sourceResult.pinpoint.records, fetchedAt);

  const allNormalized = [
    ...ghNorm.jobs,
    ...lvNorm.jobs,
    ...abNorm.jobs,
    ...srNorm.jobs,
    ...rcNorm.jobs,
    ...ppNorm.jobs,
  ];

  const allNormExclusions = [
    ...ghNorm.excluded,
    ...lvNorm.excluded,
    ...abNorm.excluded,
    ...srNorm.excluded,
    ...rcNorm.excluded,
    ...ppNorm.excluded,
  ];

  console.log(
    `[Pipeline] Stage 1 (Normalization): ${allNormalized.length} jobs normalized, ` +
      `${allNormExclusions.length} excluded for missing/invalid data`
  );

  // ── Stage 2: Strict India-Only Filter ────────────────────────────────
  // Enforce at the processing layer: only opportunities with source-verified India presence.
  const indiaJobs: Job[] = [];
  const indiaExclusions: IndiaExclusion[] = [];
  let indianRemoteCount = 0;

  for (const job of allNormalized) {
    if (job.country === "India") {
      indiaJobs.push(job);
      if (job.workMode === "remote" || job.isRemote) {
        indianRemoteCount++;
      }
    } else {
      indiaExclusions.push({
        jobId: job.id,
        source: job.source,
        title: job.title,
        company: job.company,
        country: job.country,
        rawLocation: job.rawLocation,
        reason: `Non-India location excluded: country='${job.country}', location='${job.rawLocation}'`,
      });
    }
  }

  console.log(
    `[Pipeline] Stage 2 (India Filter): ${indiaJobs.length} Indian opportunities retained ` +
      `(${indianRemoteCount} remote in India), ${indiaExclusions.length} non-India excluded`
  );

  // ── Stage 3: Fresher / Intern Candidate Filter (Hard Safety Filter Only) ──
  // Removes clearly senior/lead/manager roles and >=5y requirements.
  // Preserves hundreds of viable India tech/entry roles for Gemini semantic classification.
  const candidateResult = filterFresherCandidates(indiaJobs);

  console.log(
    `[Pipeline] Stage 3 (Candidate Filter): ${candidateResult.candidates.length} viable India candidates retained for LLM, ` +
      `${candidateResult.nonCandidates.length} clearly senior/experienced excluded`
  );

  // ── Stage 4: Freshness Filter (Preserve all active, flag <24h) ───────
  const freshnessResult = filterByFreshness(candidateResult.candidates, now, FRESHNESS_WINDOW_HOURS);

  console.log(
    `[Pipeline] Stage 4 (Freshness Filter): ${freshnessResult.fresh.length} candidate jobs in active pool, ` +
      `${freshnessResult.excluded.length} older than window`
  );

  // ── Stage 5: Deduplication ───────────────────────────────────────────
  // Deduplicates exact source IDs and cross-source identical postings.
  const dedupResult = deduplicateJobs(freshnessResult.fresh);

  console.log(
    `[Pipeline] Stage 5 (Deduplication): ${dedupResult.deduplicated.length} unique opportunities retained, ` +
      `${dedupResult.duplicatesRemoved} duplicates removed`
  );

  // ── Stage 6: LLM Semantic Tagging Layer ─────────────────────────────
  // Gemini semantically analyzes every candidate job, normalizes roles,
  // determines true fresher relevance, extracts skills, and scores relevance.
  const classificationResult = await classifyJobsBatch(dedupResult.deduplicated, 5, onProgress);

  // Filter to jobs verified as fresher-relevant or internships
  const finalEligibleJobs = classificationResult.classifiedJobs.filter((j) => j.isFresherEligible);
  const finalNonEligibleJobs = classificationResult.classifiedJobs.filter((j) => !j.isFresherEligible);

  console.log(
    `[Pipeline] Stage 6 (LLM Semantic Tagging): ${finalEligibleJobs.length} fresher/intern jobs qualified ` +
      `(${finalNonEligibleJobs.length} non-fresher excluded by LLM, ` +
      `${classificationResult.metrics.cached} cached, ` +
      `${classificationResult.metrics.llm} LLM invoked, ` +
      `${classificationResult.metrics.failed} LLM failed, ` +
      `${classificationResult.metrics.durationMs}ms)`
  );

  const finalJobs = finalEligibleJobs;

  // ── Aggregate India Metrics ──────────────────────────────────────────
  const uniqueCountries = Array.from(new Set(finalJobs.map((j) => j.country)));
  const uniqueCities = Array.from(new Set(finalJobs.map((j) => j.city).filter(Boolean))).sort();

  const workModeCounts: Record<WorkMode, number> = {
    remote: 0,
    hybrid: 0,
    "on-site": 0,
    unknown: 0,
  };

  for (const job of finalJobs) {
    if (job.workMode in workModeCounts) {
      workModeCounts[job.workMode]++;
    } else {
      workModeCounts.unknown++;
    }
  }

  // ── Per-Source Metrics Helper ────────────────────────────────────────
  function sourceCountsFor(
    source: JobSource,
    rawCount: number,
    normResult: { jobs: Job[]; excluded: NormalizationExclusion[]; timestampKind: string }
  ): Phase3SourceCounts {
    const normForSource = normResult.jobs;
    const indiaForSource = indiaJobs.filter((j) => j.source === source);
    const outsideForSource = indiaExclusions.filter((e) => e.source === source);
    const candForSource = candidateResult.candidates.filter((j) => j.source === source);
    const nonCandForSource = candidateResult.nonCandidates.filter((j) => j.source === source);
    const freshForSource = freshnessResult.fresh.filter((j) => j.source === source);
    const freshExclForSource = freshnessResult.excluded.filter((e) => e.source === source);
    const finalForSource = finalJobs.filter((j) => j.source === source);
    const dupsRemoved = Math.max(0, freshForSource.length - finalForSource.length);

    const internCount = finalForSource.filter((j) => j.jobType === "internship").length;
    const entry0to3Count = finalForSource.filter((j) => j.jobType !== "internship").length;
    const within24hCount = finalForSource.filter((j) => j.isWithin24Hours).length;

    return {
      raw: rawCount,
      normalized: normForSource.length,
      excludedNormalization: normResult.excluded.length,
      outsideIndiaExcluded: outsideForSource.length,
      validIndian: indiaForSource.length,
      within24Hours: within24hCount,
      recent: freshForSource.length,
      internships: internCount,
      entryLevel0to3: entry0to3Count,
      fresherCandidates: candForSource.length,
      nonCandidates: nonCandForSource.length,
      fresh: freshForSource.length,
      freshnessExcluded: freshExclForSource.length,
      staleExcluded: freshExclForSource.length,
      duplicatesRemoved: dupsRemoved,
      finalEligible: finalForSource.length,
      timestampKind: normResult.timestampKind,
      allHaveApplicationUrl: normForSource.every(
        (j) => j.applicationUrl && j.applicationUrl.length > 0
      ),
    };
  }

  const perSource: Record<string, Phase3SourceCounts> = {
    greenhouse: sourceCountsFor("greenhouse", sourceResult.greenhouse.records.length, ghNorm),
    lever: sourceCountsFor("lever", sourceResult.lever.records.length, lvNorm),
    ashby: sourceCountsFor("ashby", sourceResult.ashby.records.length, abNorm),
    smartrecruiters: sourceCountsFor("smartrecruiters", sourceResult.smartrecruiters.records.length, srNorm),
    recruitee: sourceCountsFor("recruitee", sourceResult.recruitee.records.length, rcNorm),
    pinpoint: sourceCountsFor("pinpoint", sourceResult.pinpoint.records.length, ppNorm),
  };

  const counts: Phase3Counts = {
    rawTotal: allNormalized.length + allNormExclusions.length,
    normalizedTotal: allNormalized.length,
    normalizationExcluded: allNormExclusions.length,
    outsideIndiaExcluded: indiaExclusions.length,
    validIndianTotal: indiaJobs.length,
    freshTotal: freshnessResult.fresh.length,
    freshnessExcluded: freshnessResult.excluded.length,
    within24HoursTotal: finalJobs.filter((j) => j.isWithin24Hours).length,
    fresherCandidates: finalJobs.length,
    internshipsTotal: finalJobs.filter((j) => j.jobType === "internship").length,
    entryLevel0to3Total: finalJobs.filter((j) => j.jobType !== "internship").length,
    nonCandidates: candidateResult.nonCandidates.length + finalNonEligibleJobs.length,
    duplicatesRemoved: dedupResult.duplicatesRemoved,
    finalActiveOpportunities: finalJobs.length,
  };

  const diagnostics: Phase3Diagnostics = {
    normalizationExclusions: allNormExclusions,
    indiaExclusions: {
      total: indiaExclusions.length,
      sample: indiaExclusions.slice(0, 10),
    },
    freshnessExclusions: {
      total: freshnessResult.excluded.length,
      sampleOldest: freshnessResult.excluded.slice(0, 5),
      sampleNewest: freshnessResult.excluded.slice(-5),
    },
    candidateSignals: {
      total: candidateResult.signals.length,
      samples: candidateResult.signals.slice(0, 20),
    },
    freshnessWindow: {
      cutoffTime: freshnessResult.cutoffTime,
      asOfTime: freshnessResult.asOfTime,
      windowHours: FRESHNESS_WINDOW_HOURS,
    },
  };

  return {
    fresherCandidates: finalJobs,
    allNormalizedFresh: finalJobs, // Target audience eligible only!
    nonCandidates: candidateResult.nonCandidates,
    counts,
    perSource,
    indiaMetrics: {
      rawRecords: allNormalized.length + allNormExclusions.length,
      outsideIndiaExcluded: indiaExclusions.length,
      validIndianRecords: indiaJobs.length,
      indianRemoteRecords: indianRemoteCount,
      uniqueCountries,
      uniqueCities,
      workModeCounts,
      finalAvailableOpportunities: finalJobs.length,
    },
    dedupMetrics: {
      duplicatesRemoved: dedupResult.duplicatesRemoved,
    },
    llmMetrics: classificationResult.metrics,
    usage: classificationResult.usage,
    diagnostics,
    durationMs: Date.now() - startTime,
  };
}
