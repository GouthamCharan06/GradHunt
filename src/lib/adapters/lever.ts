/**
 * GradHunt — Lever Adapter
 *
 * Fetches real job listings from the Lever Public Postings API.
 * Endpoint: https://api.lever.co/v0/postings/{company}
 *
 * No authentication required. Returns JSON array directly.
 */

import { LEVER_COMPANIES, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  LeverRawJob,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const BASE_URL = "https://api.lever.co/v0/postings";

/** Max concurrent company fetches. */
const CONCURRENCY_LIMIT = 8;

/**
 * Fetches a single Lever company's postings with pagination.
 * Iterates using Lever's supported `skip` and `limit` query parameters
 * to collect the complete candidate pool rather than stopping at the first default page.
 */
async function fetchCompany(
  slug: string
): Promise<{ jobs: LeverRawJob[]; error?: SourceError }> {
  const allRawJobs: any[] = [];
  let skip = 0;
  const pageSize = 100;
  let hasMore = true;
  let pageCount = 0;
  const maxPages = 10; // Up to 1,000 jobs per company

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35_000);

  try {
    while (hasMore && pageCount < maxPages) {
      const url = `${BASE_URL}/${slug}?mode=json&limit=${pageSize}&skip=${skip}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "GradHunt/1.0 (job-aggregator)",
        },
      });

      if (!response.ok) {
        if (allRawJobs.length > 0) break; // Retain partial results if later page fails
        return {
          jobs: [],
          error: {
            source: "lever",
            message: `Company "${slug}": HTTP ${response.status} ${response.statusText}`,
            statusCode: response.status,
            code: `HTTP_${response.status}`,
            timestamp: new Date().toISOString(),
          },
        };
      }

      const data = await response.json();
      const rawPage: unknown[] = Array.isArray(data) ? data : [];
      allRawJobs.push(...rawPage);

      if (rawPage.length < pageSize) {
        hasMore = false;
      } else {
        skip += rawPage.length;
        pageCount++;
      }
    }

    const jobs: LeverRawJob[] = allRawJobs.map((job: any) => ({
      id: job.id,
      text: job.text,
      hostedUrl: job.hostedUrl,
      createdAt: job.createdAt,
      categories: job.categories ?? {},
      description: job.description ?? "",
      descriptionPlain: job.descriptionPlain ?? "",
      additional: job.additional ?? "",
      additionalPlain: job.additionalPlain ?? "",
      lists: job.lists ?? [],
      country: job.country,
      workplaceType: job.workplaceType,
      _companySlug: slug,
    }));

    return { jobs };
  } catch (err) {
    if (allRawJobs.length > 0) {
      const jobs: LeverRawJob[] = allRawJobs.map((job: any) => ({
        id: job.id,
        text: job.text,
        hostedUrl: job.hostedUrl,
        createdAt: job.createdAt,
        categories: job.categories ?? {},
        description: job.description ?? "",
        descriptionPlain: job.descriptionPlain ?? "",
        additional: job.additional ?? "",
        additionalPlain: job.additionalPlain ?? "",
        lists: job.lists ?? [],
        country: job.country,
        workplaceType: job.workplaceType,
        _companySlug: slug,
      }));
      return { jobs };
    }
    const message =
      err instanceof Error ? err.message : "Unknown error";
    const isTimeout =
      err instanceof DOMException && err.name === "AbortError";

    return {
      jobs: [],
      error: {
        source: "lever",
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
 * Fetches all Lever companies concurrently and returns raw records.
 */
export async function fetchLever(): Promise<RawFetchResult<LeverRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: LeverRawJob[] = [];

  try {
    const results = await batchedFetch(
      LEVER_COMPANIES,
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
    console.error("[Lever] Batch fetch failed:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[Lever] Fetched ${allJobs.length} jobs from ${LEVER_COMPANIES.length} companies ` +
      `(${LEVER_COMPANIES.length - errors.length} succeeded, ${errors.length} failed) ` +
      `in ${durationMs}ms`
  );

  return {
    source: "lever",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/** Generate diagnostics for development logging. */
export function getLeverDiagnostics(
  result: RawFetchResult<LeverRawJob>
): AdapterDiagnostics {
  const records = result.records;
  return {
    source: "lever",
    totalRecords: records.length,
    withUsableId: records.filter((r) => r.id != null && r.id.length > 0).length,
    withTimestamp: records.filter((r) => r.createdAt != null && r.createdAt > 0).length,
    withApplicationUrl: records.filter(
      (r) => r.hostedUrl != null && r.hostedUrl.length > 0
    ).length,
    withDescription: records.filter(
      (r) =>
        (r.description != null && r.description.length > 0) ||
        (r.descriptionPlain != null && r.descriptionPlain.length > 0)
    ).length,
    boardsAttempted: LEVER_COMPANIES.length,
    boardsSucceeded: LEVER_COMPANIES.length - result.errors.length,
    boardsFailed: result.errors.length,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
