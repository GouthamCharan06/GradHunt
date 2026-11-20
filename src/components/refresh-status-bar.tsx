"use client";

import React, { useState } from "react";
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Database, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { RefreshRunRecord, FreshnessDistribution, JobSource } from "@/lib/types/job";

interface RefreshStatusBarProps {
  lastRefreshedAt: string | null;
  isRefreshing: boolean;
  refreshProgress?: string | null;
  latestRecord?: RefreshRunRecord | null;
  totalActiveJobs: number;
  freshnessDistribution?: FreshnessDistribution;
  onRefreshClick: () => void;
}

const PROVIDERS: { id: JobSource; label: string }[] = [
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever", label: "Lever" },
  { id: "ashby", label: "Ashby" },
  { id: "smartrecruiters", label: "SmartRecruiters" },
  { id: "recruitee", label: "Recruitee" },
  { id: "pinpoint", label: "Pinpoint" },
];

export function RefreshStatusBar({
  lastRefreshedAt,
  isRefreshing,
  refreshProgress,
  latestRecord,
  totalActiveJobs,
  freshnessDistribution,
  onRefreshClick,
}: RefreshStatusBarProps) {
  const [showDetails, setShowDetails] = useState(false);

  // Calculate relative time
  const lastRefreshedText = React.useMemo(() => {
    if (!lastRefreshedAt) return "Not refreshed yet";
    try {
      const diffMs = Date.now() - new Date(lastRefreshedAt).getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return "Just refreshed";
      if (diffMins < 60) return `Refreshed ${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      const remMins = diffMins % 60;
      return `Refreshed ${diffHours}h ${remMins}m ago`;
    } catch {
      return "Recently refreshed";
    }
  }, [lastRefreshedAt]);

  // Calculate next 6-hour refresh estimate
  const nextRefreshText = React.useMemo(() => {
    if (!lastRefreshedAt) return "Next in ~6h";
    try {
      const lastTime = new Date(lastRefreshedAt).getTime();
      const nextTime = lastTime + 6 * 60 * 60 * 1000;
      const diffMs = nextTime - Date.now();
      if (diffMs <= 0) return "Next refresh due";
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `Next in ~${hours}h ${mins}m`;
    } catch {
      return "Next in ~6h";
    }
  }, [lastRefreshedAt]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 sm:p-4 text-xs text-zinc-300 space-y-3">
      {/* Top summary row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Active indicator */}
          <div className="flex items-center gap-1.5 font-medium text-zinc-200">
            <span className="relative flex h-2 w-2">
              {isRefreshing ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              )}
            </span>
            <span>{totalActiveJobs} Active Opportunities</span>
          </div>

          <span className="text-zinc-600 hidden sm:inline">•</span>

          {/* Timestamps */}
          <div className="flex items-center gap-1 text-zinc-400">
            <Clock className="size-3.5" />
            <span>{lastRefreshedText}</span>
            <span className="text-zinc-600">({nextRefreshText})</span>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="h-7 px-2 rounded border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 transition-colors"
          >
            <Database className="size-3" />
            <span className="hidden sm:inline">Refresh Details</span>
            {showDetails ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>

          <button
            type="button"
            onClick={onRefreshClick}
            disabled={isRefreshing}
            className={`h-7 px-2.5 rounded font-medium inline-flex items-center gap-1.5 transition-colors ${
              isRefreshing
                ? "bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed"
                : "bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 hover:bg-emerald-900/90 hover:text-emerald-200"
            }`}
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>{isRefreshing ? "Synchronizing..." : "Refresh Now"}</span>
          </button>
        </div>
      </div>

      {/* Progress alert when refresh is running */}
      {isRefreshing && (
        <div className="rounded-md bg-zinc-950/80 border border-emerald-900/40 p-2.5 text-emerald-300/90 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-3.5 animate-spin" />
            <span>{refreshProgress || "Synchronizing 6 ATS providers & evaluating AI classifications..."}</span>
          </div>
          <span className="text-[11px] text-zinc-400">Background task</span>
        </div>
      )}

      {/* Provider Status Badges */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-zinc-800/50">
        <span className="text-[11px] text-zinc-500 mr-1">Providers:</span>
        {PROVIDERS.map((p) => {
          const provResult = latestRecord?.providerResults?.[p.id];
          const hasError = provResult?.status === "error";
          const count = provResult?.fetchedCount ?? null;

          return (
            <span
              key={p.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border ${
                hasError
                  ? "border-amber-800/50 bg-amber-950/30 text-amber-300"
                  : "border-zinc-800 bg-zinc-950/60 text-zinc-300"
              }`}
            >
              <span className={`size-1.5 rounded-full ${hasError ? "bg-amber-400" : "bg-emerald-400"}`} />
              {p.label}
              {count !== null && <span className="text-zinc-500">({count})</span>}
            </span>
          );
        })}
      </div>

      {/* Detailed collapsible drawer */}
      {showDetails && (
        <div className="pt-2 border-t border-zinc-800/70 space-y-3">
          {/* Latest Run Metrics */}
          {latestRecord && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-950/70 p-2.5 rounded border border-zinc-800/80 text-[11px]">
              <div>
                <span className="text-zinc-500 block">Ingestion Run</span>
                <span className="font-mono text-zinc-300">{latestRecord.id} ({Math.round(latestRecord.durationMs / 1000)}s)</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Dataset Delta</span>
                <span className="text-emerald-400">+{latestRecord.counts.newlyAdded} new</span>
                <span className="text-zinc-400"> / {latestRecord.counts.updated} updated</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Gemini Evaluations</span>
                <span className="text-zinc-300">{latestRecord.llm.invoked} invoked, {latestRecord.llm.cached} cached</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Est. LLM Cost</span>
                <span className="font-mono text-emerald-400">${latestRecord.llm.estimatedCostUsd.toFixed(5)}</span>
              </div>
            </div>
          )}

          {/* Age Distribution Breakdown */}
          {freshnessDistribution && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium text-zinc-400 block">Active Feed Freshness Distribution:</span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                <div className="bg-zinc-950/50 p-2 rounded border border-zinc-800/60 text-center">
                  <span className="text-emerald-400 font-semibold block">{freshnessDistribution["0-7d"]}</span>
                  <span className="text-zinc-500 text-[10px]">0–7 days (Fresh)</span>
                </div>
                <div className="bg-zinc-950/50 p-2 rounded border border-zinc-800/60 text-center">
                  <span className="text-zinc-200 font-semibold block">{freshnessDistribution["8-30d"]}</span>
                  <span className="text-zinc-500 text-[10px]">8–30 days</span>
                </div>
                <div className="bg-zinc-950/50 p-2 rounded border border-zinc-800/60 text-center">
                  <span className="text-zinc-300 font-semibold block">{freshnessDistribution["31-60d"]}</span>
                  <span className="text-zinc-500 text-[10px]">31–60 days</span>
                </div>
                <div className="bg-zinc-950/50 p-2 rounded border border-zinc-800/60 text-center">
                  <span className="text-zinc-400 font-semibold block">{freshnessDistribution["61-90d"]}</span>
                  <span className="text-zinc-500 text-[10px]">61–90 days</span>
                </div>
                <div className="bg-zinc-950/50 p-2 rounded border border-zinc-800/60 text-center">
                  <span className="text-zinc-500 font-semibold block">{freshnessDistribution["90d+"]}</span>
                  <span className="text-zinc-500 text-[10px]">90+ days (Retained)</span>
                </div>
              </div>
              {freshnessDistribution.oldestPostingDate && (
                <div className="text-[10px] text-zinc-500 flex justify-between pt-1">
                  <span>Newest: {new Date(freshnessDistribution.newestPostingDate || "").toLocaleDateString()}</span>
                  <span>Oldest active on ATS: {new Date(freshnessDistribution.oldestPostingDate).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
