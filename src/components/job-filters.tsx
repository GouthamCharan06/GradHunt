"use client";

import React from "react";
import { Search, X, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ROLE_TAXONOMY } from "@/lib/types/job";

export interface FilterState {
  search: string;
  country: string;
  city: string;
  workMode: string;
  role: string;
  company: string;
  source: string;
  jobType: string;
  isFresherOnly: boolean;
  sort: string;
  maxAgeDays?: number;
}

export interface AvailableFilters {
  countries: string[];
  cities: string[];
  workModes: string[];
  roles: string[];
  clusters?: string[];
  companies?: string[];
  sources?: string[];
  jobTypes: string[];
}

interface JobFiltersProps {
  filters: FilterState;
  availableFilters?: AvailableFilters;
  onFilterChange: (newFilters: FilterState) => void;
  onReset: () => void;
}

function formatWorkModeDisplay(mode: string): string {
  switch (mode.toLowerCase()) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "on-site":
      return "On-site";
    default:
      return mode.charAt(0).toUpperCase() + mode.slice(1);
  }
}

function formatSourceDisplay(source: string): string {
  switch (source.toLowerCase()) {
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
    case "ashby":
      return "Ashby";
    case "smartrecruiters":
      return "SmartRecruiters";
    case "recruitee":
      return "Recruitee";
    case "pinpoint":
      return "Pinpoint";
    default:
      return source.charAt(0).toUpperCase() + source.slice(1);
  }
}

export function JobFilters({
  filters,
  availableFilters,
  onFilterChange,
  onReset,
}: JobFiltersProps) {
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Keyboard shortcut to focus search input with "/"
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const hasActiveFilters =
    Boolean(filters.search) ||
    filters.city !== "all" ||
    filters.workMode !== "all" ||
    filters.role !== "all" ||
    filters.company !== "all" ||
    filters.source !== "all" ||
    filters.jobType !== "all" ||
    filters.isFresherOnly ||
    (filters.maxAgeDays !== undefined && filters.maxAgeDays !== 90);

  // Real cities present in the dataset
  const cities = availableFilters?.cities ?? [];
  // Real companies dynamically present in the dataset
  const companies = availableFilters?.companies ?? [];
  // Real work modes present in the dataset
  const workModes = availableFilters?.workModes ?? ["on-site", "hybrid", "remote"];
  // Real job types present in the dataset
  const jobTypes = availableFilters?.jobTypes ?? ["full-time", "internship", "contract"];
  // Real sources
  const sources = availableFilters?.sources ?? [
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "recruitee",
    "pinpoint",
  ];
  // Real roles dynamically present in the dataset
  const roles =
    availableFilters?.roles && availableFilters.roles.length > 0
      ? availableFilters.roles
      : Array.from(ROLE_TAXONOMY);

  return (
    <div className="space-y-3">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-500 pointer-events-none" />
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Search by role, company, or keyword... (Press / to focus)"
          value={filters.search}
          onChange={(e) =>
            onFilterChange({ ...filters, search: e.target.value })
          }
          className="h-11 pl-10 pr-9 bg-zinc-900/60 border-zinc-800 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-1 focus-visible:ring-zinc-400 focus-visible:border-zinc-700 transition-colors rounded-lg"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => onFilterChange({ ...filters, search: "" })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5 rounded"
            aria-label="Clear search text"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Discrete Filter Controls: City, Role, Company, Work mode, Job type, Source */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
        {/* 1. City Control (Derived from real Indian dataset) */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">City</label>
          <select
            value={filters.city}
            onChange={(e) =>
              onFilterChange({ ...filters, city: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by city"
          >
            <option value="all">All Cities</option>
            {cities.map((c) => (
              <option key={c} value={c.toLowerCase()}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Role Control */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">Role</label>
          <select
            value={filters.role}
            onChange={(e) =>
              onFilterChange({ ...filters, role: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by role"
          >
            <option value="all">All Roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* 3. Company Control */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">Company</label>
          <select
            value={filters.company}
            onChange={(e) =>
              onFilterChange({ ...filters, company: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by company"
          >
            <option value="all">All Companies</option>
            {companies.map((comp) => (
              <option key={comp} value={comp.toLowerCase()}>
                {comp}
              </option>
            ))}
          </select>
        </div>

        {/* 4. Work Mode Control */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">Work mode</label>
          <select
            value={filters.workMode}
            onChange={(e) =>
              onFilterChange({ ...filters, workMode: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by work mode"
          >
            <option value="all">All Work Modes</option>
            {workModes.map((wm) => (
              <option key={wm} value={wm.toLowerCase()}>
                {formatWorkModeDisplay(wm)}
              </option>
            ))}
          </select>
        </div>

        {/* 5. Job Type Control */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">Job type</label>
          <select
            value={filters.jobType}
            onChange={(e) =>
              onFilterChange({ ...filters, jobType: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by job type"
          >
            <option value="all">All Job Types</option>
            <option value="internship">Internship</option>
            <option value="full-time">Full-time</option>
            <option value="contract">Contract</option>
            <option value="part-time">Part-time</option>
          </select>
        </div>

        {/* 6. Source Provider Control */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-zinc-400">Source</label>
          <select
            value={filters.source}
            onChange={(e) =>
              onFilterChange({ ...filters, source: e.target.value })
            }
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 text-xs text-zinc-200 hover:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400"
            aria-label="Filter by source"
          >
            <option value="all">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s.toLowerCase()}>
                {formatSourceDisplay(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Secondary Row: Quick Toggles and Reset */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-zinc-800/60 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Fresher/Intern Signal Toggle */}
          <button
            type="button"
            onClick={() =>
              onFilterChange({
                ...filters,
                isFresherOnly: !filters.isFresherOnly,
              })
            }
            className={`h-7 px-2.5 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1.5 ${
              filters.isFresherOnly
                ? "bg-emerald-950/70 border-emerald-700 text-emerald-300"
                : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
            }`}
          >
            Fresher / Intern Only
          </button>

          {/* Active Feed Freshness Selector */}
          <div className="inline-flex items-center gap-1.5 text-zinc-400">
            <span className="text-[11px]">Active window:</span>
            <select
              value={filters.maxAgeDays ?? 90}
              onChange={(e) =>
                onFilterChange({
                  ...filters,
                  maxAgeDays: parseInt(e.target.value, 10),
                })
              }
              className="h-7 rounded border border-zinc-800 bg-zinc-900/70 px-2 text-xs text-zinc-300 focus:outline-none"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days (Default)</option>
              <option value="365">All Active</option>
            </select>
          </div>
        </div>

        {/* Reset Active Filters */}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
          >
            <RotateCcw className="size-3" />
            Reset filters
          </Button>
        )}
      </div>
    </div>
  );
}
