/**
 * GradHunt — /api/jobs
 *
 * Fast, production-ready frontend jobs retrieval API:
 * 1. Reads directly from the persisted database (<5ms latency).
 * 2. NEVER blocks on live ATS fetching, Gemini classification, or refresh cycles.
 * 3. Enforces strict India-only boundary.
 * 4. Implements the Active Feed Freshness Policy (default 90 days, configurable).
 * 5. Dynamically extracts available filter options from the current real dataset.
 * 6. Server-side pagination (10 jobs per page).
 */

import { NextRequest, NextResponse } from "next/server";
import { getStoredJobs, getStoreStatus, getLatestRefreshRun } from "@/lib/store";
import { triggerBackgroundRefresh } from "@/lib/pipeline/orchestrator";
import { Job, WorkMode } from "@/lib/types/job";
import { searchAndRankJobs } from "@/lib/pipeline/search";
import { DEFAULT_ACTIVE_FEED_MAX_AGE_DAYS } from "@/lib/constants";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeStatus = getStoreStatus();

    // Autonomous 24-hour self-refresh:
    // If the database is empty or the last successful refresh was more than 24 hours ago,
    // trigger a non-blocking background refresh automatically without depending on Vercel cron.
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const isPast24Hours = Boolean(
      storeStatus.lastRefreshedAt &&
      Date.now() - new Date(storeStatus.lastRefreshedAt).getTime() > TWENTY_FOUR_HOURS_MS
    );

    if ((storeStatus.count === 0 || isPast24Hours) && !storeStatus.isRefreshing) {
      const triggerReason = storeStatus.count === 0 ? "startup" : "interval_24h";
      console.log(`[/api/jobs] Autonomous refresh triggered (reason: ${triggerReason})`);
      triggerBackgroundRefresh(triggerReason);
    }

    const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const country = searchParams.get("country")?.trim().toLowerCase() ?? "";
    const city = searchParams.get("city")?.trim().toLowerCase() ?? "";
    const company = searchParams.get("company")?.trim().toLowerCase() ?? "";
    const source = searchParams.get("source")?.trim().toLowerCase() ?? "";
    const workMode = searchParams.get("workMode")?.trim().toLowerCase() ?? "";
    const role = searchParams.get("role")?.trim() ?? "";
    const cluster = searchParams.get("cluster")?.trim() ?? "";
    const jobType = searchParams.get("jobType")?.trim().toLowerCase() ?? "";
    const isFresherOnly = searchParams.get("isFresher");
    const sort = searchParams.get("sort") ?? "recent"; // "recent" | "company" | "relevance"

    // Active feed freshness threshold (default 90 days)
    const rawMaxAge = searchParams.get("maxAgeDays");
    const maxAgeDays = rawMaxAge ? parseInt(rawMaxAge, 10) : DEFAULT_ACTIVE_FEED_MAX_AGE_DAYS;

    const excludeIdsParam = searchParams.get("excludeIds");
    const excludeIds = excludeIdsParam ? new Set(excludeIdsParam.split(",").filter(Boolean)) : null;
    const onlyIdsParam = searchParams.get("onlyIds");
    const onlyIds = onlyIdsParam ? new Set(onlyIdsParam.split(",").filter(Boolean)) : null;

    // Pagination params
    const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

    const rawLimit = parseInt(searchParams.get("limit") ?? "10", 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 10 : Math.min(rawLimit, 100);

    // Retrieve jobs from persistent database with active-feed policy
    const allStored = getStoredJobs(maxAgeDays > 0 ? maxAgeDays : undefined);

    // Baseline: GradHunt is strictly India-only
    const indiaJobs = allStored.filter((j) => j.country === "India");

    // Dynamically derive available filter options from the current real dataset
    const availableCities = Array.from(
      new Set(indiaJobs.map((j) => j.city).filter((c) => Boolean(c) && c !== "Unknown"))
    ).sort();

    const availableWorkModes = Array.from(
      new Set(indiaJobs.map((j) => j.workMode).filter((w) => Boolean(w) && w !== "unknown"))
    ).sort();

    const availableRoles = Array.from(
      new Set(indiaJobs.map((j) => j.normalized_role || j.role).filter(Boolean))
    ).sort() as string[];

    const availableClusters = Array.from(
      new Set(indiaJobs.map((j) => j.role_cluster).filter(Boolean))
    ).sort() as string[];

    const availableCompanies = Array.from(
      new Set(indiaJobs.map((j) => j.company).filter(Boolean))
    ).sort() as string[];

    const availableSources = Array.from(
      new Set(indiaJobs.map((j) => j.source).filter(Boolean))
    ).sort() as string[];

    const availableJobTypes = Array.from(
      new Set(indiaJobs.map((j) => j.jobType).filter((t) => Boolean(t) && t !== "unknown"))
    ).sort();

    // Deterministic in-memory filtering over active real Indian dataset
    let filtered: Job[] = indiaJobs.filter((job) => {
      // 0. Session-level applied filter
      if (excludeIds && excludeIds.has(job.id)) {
        return false;
      }
      if (onlyIds && !onlyIds.has(job.id)) {
        return false;
      }

      // 1. Country filter (India only)
      if (country && country !== "all" && country !== "india") {
        return false;
      }

      // 2. City filter
      if (city && city !== "all") {
        if (job.city.toLowerCase() !== city) {
          return false;
        }
      }

      // 3. Company filter
      if (company && company !== "all") {
        if (job.company.toLowerCase() !== company) {
          return false;
        }
      }

      // 4. Source provider filter
      if (source && source !== "all") {
        if (job.source.toLowerCase() !== source) {
          return false;
        }
      }

      // 5. Work Mode filter
      if (workMode && workMode !== "all") {
        if (job.workMode.toLowerCase() !== workMode) {
          return false;
        }
      }

      // 6. Role filter (matches normalized_role or role)
      if (role && role !== "all") {
        const matchesNorm = (job.normalized_role || "").toLowerCase() === role.toLowerCase();
        const matchesRole = (job.role || "").toLowerCase() === role.toLowerCase();
        if (!matchesNorm && !matchesRole) {
          return false;
        }
      }

      // 7. Cluster filter
      if (cluster && cluster !== "all") {
        if ((job.role_cluster || "").toLowerCase() !== cluster.toLowerCase()) {
          return false;
        }
      }

      // 8. Job Type filter
      if (jobType && jobType !== "all") {
        if (job.jobType !== jobType) {
          return false;
        }
      }

      // 9. Fresher candidate filter toggle
      if (isFresherOnly === "true") {
        if (!job.isFresherCandidate && !job.isFresherEligible) return false;
      }

      return true;
    });

    // Search relevance ranking
    if (query) {
      filtered = searchAndRankJobs(filtered, query);
    } else {
      if (sort === "company") {
        filtered.sort((a, b) => a.company.localeCompare(b.company));
      } else if (sort === "relevance") {
        filtered.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
      } else {
        // Default: Newest first by verified source date
        filtered.sort((a, b) => {
          const timeA = new Date(a.postedAt || a.publishedAt).getTime();
          const timeB = new Date(b.postedAt || b.publishedAt).getTime();
          if (isNaN(timeA) && isNaN(timeB)) return 0;
          if (isNaN(timeA)) return 1;
          if (isNaN(timeB)) return -1;
          return timeB - timeA;
        });
      }
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paginatedJobs = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      jobs: paginatedJobs,
      total,
      page,
      pageSize: limit,
      totalPages,
      unfilteredTotal: storeStatus.count,
      availableFilters: {
        countries: ["India"],
        cities: availableCities,
        workModes: availableWorkModes,
        roles: availableRoles,
        clusters: availableClusters,
        companies: availableCompanies,
        sources: availableSources,
        jobTypes: availableJobTypes,
      },
      lastRefreshedAt: storeStatus.lastRefreshedAt,
      isRefreshing: storeStatus.isRefreshing,
      refreshProgress: storeStatus.refreshProgress,
      latestRefreshRecord: getLatestRefreshRun(),
      freshnessDistribution: storeStatus.freshnessDistribution,
    });
  } catch (error) {
    console.error("[/api/jobs] Critical error:", error);
    return NextResponse.json(
      {
        error: "Internal server error retrieving opportunities",
        jobs: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      },
      { status: 500 }
    );
  }
}
