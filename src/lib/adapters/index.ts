/**
 * GradHunt — Source Adapter Orchestrator
 *
 * Runs all 6 approved public ATS adapters concurrently:
 * - Greenhouse
 * - Lever
 * - Ashby
 * - SmartRecruiters
 * - Recruitee
 * - Pinpoint
 *
 * Emits structured [SYNC] audit logs and enforces per-provider failure isolation.
 */

import { fetchGreenhouse, getGreenhouseDiagnostics } from "./greenhouse";
import { fetchLever, getLeverDiagnostics } from "./lever";
import { fetchAshby, getAshbyDiagnostics } from "./ashby";
import { fetchSmartRecruiters, getSmartRecruitersDiagnostics } from "./smartrecruiters";
import { fetchRecruitee, getRecruiteeDiagnostics } from "./recruitee";
import { fetchPinpoint, getPinpointDiagnostics } from "./pinpoint";
import {
  RawFetchResult,
  AdapterDiagnostics,
  GreenhouseRawJob,
  LeverRawJob,
  AshbyRawJob,
  SmartRecruitersRawJob,
  RecruiteeRawJob,
  PinpointRawJob,
} from "./types";

/** All 6 approved public ATS provider results bundled together. */
export interface AllSourcesResult {
  greenhouse: RawFetchResult<GreenhouseRawJob>;
  lever: RawFetchResult<LeverRawJob>;
  ashby: RawFetchResult<AshbyRawJob>;
  smartrecruiters: RawFetchResult<SmartRecruitersRawJob>;
  recruitee: RawFetchResult<RecruiteeRawJob>;
  pinpoint: RawFetchResult<PinpointRawJob>;
  totalRecords: number;
  totalErrors: number;
  durationMs: number;
  diagnostics: AdapterDiagnostics[];
}

/**
 * Wraps an adapter fetch with per-provider structured logging and error isolation.
 */
async function fetchProviderWithLogging<T>(
  name: string,
  fetchFn: () => Promise<RawFetchResult<T>>
): Promise<RawFetchResult<T>> {
  console.log(`[SYNC] PROVIDER name=${name}`);
  const start = Date.now();
  try {
    const result = await fetchFn();
    const dur = Date.now() - start;
    console.log(`[SYNC] PROVIDER DONE name=${name} fetched=${result.records.length} errors=${result.errors.length} durationMs=${dur}`);
    return result;
  } catch (err) {
    const dur = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[SYNC] PROVIDER ERROR name=${name} error=${errorMsg} durationMs=${dur}`);
    return {
      source: name as any,
      records: [],
      errors: [{
        source: name as any,
        message: errorMsg,
        timestamp: new Date().toISOString(),
      }],
      durationMs: dur,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Fetches all 6 approved sources concurrently with failure isolation.
 */
export async function fetchAllSources(): Promise<AllSourcesResult> {
  const startTime = Date.now();
  console.log("[SYNC] START providers=greenhouse,lever,ashby,smartrecruiters,recruitee,pinpoint");

  // Run all 6 adapters concurrently with independent error isolation
  const [greenhouse, lever, ashby, smartrecruiters, recruitee, pinpoint] = await Promise.all([
    fetchProviderWithLogging("greenhouse", fetchGreenhouse),
    fetchProviderWithLogging("lever", fetchLever),
    fetchProviderWithLogging("ashby", fetchAshby),
    fetchProviderWithLogging("smartrecruiters", fetchSmartRecruiters),
    fetchProviderWithLogging("recruitee", fetchRecruitee),
    fetchProviderWithLogging("pinpoint", fetchPinpoint),
  ]);

  const durationMs = Date.now() - startTime;

  const diagnostics: AdapterDiagnostics[] = [
    getGreenhouseDiagnostics(greenhouse),
    getLeverDiagnostics(lever),
    getAshbyDiagnostics(ashby),
    getSmartRecruitersDiagnostics(smartrecruiters),
    getRecruiteeDiagnostics(recruitee),
    getPinpointDiagnostics(pinpoint),
  ];

  const totalRecords =
    greenhouse.records.length +
    lever.records.length +
    ashby.records.length +
    smartrecruiters.records.length +
    recruitee.records.length +
    pinpoint.records.length;

  const totalErrors =
    greenhouse.errors.length +
    lever.errors.length +
    ashby.errors.length +
    smartrecruiters.errors.length +
    recruitee.errors.length +
    pinpoint.errors.length;

  console.log(`[SYNC] END totalRecords=${totalRecords} totalErrors=${totalErrors} durationMs=${durationMs}`);

  return {
    greenhouse,
    lever,
    ashby,
    smartrecruiters,
    recruitee,
    pinpoint,
    totalRecords,
    totalErrors,
    durationMs,
    diagnostics,
  };
}

export type {
  RawFetchResult,
  AdapterDiagnostics,
  GreenhouseRawJob,
  LeverRawJob,
  AshbyRawJob,
  SmartRecruitersRawJob,
  RecruiteeRawJob,
  PinpointRawJob,
} from "./types";
