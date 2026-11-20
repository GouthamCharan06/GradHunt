/**
 * GradHunt — Pinpoint Source Adapter
 *
 * Fetches real job listings from the Pinpoint Public Postings JSON endpoint.
 * Endpoint: https://{company}.pinpointhq.com/postings.json
 *
 * Requirements:
 * - Public, unauthenticated, keyless endpoint.
 * - Retrieves complete available public postings.
 * - Preserves identifiers, company name, location, full descriptions,
 *   exact application URLs, and employment types.
 */

import { PINPOINT_COMPANIES, SOURCE_FETCH_TIMEOUT_MS } from "../constants";
import { SourceError } from "../types/job";
import {
  PinpointRawJob,
  RawFetchResult,
  AdapterDiagnostics,
} from "./types";

const CONCURRENCY_LIMIT = 4;

/**
 * Formats a company slug into a readable company name.
 */
function formatCompanyName(slug: string): string {
  if (slug.toLowerCase() === "cgt") return "CGT U.S.";
  if (slug.toLowerCase() === "bluecross") return "Blue Cross";
  if (slug.toLowerCase() === "butlins") return "Butlin's";
  if (slug.toLowerCase() === "riverisland") return "River Island";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Fetches public postings for a single Pinpoint company.
 */
async function fetchCompanyPostings(
  companySlug: string
): Promise<{ jobs: PinpointRawJob[]; error?: SourceError }> {
  const url = `https://${companySlug}.pinpointhq.com/postings.json`;
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
          source: "pinpoint",
          message: `Pinpoint "${companySlug}": HTTP ${response.status} ${response.statusText}`,
          statusCode: response.status,
          code: `HTTP_${response.status}`,
          timestamp: new Date().toISOString(),
        },
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      return {
        jobs: [],
        error: {
          source: "pinpoint",
          message: `Pinpoint "${companySlug}": Non-JSON response returned`,
          code: "INVALID_CONTENT_TYPE",
          timestamp: new Date().toISOString(),
        },
      };
    }

    const data = await response.json();
    const rawPostings: unknown[] = Array.isArray(data) ? data : (data.data ?? []);
    const companyName = formatCompanyName(companySlug);

    const jobs: PinpointRawJob[] = rawPostings.map((p) => {
      const posting = p as Record<string, unknown>;
      return {
        ...(posting as unknown as PinpointRawJob),
        _companySlug: companySlug,
        _company: companyName,
      };
    });

    return { jobs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isTimeout = err instanceof DOMException && err.name === "AbortError";

    return {
      jobs: [],
      error: {
        source: "pinpoint",
        message: `Pinpoint "${companySlug}": ${isTimeout ? "Request timed out" : message}`,
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
 * Fetches all configured Pinpoint company boards.
 */
export async function fetchPinpoint(): Promise<RawFetchResult<PinpointRawJob>> {
  const startTime = Date.now();
  const fetchedAt = new Date().toISOString();
  const errors: SourceError[] = [];
  const allJobs: PinpointRawJob[] = [];

  try {
    const results = await batchedFetch(
      PINPOINT_COMPANIES,
      (slug) => fetchCompanyPostings(slug),
      CONCURRENCY_LIMIT
    );

    for (const result of results) {
      allJobs.push(...result.jobs);
      if (result.error) {
        errors.push(result.error);
      }
    }
  } catch (err) {
    console.error("[Pinpoint] Batch fetch failure:", err);
  }

  const durationMs = Date.now() - startTime;

  console.log(
    `[Pinpoint] Fetched ${allJobs.length} raw postings from ${PINPOINT_COMPANIES.length} companies ` +
      `(${errors.length} failed/empty) in ${durationMs}ms`
  );

  return {
    source: "pinpoint",
    records: allJobs,
    errors,
    durationMs,
    fetchedAt,
  };
}

/**
 * Generates diagnostics for the Pinpoint adapter.
 */
export function getPinpointDiagnostics(
  result: RawFetchResult<PinpointRawJob>
): AdapterDiagnostics {
  const withUsableId = result.records.filter((j) => Boolean(j.id)).length;
  const withTimestamp = result.records.length; // Pinpoint postings are active on board
  const withApplicationUrl = result.records.filter((j) => Boolean(j.url)).length;
  const withDescription = result.records.filter((j) => Boolean(j.description || j.skills_knowledge_expertise)).length;

  const failedSlugs = new Set(
    result.errors.map((e) => {
      const match = e.message.match(/"([^"]+)"/);
      return match ? match[1] : "";
    })
  );

  return {
    source: "pinpoint",
    totalRecords: result.records.length,
    withUsableId,
    withTimestamp,
    withApplicationUrl,
    withDescription,
    boardsAttempted: PINPOINT_COMPANIES.length,
    boardsSucceeded: PINPOINT_COMPANIES.length - failedSlugs.size,
    boardsFailed: failedSlugs.size,
    durationMs: result.durationMs,
    errors: result.errors.map((e) => e.message),
  };
}
