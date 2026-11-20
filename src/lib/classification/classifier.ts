/**
 * GradHunt — Job Classification Service
 *
 * Implements observable, real Gemini semantic classification:
 * - Provider-independent abstraction (Gemini primary)
 * - Bounded batch classification with stable job ID mapping
 * - Transparent audit logging:
 *   [LLM] REFRESH START candidates=N model=...
 *   [LLM] INVOKE Gemini model=... batch=... attempt=... jobIds=...
 *   [LLM] RESPONSE batch=... status=success inputTokens=... outputTokens=... latencyMs=...
 *   [LLM] REFRESH END invoked=N succeeded=N failed=N cached=N inputTokens=N outputTokens=N estimatedCost=$... latencyMs=...
 * - Distinguishes llm_success, llm_cached, llm_failed, and llm_not_run states
 * - Never fabricates fake classifications or mock data on failure
 * - Non-blocking error handling preserving real source jobs
 */

import { Job } from "../types/job";
import {
  ClassificationProvider,
  JobClassification,
  BatchClassificationResult,
  GeminiUsageMetrics,
} from "./types";
import { getCachedClassification, setCachedClassification } from "./cache";
import { GeminiProvider } from "./providers/gemini";
import { HuggingFaceProvider } from "./providers/huggingface";
import { GEMINI_CONFIG } from "../constants";

let activeProvider: ClassificationProvider | null = null;

// Cumulative cost tracker across the lifetime of the running server process
const cumulativeProcessTokens = {
  input: 0,
  output: 0,
  total: 0,
};
let cumulativeProcessCostUsd = 0;

export function getCumulativeGeminiCost(): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cumulativeCostUsd: number;
} {
  return {
    inputTokens: cumulativeProcessTokens.input,
    outputTokens: cumulativeProcessTokens.output,
    totalTokens: cumulativeProcessTokens.total,
    cumulativeCostUsd: cumulativeProcessCostUsd,
  };
}

export function getClassificationProvider(): ClassificationProvider {
  if (activeProvider) return activeProvider;

  const providerType = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

  if (providerType === "gemini") {
    activeProvider = new GeminiProvider();
  } else if (providerType === "huggingface") {
    activeProvider = new HuggingFaceProvider();
  } else {
    activeProvider = new GeminiProvider();
  }

  return activeProvider;
}

export function setClassificationProvider(provider: ClassificationProvider | null): void {
  activeProvider = provider;
}

export function getStartupClassificationStatus(): {
  provider: string;
  isAvailable: boolean;
  model: string;
  details?: Record<string, unknown>;
} {
  const provider = getClassificationProvider();
  const providerName = provider.name || "unknown";

  if (provider instanceof GeminiProvider) {
    const summary = provider.getConfigSummary();
    return {
      provider: providerName,
      isAvailable: summary.configured,
      model: summary.model,
      details: {
        hasProjectName: summary.hasProjectName,
        hasProjectNumber: summary.hasProjectNumber,
        timeoutMs: summary.timeoutMs,
      },
    };
  }

  return {
    provider: providerName,
    isAvailable: true,
    model: GEMINI_CONFIG.defaultModel,
  };
}

export function applyClassificationToJob(job: Job, classification: JobClassification): Job {
  job.classificationStatus = classification.classificationStatus;
  job.llmError = classification.llmError;
  job.normalized_role = classification.normalized_role || job.title;
  job.role = classification.role;
  job.role_cluster = classification.role_cluster;
  if (classification.city && classification.city !== "Unknown") {
    job.city = classification.city;
  }
  if (classification.workMode && classification.workMode !== "unknown") {
    job.workMode = classification.workMode;
    job.isRemote = classification.workMode === "remote";
  }
  if (classification.job_type && classification.job_type !== "unknown") {
    job.jobType = classification.job_type;
  }
  job.is_fresher_relevant = classification.is_fresher_relevant;
  job.is_internship = classification.is_internship;
  job.experience_min_years = classification.experience_min_years;
  job.experience_max_years = classification.experience_max_years;
  job.relevanceScore = classification.relevanceScore;
  job.relevanceExplanation = classification.relevanceExplanation;
  job.reasoning_summary = classification.reasoning_summary;
  job.skills = classification.skills;
  job.confidence = classification.semanticConfidence;

  if (classification.classificationStatus === "llm_success" || classification.classificationStatus === "llm_cached") {
    job.isFresherEligible = Boolean(classification.is_fresher_relevant || classification.is_internship);
  } else {
    // Non-blocking: keep in store with llm_failed/llm_not_run, eligible only if confirmed internship or junior title
    job.isFresherEligible = Boolean(
      job.jobType === "internship" ||
      /\b(intern|internship|co-?op|apprentice)\b/i.test(job.title) ||
      job.isFresherCandidate
    );
  }

  return job;
}

/**
 * Classifies a batch of candidate jobs with observable audit logging and token/cost metrics.
 * Groups uncached jobs into bounded batches (5 jobs per request) to prevent quota exhaustion.
 */
