/**
 * GradHunt — Greenhouse Adapter
 *
 * Fetches real job listings from the Greenhouse Public Job Board API.
 * Endpoint: https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *
 * No authentication required. Rate-limited per IP.
 */

import { GREENHOUSE_BOARDS, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  GreenhouseRawJob,
  GreenhouseApiResponse,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const BASE_URL = "https://boards-api.greenhouse.io/v1/boards";

/** Max concurrent board fetches. */
const CONCURRENCY_LIMIT = 8;

/**
 * Fetches a single Greenhouse board.
 * Returns the raw jobs with board slug and company name injected.
 */
async function fetchBoard(
  slug: string
): Promise<{ jobs: GreenhouseRawJob[]; error?: SourceError }> {
  const url = `${BASE_URL}/${slug}/jobs?content=true`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "GradHunt/1.0 (job-aggregator)",
      },
    });

    if (!response.ok) {
      return {
        jobs: [],
        error: {
          source: "greenhouse",
          message: `Board "${slug}": HTTP ${response.status} ${response.statusText}`,
          statusCode: response.status,
          code: `HTTP_${response.status}`,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const data: GreenhouseApiResponse = await response.json();

    const jobs: GreenhouseRawJob[] = (data.jobs ?? []).map((job) => ({
      ...job,
      _boardSlug: slug,
      _company: formatCompanyName(slug),
    }));

    return { jobs };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    const isTimeout =
      err instanceof DOMException && err.name === "AbortError";

    return {
      jobs: [],
      error: {
        source: "greenhouse",
        message: `Board "${slug}": ${isTimeout ? "Request timed out" : message}`,
        code: isTimeout ? "TIMEOUT" : "FETCH_ERROR",
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Formats a board slug into a human-readable company name.
 * e.g. "cockroachlabs" → "Cockroachlabs", "pinterestcareers" → "Pinterestcareers"
 * This is a rough guess — normalization in Phase 3 may refine it.
 */
function formatCompanyName(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Run promises in batches to limit concurrency.
 */
async function batchedFetch<T>(
  items: readonly string[],
  fn: (item: string) => Promise<T>,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * Fetches all Greenhouse boards concurrently and returns raw records.
 */
export async function fetchGreenhouse(): Promise<RawFetchResult<GreenhouseRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: GreenhouseRawJob[] = [];

  try {
    const results = await batchedFetch(
      GREENHOUSE_BOARDS,
      async (slug) => fetchBoard(slug),
      CONCURRENCY_LIMIT
    );

    for (const result of results) {
      allJobs.push(...result.jobs);
      if (result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    console.error("[Greenhouse] Batch fetch failed:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[Greenhouse] Fetched ${allJobs.length} jobs from ${GREENHOUSE_BOARDS.length} boards ` +
      `(${GREENHOUSE_BOARDS.length - errors.length} succeeded, ${errors.length} failed) ` +
      `in ${durationMs}ms`
  );

  return {
    source: "greenhouse",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/** Generate diagnostics for development logging. */
export function getGreenhouseDiagnostics(
  result: RawFetchResult<GreenhouseRawJob>
): AdapterDiagnostics {
  const records = result.records;
  return {
    source: "greenhouse",
    totalRecords: records.length,
    withUsableId: records.filter((r) => r.id != null).length,
    withTimestamp: records.filter((r) => r.updated_at != null).length,
    withApplicationUrl: records.filter(
      (r) => r.absolute_url != null && r.absolute_url.length > 0
    ).length,
    withDescription: records.filter(
      (r) => r.content != null && r.content.length > 0
    ).length,
    boardsAttempted: GREENHOUSE_BOARDS.length,
    boardsSucceeded: GREENHOUSE_BOARDS.length - result.errors.length,
    boardsFailed: result.errors.length,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
