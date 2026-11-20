/**
 * GradHunt — LLM Classification Types
 */

import { Job, WorkMode, JobType } from "../types/job";
import { ClassifiedRole } from "./taxonomy";

export interface JobClassification {
  role: ClassifiedRole;
  normalized_role?: string;
  role_cluster?: string;
  city: string;
  workMode: WorkMode;
  job_type?: JobType;
  seniority?: string;
  is_fresher_relevant?: boolean;
  is_internship?: boolean;
  experience_min_years?: number | null;
  experience_max_years?: number | null;
  relevanceScore?: number;
  relevanceExplanation?: string;
  reasoning_summary?: string;
  skills?: string[];
  semanticConfidence?: {
    role?: "high" | "medium" | "low";
    city?: "high" | "medium" | "low";
    work_mode?: "high" | "medium" | "low";
  };
  source: "llm" | "cache" | "deterministic";
  model?: string;
  confidence?: number | "high" | "medium" | "low";
  classificationStatus?: "llm_success" | "llm_cached" | "llm_failed" | "llm_not_run";
  rawResponse?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  retryCount?: number;
  wasLlmAttempted?: boolean;
  llmError?: string;
}

export interface ClassificationProvider {
  name: string;
  classify(job: Job): Promise<JobClassification>;
}

export interface GeminiUsageMetrics {
  totalJobsProcessed: number;
  newJobs: number;
  updatedJobs: number;
  unchangedCachedJobs: number;
  jobsSentToGemini: number;
  jobsServedFromCache: number;
  jobsSuccessfullyClassified: number;
  jobsReclassified: number;
  failedLlmRequests: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  configuredModel: string;
  estimatedInputCostUsd: number;
  estimatedOutputCostUsd: number;
  estimatedRefreshCostUsd: number;
  cumulativeProcessCostUsd: number;
  avgCostPerNewlyClassifiedJobUsd: number;
}

export interface BatchClassificationResult {
  classifiedJobs: Job[];
  metrics: {
    total: number;
    cached: number;
    llm: number;
    deterministicFallback: number;
    failed: number;
    durationMs: number;
  };
  usage: GeminiUsageMetrics;
}
