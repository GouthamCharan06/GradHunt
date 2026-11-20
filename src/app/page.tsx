"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { JobCard } from "@/components/job-card";
import { RefreshStatusBar } from "@/components/refresh-status-bar";
import {
  JobFilters,
  FilterState,
  AvailableFilters,
} from "@/components/job-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Job, RefreshRunRecord, FreshnessDistribution } from "@/lib/types/job";
import { Inbox, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { cn } from "cn";

const INITIAL_FILTERS: FilterState = {
  search: "",
  country: "india",
  city: "all",
  workMode: "all",
  role: "all",
  company: "all",
  source: "all",
  jobType: "all",
  isFresherOnly: false,
  sort: "recent",
  maxAgeDays: 90,
};

const PAGE_SIZE = 10;

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [availableFilters, setAvailableFilters] = useState<AvailableFilters | undefined>(undefined);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshProgress, setRefreshProgress] = useState<string | null>(null);
  const [latestRecord, setLatestRecord] = useState<RefreshRunRecord | null>(null);
  const [freshnessDistribution, setFreshnessDistribution] = useState<FreshnessDistribution | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Session-level Applied Jobs state (tracked in localStorage without requiring login)
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"available" | "applied">("available");

  // Debounce search input by 250ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 250);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Load applied jobs from localStorage on client mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gradhunt_applied_jobs_v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setAppliedIds(parsed);
        }
      }
    } catch (err) {
      console.warn("Could not load applied jobs from localStorage:", err);
    }
  }, []);

  const handleApply = useCallback((job: Job) => {
    setAppliedIds((prev) => {
      if (prev.includes(job.id)) return prev;
      const next = [...prev, job.id];
      try {
        localStorage.setItem("gradhunt_applied_jobs_v1", JSON.stringify(next));
      } catch (e) {
        console.warn("Could not save to localStorage:", e);
      }
      return next;
    });
  }, []);

  const handleUnapply = useCallback((job: Job) => {
    setAppliedIds((prev) => {
      const next = prev.filter((id) => id !== job.id);
      try {
        localStorage.setItem("gradhunt_applied_jobs_v1", JSON.stringify(next));
      } catch (e) {
        console.warn("Could not save to localStorage:", e);
      }
      return next;
    });
  }, []);

  // Fetch jobs from the fast persisted backend API
  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));

      if (debouncedSearch) params.set("q", debouncedSearch);
      if (filters.country) params.set("country", filters.country);
      if (filters.city !== "all") params.set("city", filters.city);
      if (filters.company !== "all") params.set("company", filters.company);
      if (filters.source !== "all") params.set("source", filters.source);
      if (filters.workMode !== "all") params.set("workMode", filters.workMode);
      if (filters.role !== "all") params.set("role", filters.role);
      if (filters.jobType !== "all") params.set("jobType", filters.jobType);
      if (filters.isFresherOnly) params.set("isFresher", "true");
      if (filters.sort) params.set("sort", filters.sort);
      if (filters.maxAgeDays) params.set("maxAgeDays", String(filters.maxAgeDays));

      // Session-level Applied tab filtering:
      if (activeTab === "available" && appliedIds.length > 0) {
        params.set("excludeIds", appliedIds.join(","));
      } else if (activeTab === "applied") {
        if (appliedIds.length === 0) {
          setJobs([]);
          setTotal(0);
          setTotalPages(1);
          setIsLoading(false);
          return;
        }
        params.set("onlyIds", appliedIds.join(","));
      }

      const res = await fetch(`/api/jobs?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Server responded with HTTP ${res.status}`);
      }
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
      if (data.availableFilters) {
        setAvailableFilters(data.availableFilters);
      }
      setLastRefreshedAt(data.lastRefreshedAt ?? null);
      setIsRefreshing(Boolean(data.isRefreshing));
      setRefreshProgress(data.refreshProgress ?? null);
      if (data.latestRefreshRecord) {
        setLatestRecord(data.latestRefreshRecord);
      }
      if (data.freshnessDistribution) {
        setFreshnessDistribution(data.freshnessDistribution);
      }
    } catch (err) {
      console.error("Failed to load jobs:", err);
      setError("Unable to load opportunities at this time.");
      setJobs([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filters.country, filters.city, filters.company, filters.source, filters.workMode, filters.role, filters.jobType, filters.isFresherOnly, filters.sort, filters.maxAgeDays, page, activeTab, appliedIds]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Periodic lightweight status polling when background refresh is active
  useEffect(() => {
    if (!isRefreshing) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/refresh?status=true&_t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.storeStatus) {
            setRefreshProgress(data.storeStatus.refreshProgress ?? null);
            if (!data.storeStatus.isRefreshing) {
              setIsRefreshing(false);
              fetchJobs();
            }
          }
        }
      } catch (err) {
        console.warn("Status poll error:", err);
      }
    }, 2500);

    // Safety timeout: automatically reset refreshing flag after 90s if backend completed silently
    const safetyTimeout = setTimeout(() => {
      setIsRefreshing(false);
      fetchJobs();
    }, 90_000);

    return () => {
      clearInterval(interval);
      clearTimeout(safetyTimeout);
    };
  }, [isRefreshing, fetchJobs]);

  // Manual refresh trigger
  const handleManualRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshProgress("Starting 6-provider synchronization & Gemini AI classification...");
    try {
      // Trigger refresh in background so client never blocks on slow calls
      await fetch("/api/refresh?async=true", { method: "POST", cache: "no-store" });
    } catch (err) {
      console.error("Refresh error:", err);
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setPage(1);
  };

  const handleTabChange = (tab: "available" | "applied") => {
    setActiveTab(tab);
    setPage(1);
  };

  const startRecord = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endRecord = Math.min(page * PAGE_SIZE, total);

  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.city !== "all" ||
    filters.workMode !== "all" ||
    filters.role !== "all" ||
    filters.company !== "all" ||
    filters.source !== "all" ||
    filters.isFresherOnly ||
    (filters.maxAgeDays !== undefined && filters.maxAgeDays !== 90);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 font-sans">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {/* Header Section */}
        <section className="space-y-1.5 border-b border-zinc-800/60 pb-5">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Find your next opportunity in India
          </h1>
          <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
            Entry-level positions, internships, and new graduate roles sourced directly
            from verified company ATS feeds across Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee, and Pinpoint.
          </p>
        </section>

        {/* Refresh Observability Status Bar */}
        <section aria-label="Refresh and sync status">
          <RefreshStatusBar
            lastRefreshedAt={lastRefreshedAt}
            isRefreshing={isRefreshing}
            refreshProgress={refreshProgress}
            latestRecord={latestRecord}
            totalActiveJobs={total}
            freshnessDistribution={freshnessDistribution}
            onRefreshClick={handleManualRefresh}
          />
        </section>

        {/* Search & Discrete Filters Area */}
        <section aria-label="Search and filter jobs">
          <JobFilters
            filters={filters}
            availableFilters={availableFilters}
            onFilterChange={handleFilterChange}
            onReset={handleResetFilters}
          />
        </section>

        {/* View Mode Tabs: Available Feed vs Applied Jobs */}
        <section aria-label="View selection" className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <button
            type="button"
            onClick={() => handleTabChange("available")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors",
              activeTab === "available"
                ? "bg-zinc-100 text-zinc-950 font-semibold shadow-sm"
                : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800"
            )}
          >
            <span>Available Opportunities</span>
            {activeTab === "available" && total > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-300 text-zinc-900 font-bold">
                {total}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange("applied")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors",
              activeTab === "applied"
                ? "bg-zinc-100 text-zinc-950 font-semibold shadow-sm"
                : "bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800"
            )}
          >
            <CheckCircle2 className="size-3.5 text-emerald-400" />
            <span>Applied Jobs</span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-bold",
                appliedIds.length > 0
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800/80"
                  : "bg-zinc-800 text-zinc-400"
              )}
            >
              {appliedIds.length}
            </span>
          </button>
        </section>

        {/* Results Metadata & Sorting */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-400 border-b border-zinc-800/50 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-zinc-200">
              {isLoading ? (
                "Loading opportunities..."
              ) : total === 0 ? (
                activeTab === "applied" ? "0 applied jobs" : "0 opportunities"
              ) : (
                <>
                  Showing {startRecord}–{endRecord} of {total}{" "}
                  {activeTab === "applied"
                    ? total === 1
                      ? "applied job"
                      : "applied jobs"
                    : total === 1
                    ? "opportunity"
                    : "opportunities"}
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort-select" className="text-zinc-500 shrink-0">
              Sort by:
            </label>
            <select
              id="sort-select"
              value={filters.sort}
              onChange={(e) => {
                setFilters({ ...filters, sort: e.target.value });
                setPage(1);
              }}
              className="h-7 rounded border border-zinc-800 bg-zinc-900/60 px-2 text-xs text-zinc-300 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            >
              <option value="recent">Most recent</option>
              <option value="relevance">Most relevant (AI ranked)</option>
              <option value="company">Company (A-Z)</option>
            </select>
          </div>
        </section>

        {/* Job Listings / States */}
        <section aria-label="Job listings" className="space-y-3 min-h-[300px]">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 p-4 sm:p-5 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-3.5 w-24 bg-zinc-800" />
                    <Skeleton className="h-3.5 w-16 bg-zinc-800" />
                  </div>
                  <Skeleton className="h-5 w-3/4 sm:w-1/2 bg-zinc-800" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-4 w-16 bg-zinc-800 rounded" />
                    <Skeleton className="h-4 w-20 bg-zinc-800 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center space-y-3">
              <AlertCircle className="size-8 mx-auto text-zinc-500" />
              <div className="space-y-1">
                <h3 className="font-medium text-sm text-zinc-200">
                  Unable to load opportunities
                </h3>
                <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                  {error} Please try refreshing or checking back shortly.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchJobs}
                className="h-8 px-3 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                <RefreshCw className="size-3 mr-1.5" />
                Retry
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/20 py-16 px-4 text-center space-y-3">
              <div className="size-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
                {activeTab === "applied" ? (
                  <CheckCircle2 className="size-5 text-emerald-400" />
                ) : (
                  <Inbox className="size-5" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="font-medium text-sm text-zinc-200">
                  {activeTab === "applied"
                    ? "No applied jobs yet"
                    : "No opportunities found"}
                </h3>
                <p className="text-xs text-zinc-500 max-w-md mx-auto">
                  {activeTab === "applied"
                    ? "When you click 'Apply' on any job listing in this session, it will be moved here so you can easily track your applications."
                    : hasActiveFilters
                    ? "Try adjusting your search terms or clearing specific filters to see more results."
                    : "No fresher or internship opportunities in India matching your criteria are currently active. Listings update automatically during scheduled refreshes."}
                </p>
              </div>
              {hasActiveFilters && (
                <div className="pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResetFilters}
                    className="h-8 px-3 text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  >
                    Reset all filters
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  isApplied={appliedIds.includes(job.id)}
                  onApply={handleApply}
                  onUnapply={handleUnapply}
                />
              ))}
            </div>
          )}
        </section>

        {/* Pagination Section (Strict 10 records per page) */}
        {!isLoading && totalPages > 1 && (
          <nav
            aria-label="Pagination Navigation"
            className="flex items-center justify-between border-t border-zinc-800/60 pt-4 text-xs text-zinc-400"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="h-8 px-3 text-xs border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <ChevronLeft className="size-3.5" />
              Previous
            </Button>

            <span className="font-medium text-zinc-300">
              Page {page} of {totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="h-8 px-3 text-xs border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              Next
              <ChevronRight className="size-3.5" />
            </Button>
          </nav>
        )}
      </main>

      <Footer />
    </div>
  );
}
