import fs from "fs";
import path from "path";
import { Job, JobSource, RefreshRunRecord, FreshnessDistribution, ProviderResult } from "./types/job";
import { deduplicateJobs } from "./pipeline/dedup";
import { DEFAULT_ACTIVE_FEED_MAX_AGE_DAYS } from "./constants";

/**
 * In-memory & file-backed persistent database for the GradHunt live dataset.
 *
 * Retains active, deduplicated, verified fresher/intern Indian opportunities
 * across all 6 approved public ATS providers.
 *
 * Persists to disk (.data/jobs-store.json) so server cold-starts load
 * immediately in <2ms without waiting for a 7-minute ingestion cycle.
 */
interface JobStoreState {
  jobs: Job[];
  lastRefreshedAt: string | null;
  lastError: string | null;
  isRefreshing: boolean;
  refreshProgress: string | null;
  latestRefreshRecord: RefreshRunRecord | null;
  recentRefreshRuns: RefreshRunRecord[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const JOBS_FILE = path.join(DATA_DIR, "jobs-store.json");
const RUNS_FILE = path.join(DATA_DIR, "refresh-runs.json");

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    // Non-blocking in read-only environments
  }
}

function loadPersistedJobs(): { jobs: Job[]; lastRefreshedAt: string | null } {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.jobs)) {
        return {
          jobs: parsed.jobs,
          lastRefreshedAt: parsed.lastRefreshedAt || null,
        };
      }
    }
  } catch (err) {
    console.warn("[Store] Could not load persisted jobs from disk:", err);
  }
  return { jobs: [], lastRefreshedAt: null };
}

