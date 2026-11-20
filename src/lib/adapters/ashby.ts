/**
 * GradHunt — Ashby Adapter
 *
 * Fetches real job listings from the Ashby Public Job Posting API.
 * Endpoint: https://api.ashbyhq.com/posting-api/job-board/{slug}
 *
 * No authentication required. Returns JSON with { jobs: [...] }.
 */

import { ASHBY_COMPANIES, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  AshbyRawJob,
  AshbyApiResponse,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const BASE_URL = "https://api.ashbyhq.com/posting-api/job-board";

/** Max concurrent company fetches. */
const CONCURRENCY_LIMIT = 8;

/**
 * Formats a company slug into a rough company name.
 * e.g. "dbt-labs" → "Dbt Labs", "perplexityai" → "Perplexityai"
 */
function formatCompanyName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Fetches a single Ashby company's job board.
 */
async function fetchCompany(
  slug: string
): Promise<{ jobs: AshbyRawJob[]; error?: SourceError }> {
  const url = `${BASE_URL}/${slug}`;
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
          source: "ashby",
          message: `Company "${slug}": HTTP ${response.status} ${response.statusText}`,
          statusCode: response.status,
          code: `HTTP_${response.status}`,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const data: AshbyApiResponse = await response.json();

    const jobs: AshbyRawJob[] = (data.jobs ?? []).map((job) => ({
      ...job,
      _companySlug: slug,
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
        source: "ashby",
        message: `Company "${slug}": ${isTimeout ? "Request timed out" : message}`,
        code: isTimeout ? "TIMEOUT" : "FETCH_ERROR",
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
 * Fetches all Ashby companies concurrently and returns raw records.
 */
export async function fetchAshby(): Promise<RawFetchResult<AshbyRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: AshbyRawJob[] = [];

  try {
    const results = await batchedFetch(
      ASHBY_COMPANIES,
      async (slug) => fetchCompany(slug),
      CONCURRENCY_LIMIT
    );

    for (const result of results) {
      allJobs.push(...result.jobs);
      if (result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    console.error("[Ashby] Batch fetch failed:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[Ashby] Fetched ${allJobs.length} jobs from ${ASHBY_COMPANIES.length} companies ` +
      `(${ASHBY_COMPANIES.length - errors.length} succeeded, ${errors.length} failed) ` +
      `in ${durationMs}ms`
  );

  return {
    source: "ashby",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/** Generate diagnostics for development logging. */
export function getAshbyDiagnostics(
  result: RawFetchResult<AshbyRawJob>
): AdapterDiagnostics {
  const records = result.records;
  return {
    source: "ashby",
    totalRecords: records.length,
    withUsableId: records.filter((r) => r.id != null && r.id.length > 0).length,
    withTimestamp: records.filter(
      (r) => r.publishedAt != null && r.publishedAt.length > 0
    ).length,
    withApplicationUrl: records.filter(
      (r) => r.jobUrl != null && r.jobUrl.length > 0
    ).length,
    withDescription: records.filter(
      (r) => r.descriptionHtml != null && r.descriptionHtml.length > 0
    ).length,
    boardsAttempted: ASHBY_COMPANIES.length,
    boardsSucceeded: ASHBY_COMPANIES.length - result.errors.length,
    boardsFailed: result.errors.length,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
