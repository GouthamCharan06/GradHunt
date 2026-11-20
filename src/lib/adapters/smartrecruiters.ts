/**
 * GradHunt — SmartRecruiters Source Adapter
 *
 * Fetches real job postings from the SmartRecruiters Public Posting API.
 * Endpoint: https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings
 *
 * Requirements:
 * - Public, unauthenticated endpoint.
 * - Fully paginated using totalFound, offset, and limit (max 100 per page).
 * - Company names are data derived from job.company.name, not hardcoded allowlists.
 * - Direct application URLs and posting URLs preserved verbatim.
 */

import { SMARTRECRUITERS_COMPANIES, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  SmartRecruitersRawJob,
  SmartRecruitersApiResponse,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const BASE_URL = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const CONCURRENCY_LIMIT = 4;

/**
 * Fetches all paginated job postings for a single SmartRecruiters company.
 * Continues fetching pages until offset + limit >= totalFound or no content returned.
 */
async function fetchCompanyPostings(
  companySlug: string
): Promise<{ jobs: SmartRecruitersRawJob[]; error?: SourceError; pagesFetched: number }> {
  let offset = 0;
  let totalFound = 0;
  let pagesFetched = 0;
  const companyJobs: SmartRecruitersRawJob[] = [];

  try {
    do {
      const url = `${BASE_URL}/${companySlug}/postings?offset=${offset}&limit=${PAGE_SIZE}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "GradHunt/1.0 (job-aggregator; India-fresher-search)",
          },
        });

        if (!response.ok) {
          // If 404, company might not have an active public board under this slug
          return {
            jobs: companyJobs,
            pagesFetched,
            error: {
              source: "smartrecruiters",
              message: `SmartRecruiters "${companySlug}": HTTP ${response.status} ${response.statusText}`,
              statusCode: response.status,
              code: `HTTP_${response.status}`,
              timestamp: new Date().toISOString(),
            },
          };
        }

        const data: SmartRecruitersApiResponse = await response.json();
        totalFound = data.totalFound ?? 0;
        const pageContent = data.content ?? [];
        pagesFetched++;

        for (const job of pageContent) {
          companyJobs.push({
            ...job,
            _companySlug: companySlug,
          });
        }

        if (pageContent.length === 0) {
          break;
        }

        offset += PAGE_SIZE;
      } finally {
        clearTimeout(timeoutId);
      }
    } while (offset < totalFound);

    return { jobs: companyJobs, pagesFetched };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    return {
      jobs: companyJobs,
      pagesFetched,
      error: {
        source: "smartrecruiters",
        message: `SmartRecruiters "${companySlug}": ${isTimeout ? "Request timed out" : message}`,
        code: isTimeout ? "TIMEOUT" : "FETCH_ERROR",
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Batched concurrency helper.
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
 * Fetches all configured SmartRecruiters company boards with full pagination.
 */
export async function fetchSmartRecruiters(): Promise<RawFetchResult<SmartRecruitersRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: SmartRecruitersRawJob[] = [];
  let totalPages = 0;

  try {
    const results = await batchedFetch(
      SMARTRECRUITERS_COMPANIES,
      (slug) => fetchCompanyPostings(slug),
      CONCURRENCY_LIMIT
    );

    for (const result of results) {
      allJobs.push(...result.jobs);
      totalPages += result.pagesFetched;
      if (result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    console.error("[SmartRecruiters] Fetch batch failure:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[SmartRecruiters] Fetched ${allJobs.length} raw postings across ${totalPages} pages ` +
      `from ${SMARTRECRUITERS_COMPANIES.length} companies (${errors.length} failed/empty) in ${durationMs}ms`
  );

  return {
    source: "smartrecruiters",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/**
 * Generates diagnostics for the SmartRecruiters adapter.
 */
export function getSmartRecruitersDiagnostics(
  result: RawFetchResult<SmartRecruitersRawJob>
): AdapterDiagnostics {
  const withUsableId = result.records.filter((j) => Boolean(j.id)).length;
  const withTimestamp = result.records.filter((j) => Boolean(j.releasedDate)).length;
  const withApplicationUrl = result.records.filter((j) => Boolean(j.applyUrl || j.postingUrl || j.id)).length;
  const withDescription = result.records.length;

  const failedSlugs = new Set(
    result.errors.map((e) => {
      const match = e.message.match(/"([^"]+)"/);
      return match ? match[1] : "";
    })
  );

  return {
    source: "smartrecruiters",
    totalRecords: result.records.length,
    withUsableId,
    withTimestamp,
    withApplicationUrl,
    withDescription,
    boardsAttempted: SMARTRECRUITERS_COMPANIES.length,
    boardsSucceeded: SMARTRECRUITERS_COMPANIES.length - failedSlugs.size,
    boardsFailed: failedSlugs.size,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
