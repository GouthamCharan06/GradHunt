/**
 * GradHunt — Classification Cache
 *
 * Implements Step 11:
 * Caching based on job ID and a stable SHA-256 hash of title, location, and description.
 * Ensures unchanged jobs are never re-sent to the LLM, preserving quota and minimizing latency.
 */

import { createHash } from "crypto";
import { Job } from "../types/job";
import { JobClassification } from "./types";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeJobContentHash(job: Job): string {
  const content = [
    job.sourceJobId || job.id,
    job.source,
    job.title.trim().toLowerCase(),
    (job.rawLocation || job.city).trim().toLowerCase(),
    (job.jobType || "full-time").toLowerCase(),
    (job.experienceRange || "unknown").toLowerCase(),
    job.description.slice(0, 1500).trim().toLowerCase(),
  ].join("|");
  return `${job.sourceJobId || job.id}:${sha256(content)}`;
}

// In-memory cache singleton
const globalForCache = globalThis as unknown as {
  gradHuntClassificationCache?: Map<string, JobClassification>;
};

export const classificationCache =
  globalForCache.gradHuntClassificationCache ?? new Map<string, JobClassification>();

if (process.env.NODE_ENV !== "production") {
  globalForCache.gradHuntClassificationCache = classificationCache;
}

export function getCachedClassification(job: Job): JobClassification | null {
  const key = computeJobContentHash(job);
  const found = classificationCache.get(key);
  if (found) {
    return {
      ...found,
      source: "cache",
    };
  }
  return null;
}

export function setCachedClassification(job: Job, classification: JobClassification): void {
  const key = computeJobContentHash(job);
  classificationCache.set(key, classification);
}

export function clearClassificationCache(): void {
  classificationCache.clear();
}

export function getCacheStats(): { size: number } {
  return { size: classificationCache.size };
}
