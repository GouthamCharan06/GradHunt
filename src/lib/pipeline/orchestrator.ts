/**
 * GradHunt — Core Refresh Orchestrator
 *
 * Runs the end-to-end ingestion, normalization, filtering, Gemini classification,
 * and database persistence pipeline.
 *
 * Provides:
 * - Singleton execution lock so concurrent calls don't double-invoke
 * - Real RefreshRunRecord tracking with exact metrics
 * - Observable [SYNC] and [LLM] logging
 * - Asynchronous background trigger capability
 */

import { fetchAllSources, AllSourcesResult } from "../adapters";
import { runPhase3Pipeline, Phase3PipelineResult } from "./index";
import {
  ingestPersistentJobs,
  recordRefreshRun,
  setStoreRefreshing,
  setStoreError,
  computeFreshnessDistribution,
  getStoreStatus,
  jobStore,
  PersistentIngestStats,
} from "../store";
import { clearClassificationCache } from "../classification/cache";
import { RefreshRunRecord, ProviderResult, JobSource } from "../types/job";

let inFlightRefreshPromise: Promise<RefreshExecutionResult> | null = null;

export interface RefreshExecutionResult {
  success: boolean;
  message: string;
  runRecord: RefreshRunRecord;
  persistentStats: PersistentIngestStats;
  pipeline: Phase3PipelineResult;
  totalDurationMs: number;
}

