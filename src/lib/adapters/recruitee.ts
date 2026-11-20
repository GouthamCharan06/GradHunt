/**
 * GradHunt — Recruitee Source Adapter
 *
 * Fetches real job offers from the Recruitee Public Careers Site API.
 * Endpoint: https://{company}.recruitee.com/api/offers/
 *
 * Requirements:
 * - Public, unauthenticated endpoint.
 * - Retrieves the complete available public board/feed.
 * - Preserves provider identifiers, company name, location, full descriptions,
 *   exact application URLs (careers_apply_url), and publication dates.
 */

import { RECRUITEE_COMPANIES, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  RecruiteeRawJob,
  RecruiteeApiResponse,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const CONCURRENCY_LIMIT = 5;

/**
 * Formats a company slug into a readable company name.
 */
function formatCompanyName(slug: string): string {
  if (slug.toLowerCase() === "fulfilio") return "Fulfil.io";
  if (slug.toLowerCase() === "clanx") return "ClanX";
  if (slug.toLowerCase() === "deephealth") return "DeepHealth";
  if (slug.toLowerCase() === "mgid") return "MGID";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Fetches all public offers for a single Recruitee company.
 */
async function fetchCompanyOffers(
  companySlug: string
): Promise<{ jobs: RecruiteeRawJob[]; error?: SourceError }> {
  const url = `https://${companySlug}.recruitee.com/api/offers/`;
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
      return {
        jobs: [],
        error: {
          source: "recruitee",
          message: `Recruitee "${companySlug}": HTTP ${response.status} ${response.statusText}`,
          statusCode: response.status,
          code: `HTTP_${response.status}`,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const data: RecruiteeApiResponse = await response.json();
    const rawOffers = data.offers ?? [];
    const companyName = formatCompanyName(companySlug);

    const jobs: RecruiteeRawJob[] = rawOffers.map((offer) => ({
      ...offer,
      _companySlug: companySlug,
      _company: companyName,
    }));

    return { jobs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    return {
      jobs: [],
      error: {
        source: "recruitee",
        message: `Recruitee "${companySlug}": ${isTimeout ? "Request timed out" : message}`,
        code: isTimeout ? "TIMEOUT" : "FETCH_ERROR",
        timestamp: new Date().toISOString(),
      },
    };
  } finally {
    clearTimeout(timeoutId);
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
 * Fetches all configured Recruitee company boards.
 */
export async function fetchRecruitee(): Promise<RawFetchResult<RecruiteeRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: RecruiteeRawJob[] = [];

  try {
    const results = await batchedFetch(
      RECRUITEE_COMPANIES,
      (slug) => fetchCompanyOffers(slug),
      CONCURRENCY_LIMIT
    );

    for (const result of results) {
      allJobs.push(...result.jobs);
      if (result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    console.error("[Recruitee] Batch fetch failure:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[Recruitee] Fetched ${allJobs.length} raw offers from ${RECRUITEE_COMPANIES.length} companies ` +
      `(${errors.length} failed/empty) in ${durationMs}ms`
  );

  return {
    source: "recruitee",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/**
 * Generates diagnostics for the Recruitee adapter.
 */
export function getRecruiteeDiagnostics(
  result: RawFetchResult<RecruiteeRawJob>
): AdapterDiagnostics {
  const withUsableId = result.records.filter((j) => Boolean(j.id)).length;
  const withTimestamp = result.records.filter((j) => Boolean(j.published_at || j.updated_at)).length;
  const withApplicationUrl = result.records.filter((j) => Boolean(j.careers_apply_url || j.careers_url)).length;
  const withDescription = result.records.filter((j) => Boolean(j.description)).length;

  const failedSlugs = new Set(
    result.errors.map((e) => {
      const match = e.message.match(/"([^"]+)"/);
      return match ? match[1] : "";
    })
  );

  return {
    source: "recruitee",
    totalRecords: result.records.length,
    withUsableId,
    withTimestamp,
    withApplicationUrl,
    withDescription,
    boardsAttempted: RECRUITEE_COMPANIES.length,
    boardsSucceeded: RECRUITEE_COMPANIES.length - failedSlugs.size,
    boardsFailed: failedSlugs.size,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
