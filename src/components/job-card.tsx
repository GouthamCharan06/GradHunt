import React from "react";
import { Job } from "@/lib/types/job";
import { buttonVariants } from "@/components/ui/button";
import { MapPin, ExternalLink, Building2, Clock, CheckCircle2, Undo2 } from "lucide-react";
import { cn } from "cn";

interface JobCardProps {
  job: Job;
  isApplied?: boolean;
  onApply?: (job: Job) => void;
  onUnapply?: (job: Job) => void;
}

function formatRelativeTime(dateString: string): string {
  try {
    const published = new Date(dateString).getTime();
    const now = Date.now();
    const diffHours = Math.floor((now - published) / (1000 * 60 * 60));

    if (diffHours < 1) {
      const diffMinutes = Math.floor((now - published) / (1000 * 60));
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? "1d ago" : `${diffDays}d ago`;
  } catch {
    return "Recently";
  }
}

function getSourceLabel(source: Job["source"]): string {
  switch (source) {
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
  }
}

function formatWorkModeLabel(workMode: Job["workMode"]): string {
  switch (workMode) {
    case "remote":
      return "Remote";
    case "hybrid":
      return "Hybrid";
    case "on-site":
      return "On-site";
    default:
      return "";
  }
}

export function JobCard({ job, isApplied, onApply, onUnapply }: JobCardProps) {
  const relativeTime = formatRelativeTime(job.postedAt || job.publishedAt);
  const sourceLabel = getSourceLabel(job.source);
  const workModeLabel = formatWorkModeLabel(job.workMode);
  const displayLocation = job.rawLocation || `${job.city}, India`;

  const handleApplyClick = () => {
    if (onApply) {
      onApply(job);
    }
  };

  return (
    <article className="group relative rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-4 sm:p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        {/* Left Column: Details */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {/* Header Row: Company, Location, Time */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200 flex items-center gap-1.5 truncate">
              <Building2 className="size-3.5 text-zinc-500 shrink-0" />
              {job.company}
            </span>

            <span className="text-zinc-600">•</span>

            <span className="flex items-center gap-1 truncate text-zinc-300">
              <MapPin className="size-3 text-zinc-500 shrink-0" />
              {displayLocation}
            </span>

            <span className="text-zinc-600">•</span>

            <span className="text-zinc-400 inline-flex items-center gap-1 font-medium">
              <Clock className="size-3 text-zinc-500 shrink-0" />
              {relativeTime}
            </span>

            {isApplied && (
              <>
                <span className="text-zinc-600">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="size-3" />
                  Applied in this session
                </span>
              </>
            )}
          </div>

          {/* Job Title */}
          <div>
            <h3 className="font-semibold text-base sm:text-lg text-zinc-100 group-hover:text-white tracking-tight leading-snug">
              <a
                href={job.applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleApplyClick}
                className="hover:underline focus:outline-none focus:ring-1 focus:ring-zinc-400 rounded-sm"
              >
                {job.title}
              </a>
            </h3>
          </div>

          {/* Metadata Badges & Tags */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {/* Work Mode Tag */}
            {workModeLabel && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                {workModeLabel}
              </span>
            )}

            {/* Job Type */}
            {job.jobType && job.jobType !== "unknown" && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                {job.jobType === "internship" ? "Internship" : job.jobType}
              </span>
            )}

            {/* Experience Range */}
            {job.experienceRange && job.experienceRange !== "unknown" && job.experienceRange !== "internship" && job.experienceRange !== "experienced" && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-800/80 text-zinc-300 border border-zinc-700/60">
                {job.experienceRange} YOE
              </span>
            )}

            {/* Role Taxonomy or Normalized Role */}
            {job.normalized_role && job.normalized_role !== job.title && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-800/90 text-zinc-200 border border-zinc-700/80">
                {job.normalized_role}
              </span>
            )}

            {/* AI Classification Status Badges */}
            {job.classificationStatus === "llm_failed" && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-amber-950/40 text-amber-300 border border-amber-900/50">
                AI classification unavailable
              </span>
            )}

            {/* Fresher Candidate Indicator */}
            {job.isFresherEligible && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
                {job.jobType === "internship" ? "Internship" : "Fresher / Entry"}
              </span>
            )}

            {/* Skills extracted by LLM */}
            {job.skills && job.skills.length > 0 && (
              <>
                {job.skills.slice(0, 3).map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-950/40 text-blue-300 border border-blue-900/50"
                  >
                    {s}
                  </span>
                ))}
              </>
            )}

            {/* Mobile-only time display */}
            <span className="sm:hidden text-xs text-zinc-500 ml-auto flex items-center gap-1">
              {relativeTime}
            </span>
          </div>
        </div>

        {/* Right Column: Actions & Provenance */}
        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800/50">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {isApplied && onUnapply && (
              <button
                type="button"
                onClick={() => onUnapply(job)}
                title="Move back to unapplied opportunities"
                className="h-8 px-2.5 text-xs font-medium border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-md transition-colors inline-flex items-center gap-1"
              >
                <Undo2 className="size-3" />
                Unmark
              </button>
            )}

            <a
              href={job.applicationUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleApplyClick}
              aria-label={`Apply to ${job.title} at ${job.company}`}
              className={cn(
                buttonVariants({ size: "sm" }),
                isApplied
                  ? "w-full sm:w-auto h-8 px-3.5 text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors rounded-md inline-flex items-center justify-center gap-1.5"
                  : "w-full sm:w-auto h-8 px-3.5 text-xs font-medium bg-zinc-100 text-zinc-900 hover:bg-white hover:text-black transition-colors rounded-md inline-flex items-center justify-center gap-1.5"
              )}
            >
              {isApplied ? "Applied" : "Apply"}
              <ExternalLink className="size-3 opacity-70" />
            </a>
          </div>

          <span className="text-[11px] text-zinc-500 hidden sm:inline-block">
            via {sourceLabel}
          </span>
        </div>
      </div>
    </article>
  );
}