export async function executeFullRefresh(
  trigger: "manual" | "cron" | "startup" = "manual",
  options: { clearCache?: boolean } = {}
): Promise<RefreshExecutionResult> {
  // If a refresh is already in-flight, return the shared promise so we don't race
  if (inFlightRefreshPromise) {
    console.log(`[SYNC] Refresh already in progress (triggered by ${trigger}), attaching to active run`);
    return inFlightRefreshPromise;
  }

  const startTime = Date.now();
  const startedAtIso = new Date(startTime).toISOString();
  const runId = `ref_${startTime}`;

  inFlightRefreshPromise = (async () => {
    try {
      if (options.clearCache) {
        console.log("[SYNC] Clearing classification cache on request");
        clearClassificationCache();
      }

      setStoreRefreshing(true, "Fetching 6 public ATS sources...");

      // ── Stage 0: Fetch raw data across all 6 providers ───────────────
      const sourceResult: AllSourcesResult = await fetchAllSources();

      setStoreRefreshing(true, "Filtering India roles & running candidate checks...");

      // ── Stages 1-6: Normalize → India filter → Candidate filter → Dedup → Gemini batch classification
      const pipeline: Phase3PipelineResult = await runPhase3Pipeline(sourceResult);

      setStoreRefreshing(true, "Persisting active opportunities...");

      // ── Stage 7: Persistent Database Ingestion ────────────────────────
      const persistentStats = ingestPersistentJobs(pipeline.fresherCandidates);

      const finishTime = Date.now();
      const finishedAtIso = new Date(finishTime).toISOString();
      const durationMs = finishTime - startTime;

      // Extract per-provider results
      const providerResults: Record<JobSource, ProviderResult> = {
        greenhouse: {
          source: "greenhouse",
          status: sourceResult.greenhouse.errors.length > 0 && sourceResult.greenhouse.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.greenhouse.records.length,
          durationMs: sourceResult.greenhouse.durationMs,
          error: sourceResult.greenhouse.errors[0]?.message,
        },
        lever: {
          source: "lever",
          status: sourceResult.lever.errors.length > 0 && sourceResult.lever.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.lever.records.length,
          durationMs: sourceResult.lever.durationMs,
          error: sourceResult.lever.errors[0]?.message,
        },
        ashby: {
          source: "ashby",
          status: sourceResult.ashby.errors.length > 0 && sourceResult.ashby.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.ashby.records.length,
          durationMs: sourceResult.ashby.durationMs,
          error: sourceResult.ashby.errors[0]?.message,
        },
        smartrecruiters: {
          source: "smartrecruiters",
          status: sourceResult.smartrecruiters.errors.length > 0 && sourceResult.smartrecruiters.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.smartrecruiters.records.length,
          durationMs: sourceResult.smartrecruiters.durationMs,
          error: sourceResult.smartrecruiters.errors[0]?.message,
        },
        recruitee: {
          source: "recruitee",
          status: sourceResult.recruitee.errors.length > 0 && sourceResult.recruitee.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.recruitee.records.length,
          durationMs: sourceResult.recruitee.durationMs,
          error: sourceResult.recruitee.errors[0]?.message,
        },
        pinpoint: {
          source: "pinpoint",
          status: sourceResult.pinpoint.errors.length > 0 && sourceResult.pinpoint.records.length === 0 ? "error" : "success",
          fetchedCount: sourceResult.pinpoint.records.length,
          durationMs: sourceResult.pinpoint.durationMs,
          error: sourceResult.pinpoint.errors[0]?.message,
        },
      };

      const freshnessDist = computeFreshnessDistribution(jobStore.jobs);

      const runRecord: RefreshRunRecord = {
        id: runId,
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        durationMs,
        status: "completed",
        trigger,
        providerResults,
        counts: {
          rawFetched: pipeline.counts.rawTotal,
          normalized: pipeline.counts.normalizedTotal,
          indiaEligible: pipeline.counts.validIndianTotal,
          hardRejected: pipeline.counts.nonCandidates,
          duplicatesRemoved: pipeline.dedupMetrics.duplicatesRemoved,
          newlyAdded: persistentStats.newlyAdded,
          updated: persistentStats.updated,
          retainedUnchanged: persistentStats.retainedUnchanged,
          removedUnavailable: persistentStats.removedUnavailable,
          staleHidden: 0,
          totalActive: persistentStats.totalActive,
        },
        llm: {
          candidates: pipeline.llmMetrics.total,
          invoked: pipeline.llmMetrics.llm,
          succeeded: pipeline.llmMetrics.llm,
          failed: pipeline.llmMetrics.failed,
          cached: pipeline.llmMetrics.cached,
          inputTokens: pipeline.usage?.inputTokens ?? 0,
          outputTokens: pipeline.usage?.outputTokens ?? 0,
          estimatedCostUsd: pipeline.usage?.estimatedRefreshCostUsd ?? 0,
        },
        freshnessDistribution: freshnessDist,
      };

      recordRefreshRun(runRecord);
      setStoreRefreshing(false);

      console.log(`
╔═════════════════════════════════════════════════════════════════════════════╗
║                      GRADHUNT REFRESH RUN COMPLETE                          ║
╠═════════════════════════════════════════════════════════════════════════════╣
║ Trigger:                         ${trigger.toUpperCase().padEnd(42)} ║
║ Run ID:                          ${runId.padEnd(42)} ║
║ Total Active Jobs in Store:      ${String(persistentStats.totalActive).padEnd(42)} ║
║ Newly Added / Updated:           ${`+${persistentStats.newlyAdded} new / ${persistentStats.updated} updated`.padEnd(42)} ║
║ Retained Unchanged:              ${String(persistentStats.retainedUnchanged).padEnd(42)} ║
║ Removed (Unavailable on Source): ${String(persistentStats.removedUnavailable).padEnd(42)} ║
║ Gemini Candidates Evaluated:     ${String(pipeline.llmMetrics.total).padEnd(42)} ║
║ Gemini Cache Hits:               ${String(pipeline.llmMetrics.cached).padEnd(42)} ║
║ Gemini Tokens (In / Out):        ${`${pipeline.usage?.inputTokens ?? 0} in / ${pipeline.usage?.outputTokens ?? 0} out`.padEnd(42)} ║
║ Est. Refresh Cost (USD):         $${(pipeline.usage?.estimatedRefreshCostUsd ?? 0).toFixed(6).padEnd(41)} ║
║ Total Run Duration:              ${`${(durationMs / 1000).toFixed(1)}s`.padEnd(42)} ║
╚═════════════════════════════════════════════════════════════════════════════╝
      `);

      return {
        success: true,
        message: "Pipeline completed successfully",
        runRecord,
        persistentStats,
        pipeline,
        totalDurationMs: durationMs,
      };
    } catch (err) {
      const finishTime = Date.now();
      const durationMs = finishTime - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[SYNC] Critical error during refresh:", err);

      setStoreRefreshing(false);
      setStoreError(errorMsg);

      const failedRecord: RefreshRunRecord = {
        id: runId,
        startedAt: startedAtIso,
        finishedAt: new Date(finishTime).toISOString(),
        durationMs,
        status: "failed",
        trigger,
        providerResults: {} as any,
        counts: {
          rawFetched: 0,
          normalized: 0,
          indiaEligible: 0,
          hardRejected: 0,
          duplicatesRemoved: 0,
          newlyAdded: 0,
          updated: 0,
          retainedUnchanged: 0,
          removedUnavailable: 0,
          staleHidden: 0,
          totalActive: getStoreStatus().count,
        },
        llm: {
          candidates: 0,
          invoked: 0,
          succeeded: 0,
          failed: 0,
          cached: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
        freshnessDistribution: computeFreshnessDistribution(jobStore.jobs),
        error: errorMsg,
      };

      recordRefreshRun(failedRecord);

      throw err;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

export function triggerBackgroundRefresh(trigger: "manual" | "cron" | "startup" = "startup"): void {
  if (inFlightRefreshPromise) return;
  // Fire and forget
  executeFullRefresh(trigger).catch((err) => {
    console.error(`[SYNC] Background refresh (${trigger}) failed:`, err);
  });
}
