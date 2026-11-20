/**
 * GradHunt — Deduplication Engine
 *
 * Deterministically deduplicates jobs:
 * 1. Exact deduplication by `dedupKey` (sha256(source:sourceJobId))
 * 2. Cross-source / multi-post deduplication by `crossDedupKey` (company|title|city)
 *
 * When duplicates are detected, retains the entry with the most recent publication/update timestamp.
 */

import { Job } from "../types/job";

export interface DedupResult {
  deduplicated: Job[];
  duplicatesRemoved: number;
}

export function deduplicateJobs(jobs: Job[]): DedupResult {
  const seenDedupKeys = new Set<string>();
  const seenCrossKeys = new Set<string>();
  const deduplicated: Job[] = [];

  // Sort by publishedAt descending so we retain the newest version when deduplicating
  const sorted = [...jobs].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  let duplicatesRemoved = 0;

  for (const job of sorted) {
    // 1. Exact Source Deduplication
    if (job.dedupKey && seenDedupKeys.has(job.dedupKey)) {
      duplicatesRemoved++;
      continue;
    }

    // 2. Cross-Source Deduplication (same company, title, and city)
    if (job.crossDedupKey && seenCrossKeys.has(job.crossDedupKey)) {
      duplicatesRemoved++;
      continue;
    }

    if (job.dedupKey) {
      seenDedupKeys.add(job.dedupKey);
    }
    if (job.crossDedupKey) {
      seenCrossKeys.add(job.crossDedupKey);
    }

    deduplicated.push(job);
  }

  return {
    deduplicated,
    duplicatesRemoved,
  };
}