function savePersistedJobs(jobs: Job[], lastRefreshedAt: string | null): void {
  try {
    ensureDataDir();
    fs.writeFileSync(
      JOBS_FILE,
      JSON.stringify({ jobs, lastRefreshedAt, savedAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[Store] Could not persist jobs to disk:", err);
  }
}

function loadPersistedRuns(): RefreshRunRecord[] {
  try {
    if (fs.existsSync(RUNS_FILE)) {
      const raw = fs.readFileSync(RUNS_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function savePersistedRuns(runs: RefreshRunRecord[]): void {
  try {
    ensureDataDir();
    fs.writeFileSync(RUNS_FILE, JSON.stringify(runs.slice(0, 20), null, 2), "utf-8");
  } catch {}
}

const initialData = loadPersistedJobs();
const initialRuns = loadPersistedRuns();

// Global singleton across server invocations in development
const globalForJobStore = globalThis as unknown as {
  gradHuntJobStore?: JobStoreState;
};

export const jobStore: JobStoreState = globalForJobStore.gradHuntJobStore ?? {
  jobs: initialData.jobs,
  lastRefreshedAt: initialData.lastRefreshedAt,
  lastError: null,
  isRefreshing: false,
  refreshProgress: null,
  latestRefreshRecord: initialRuns.length > 0 ? initialRuns[0] : null,
  recentRefreshRuns: initialRuns,
};

if (process.env.NODE_ENV !== "production") {
  globalForJobStore.gradHuntJobStore = jobStore;
}

export function computeFreshnessDistribution(jobs: Job[], asOf: Date = new Date()): FreshnessDistribution {
  const now = asOf.getTime();
  const dist: FreshnessDistribution = {
    "0-7d": 0,
    "8-30d": 0,
    "31-60d": 0,
    "61-90d": 0,
    "90d+": 0,
    oldestPostingDate: null,
    newestPostingDate: null,
  };

  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const job of jobs) {
    const rawDate = job.postedAt || job.publishedAt;
    const time = new Date(rawDate).getTime();
    if (isNaN(time)) continue;

    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;

    const ageDays = Math.floor((now - time) / (1000 * 60 * 60 * 24));
    if (ageDays <= 7) dist["0-7d"]++;
    else if (ageDays <= 30) dist["8-30d"]++;
    else if (ageDays <= 60) dist["31-60d"]++;
    else if (ageDays <= 90) dist["61-90d"]++;
    else dist["90d+"]++;
  }

  if (minTime !== Infinity) dist.oldestPostingDate = new Date(minTime).toISOString();
  if (maxTime !== -Infinity) dist.newestPostingDate = new Date(maxTime).toISOString();

  return dist;
}

export function getStoredJobs(maxAgeDays?: number): Job[] {
  if (!maxAgeDays || maxAgeDays <= 0) {
    return jobStore.jobs;
  }
  const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return jobStore.jobs.filter((j) => {
    const time = new Date(j.postedAt || j.publishedAt).getTime();
    if (isNaN(time)) return true;
    return time >= cutoffTime;
  });
}

export function getAllStoredHistoricalJobs(): Job[] {
  return jobStore.jobs;
}

export function setStoredJobs(jobs: Job[], refreshedAt: string = new Date().toISOString()): void {
  jobStore.jobs = jobs;
  jobStore.lastRefreshedAt = refreshedAt;
  jobStore.lastError = null;
  savePersistedJobs(jobs, refreshedAt);
}

export interface PersistentIngestStats {
  previousCount: number;
  retainedUnchanged: number;
  incomingCount: number;
  newlyAdded: number;
  updated: number;
  removedUnavailable: number;
  duplicatesRemoved: number;
  totalActive: number;
  within24Hours: number;
  olderActive: number;
  freshnessDistribution: FreshnessDistribution;
}

/**
 * Ingests incoming jobs into the persistent job database.
 * Retains existing active jobs, updates changed records, marks lastSeenAt,
 * and maintains freshness distribution.
 */
export function ingestPersistentJobs(
  incomingJobs: Job[],
  asOf: Date = new Date(),
  successfulProviders?: Set<JobSource>
): PersistentIngestStats {
  const previousCount = jobStore.jobs.length;
  const asOfIso = asOf.toISOString();

  // 1. Filter incoming: only verified Indian eligible opportunities
  const validIncoming = incomingJobs.filter((j) => {
    if (j.country !== "India") return false;
    if (!j.isFresherCandidate && !j.isFresherEligible) return false;
    return true;
  });

  // Map incoming jobs by dedupKey (source + sourceJobId)
  const incomingMap = new Map<string, Job>();
  for (const job of validIncoming) {
    if (job.dedupKey) {
      incomingMap.set(job.dedupKey, {
        ...job,
        lastSeenAt: asOfIso,
        lastSyncedAt: asOfIso,
        sourceStatus: "active",
      });
    }
  }

  // 2. Track previous jobs: retain, update, or remove if reliably gone from source
  const mergedMap = new Map<string, Job>();
  let retainedUnchanged = 0;
  let updated = 0;
  let removedUnavailable = 0;

  for (const prevJob of jobStore.jobs) {
    const key = prevJob.dedupKey;
    if (!key) continue;

    const incomingMatch = incomingMap.get(key);

    if (incomingMatch) {
      const hasChanged =
        incomingMatch.title !== prevJob.title ||
        incomingMatch.rawLocation !== prevJob.rawLocation ||
        incomingMatch.applicationUrl !== prevJob.applicationUrl ||
        incomingMatch.updatedAt !== prevJob.updatedAt;

      if (hasChanged) {
        mergedMap.set(key, {
          ...prevJob,
          ...incomingMatch,
          lastSeenAt: asOfIso,
          lastSyncedAt: asOfIso,
          sourceStatus: "active",
          role: incomingMatch.role || prevJob.role,
          role_cluster: incomingMatch.role_cluster || prevJob.role_cluster,
          city: incomingMatch.city || prevJob.city,
          workMode: incomingMatch.workMode || prevJob.workMode,
          jobType: incomingMatch.jobType || prevJob.jobType,
          relevanceScore: incomingMatch.relevanceScore ?? prevJob.relevanceScore,
          relevanceExplanation: incomingMatch.relevanceExplanation || prevJob.relevanceExplanation,
        });
        updated++;
      } else {
        mergedMap.set(key, {
          ...prevJob,
          lastSeenAt: asOfIso,
          lastSyncedAt: asOfIso,
          sourceStatus: "active",
          isWithin24Hours: incomingMatch.isWithin24Hours,
        });
        retainedUnchanged++;
      }
      incomingMap.delete(key);
    } else {
      const shouldRemove = successfulProviders ? successfulProviders.has(prevJob.source) : false;
      if (shouldRemove) {
        removedUnavailable++;
      } else {
        mergedMap.set(key, {
          ...prevJob,
          sourceStatus: "active",
        });
        retainedUnchanged++;
      }
    }
  }

  // 3. Add newly discovered jobs
  let newlyAdded = 0;
  for (const [key, newJob] of incomingMap) {
    mergedMap.set(key, newJob);
    newlyAdded++;
  }

  // 4. Cross-source Deduplication
  const dedup = deduplicateJobs(Array.from(mergedMap.values()));

  // 5. Default Ordering: Newest/freshest first by source timestamp
  const sorted = dedup.deduplicated.sort((a, b) => {
    const timeA = new Date(a.postedAt || a.publishedAt).getTime();
    const timeB = new Date(b.postedAt || b.publishedAt).getTime();
    if (isNaN(timeA) && isNaN(timeB)) return 0;
    if (isNaN(timeA)) return 1;
    if (isNaN(timeB)) return -1;
    return timeB - timeA;
  });

  jobStore.jobs = sorted;
  jobStore.lastRefreshedAt = asOfIso;
  jobStore.lastError = null;

  savePersistedJobs(sorted, asOfIso);

  const within24Hours = sorted.filter((j) => j.isWithin24Hours).length;
  const olderActive = sorted.length - within24Hours;
  const freshnessDistribution = computeFreshnessDistribution(sorted, asOf);

  return {
    previousCount,
    retainedUnchanged,
    incomingCount: incomingJobs.length,
    newlyAdded,
    updated,
    removedUnavailable,
    duplicatesRemoved: dedup.duplicatesRemoved,
    totalActive: sorted.length,
    within24Hours,
    olderActive,
    freshnessDistribution,
  };
}

/** Legacy wrapper function for backward compatibility with existing tests */
export function ingestRollingJobs(
  incomingJobs: Job[],
  asOf: Date = new Date(),
  _windowHours?: number
) {
  const stats = ingestPersistentJobs(incomingJobs, asOf);
  return {
    ...stats,
    expiredCount: stats.removedUnavailable,
    retainedFromPrevious: stats.retainedUnchanged,
  };
}

export function recordRefreshRun(run: RefreshRunRecord): void {
  jobStore.latestRefreshRecord = run;
  jobStore.recentRefreshRuns.unshift(run);
  if (jobStore.recentRefreshRuns.length > 20) {
    jobStore.recentRefreshRuns.pop();
  }
  savePersistedRuns(jobStore.recentRefreshRuns);
}

export function getLatestRefreshRun(): RefreshRunRecord | null {
  return jobStore.latestRefreshRecord;
}

export function getRecentRefreshRuns(): RefreshRunRecord[] {
  return jobStore.recentRefreshRuns;
}

export function setStoreRefreshing(isRefreshing: boolean, progress?: string): void {
  jobStore.isRefreshing = isRefreshing;
  if (progress !== undefined) {
    jobStore.refreshProgress = progress;
  }
}

export function setStoreError(error: string): void {
  jobStore.lastError = error;
}

export function getStoreStatus(): {
  count: number;
  lastRefreshedAt: string | null;
  isRefreshing: boolean;
  refreshProgress: string | null;
  lastError: string | null;
  latestRefreshRecord: RefreshRunRecord | null;
  freshnessDistribution: FreshnessDistribution;
} {
  return {
    count: jobStore.jobs.length,
    lastRefreshedAt: jobStore.lastRefreshedAt,
    isRefreshing: jobStore.isRefreshing,
    refreshProgress: jobStore.refreshProgress,
    lastError: jobStore.lastError,
    latestRefreshRecord: jobStore.latestRefreshRecord,
    freshnessDistribution: computeFreshnessDistribution(jobStore.jobs),
  };
}