export async function classifyJobsBatch(
  jobs: Job[],
  batchSize = 5
): Promise<BatchClassificationResult> {
  const startTime = Date.now();
  const provider = getClassificationProvider();
  const configuredModel = provider instanceof GeminiProvider ? provider.model : GEMINI_CONFIG.defaultModel;

  console.log(`[LLM] REFRESH START candidates=${jobs.length} model=${configuredModel}`);

  let cachedCount = 0;
  let llmSuccessCount = 0;
  let llmFailedCount = 0;
  let totalRetries = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;

  const toClassify: Job[] = [];

  // 1. Separate cached jobs from jobs that need classification
  for (const job of jobs) {
    const cached = getCachedClassification(job);
    if (cached) {
      cachedCount++;
      const cachedResult: JobClassification = {
        ...cached,
        source: "cache",
        classificationStatus: "llm_cached",
      };
      applyClassificationToJob(job, cachedResult);
    } else {
      toClassify.push(job);
    }
  }

  // 2. Classify uncached jobs in bounded batches
  const totalBatches = Math.ceil(toClassify.length / batchSize);

  for (let b = 0; b < toClassify.length; b += batchSize) {
    const batchIndex = Math.floor(b / batchSize) + 1;
    if (batchIndex > 1) {
      // Pacing delay between batches to comfortably avoid RPM limits
      await new Promise((r) => setTimeout(r, 600));
    }

    const chunk = toClassify.slice(b, b + batchSize);

    if (provider instanceof GeminiProvider) {
      try {
        const resultMap = await provider.classifyBatch(chunk, batchIndex, totalBatches);

        for (const job of chunk) {
          const classification = resultMap.get(job.id);
          if (classification) {
            if (classification.classificationStatus === "llm_success") {
              llmSuccessCount++;
              batchInputTokens += classification.inputTokens || 0;
              batchOutputTokens += classification.outputTokens || 0;
              totalRetries += classification.retryCount || 0;
              setCachedClassification(job, classification);
            } else if (classification.classificationStatus === "llm_failed") {
              llmFailedCount++;
              totalRetries += classification.retryCount || 0;
            }
            applyClassificationToJob(job, classification);
          } else {
            llmFailedCount++;
            job.classificationStatus = "llm_failed";
            job.llmError = "No classification returned in batch";
          }
        }
      } catch (err) {
        console.error(`[LLM] Batch ${batchIndex} fatal exception:`, err);
        for (const job of chunk) {
          llmFailedCount++;
          job.classificationStatus = "llm_failed";
          job.llmError = err instanceof Error ? err.message : String(err);
        }
      }
    } else {
      // Fallback for non-Gemini provider
      for (const job of chunk) {
        try {
          const classification = await provider.classify(job);
          if (classification.classificationStatus === "llm_success") {
            llmSuccessCount++;
            setCachedClassification(job, classification);
          } else {
            llmFailedCount++;
          }
          applyClassificationToJob(job, classification);
        } catch (err) {
          llmFailedCount++;
          job.classificationStatus = "llm_failed";
          job.llmError = err instanceof Error ? err.message : String(err);
        }
      }
    }
  }

  const batchTotalTokens = batchInputTokens + batchOutputTokens;
  const inputRate = GEMINI_CONFIG.inputCostPerMillion;
  const outputRate = GEMINI_CONFIG.outputCostPerMillion;

  const estimatedInputCost = (batchInputTokens / 1_000_000) * inputRate;
  const estimatedOutputCost = (batchOutputTokens / 1_000_000) * outputRate;
  const estimatedRefreshCost = estimatedInputCost + estimatedOutputCost;

  cumulativeProcessTokens.input += batchInputTokens;
  cumulativeProcessTokens.output += batchOutputTokens;
  cumulativeProcessTokens.total += batchTotalTokens;
  cumulativeProcessCostUsd += estimatedRefreshCost;

  const invokedCount = llmSuccessCount + llmFailedCount;
  const durationMs = Date.now() - startTime;

  console.log(
    `[LLM] REFRESH END invoked=${invokedCount} succeeded=${llmSuccessCount} failed=${llmFailedCount} cached=${cachedCount} inputTokens=${batchInputTokens} outputTokens=${batchOutputTokens} estimatedCost=$${estimatedRefreshCost.toFixed(6)} latencyMs=${durationMs}`
  );

  const usage: GeminiUsageMetrics = {
    totalJobsProcessed: jobs.length,
    newJobs: toClassify.length,
    updatedJobs: 0,
    unchangedCachedJobs: cachedCount,
    jobsSentToGemini: toClassify.length,
    jobsServedFromCache: cachedCount,
    jobsSuccessfullyClassified: llmSuccessCount,
    jobsReclassified: 0,
    failedLlmRequests: llmFailedCount,
    retryCount: totalRetries,
    inputTokens: batchInputTokens,
    outputTokens: batchOutputTokens,
    totalTokens: batchTotalTokens,
    configuredModel,
    estimatedInputCostUsd: estimatedInputCost,
    estimatedOutputCostUsd: estimatedOutputCost,
    estimatedRefreshCostUsd: estimatedRefreshCost,
    cumulativeProcessCostUsd,
    avgCostPerNewlyClassifiedJobUsd: llmSuccessCount > 0 ? estimatedRefreshCost / llmSuccessCount : 0,
  };

  return {
    classifiedJobs: jobs,
    metrics: {
      total: jobs.length,
      cached: cachedCount,
      llm: llmSuccessCount,
      deterministicFallback: 0,
      failed: llmFailedCount,
      durationMs,
    },
    usage,
  };
}

export async function classifyJob(job: Job): Promise<JobClassification> {
  const provider = getClassificationProvider();
  return provider.classify(job);
}

export function getDeterministicClassification(job: Job): JobClassification {
  const isInternship = job.jobType === "internship" || /\b(intern|internship|co-?op)\b/i.test(job.title);
  return {
    role: "Software Engineering",
    normalized_role: job.title,
    role_cluster: "Software Engineering",
    city: job.city || "Unknown",
    workMode: job.workMode || "unknown",
    job_type: isInternship ? "internship" : "full-time",
    seniority: isInternship ? "intern" : "entry",
    is_fresher_relevant: true,
    is_internship: isInternship,
    experience_min_years: null,
    experience_max_years: null,
    relevanceScore: isInternship ? 95 : 85,
    skills: [],
    source: "deterministic",
    classificationStatus: "llm_not_run",
    wasLlmAttempted: false,
  };
}
