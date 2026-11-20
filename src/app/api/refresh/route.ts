/**
 * GradHunt — /api/refresh
 *
 * Handles:
 * 1. 6-Hour Vercel Cron triggers: GET /api/refresh (schedule: 0 every 6 hours)
 * 2. Manual dashboard refresh triggers: POST /api/refresh
 * 3. Status checks: GET /api/refresh?status=true
 *
 * Records real RefreshRunRecords and maintains complete provider and LLM audit metrics.
 */

import { NextRequest, NextResponse } from "next/server";
import { executeFullRefresh, triggerBackgroundRefresh } from "@/lib/pipeline/orchestrator";
import { getStoreStatus, getLatestRefreshRun, getRecentRefreshRuns } from "@/lib/store";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;

  // Status-only check
  if (searchParams.get("status") === "true") {
    const storeStatus = getStoreStatus();
    return NextResponse.json({
      success: true,
      storeStatus,
      latestRun: getLatestRefreshRun(),
      recentRuns: getRecentRefreshRuns(),
    });
  }

  // Non-blocking async trigger
  if (searchParams.get("async") === "true") {
    triggerBackgroundRefresh("manual");
    return NextResponse.json({
      success: true,
      message: "Refresh triggered in background",
      status: "running",
    });
  }

  try {
    const shouldClearCache = searchParams.get("clearCache") === "true";
    const result = await executeFullRefresh("manual", { clearCache: shouldClearCache });

    return NextResponse.json({
      success: true,
      message: "Refresh completed successfully",
      runRecord: result.runRecord,
      summary: {
        totalActive: result.persistentStats.totalActive,
        newlyAdded: result.persistentStats.newlyAdded,
        updated: result.persistentStats.updated,
        retainedUnchanged: result.persistentStats.retainedUnchanged,
        removedUnavailable: result.persistentStats.removedUnavailable,
      },
      counts: result.pipeline.counts,
      indiaMetrics: result.pipeline.indiaMetrics,
      llmMetrics: result.pipeline.llmMetrics,
      geminiUsage: result.pipeline.usage,
      freshnessDistribution: result.persistentStats.freshnessDistribution,
      totalDurationMs: Date.now() - startTime,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Refresh failed";
    console.error("[/api/refresh] Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Refresh failed",
        error: errorMsg,
        totalDurationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * GET handler: supports Vercel Cron 6-hour schedule
 * and query param inspection.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  if (searchParams.get("status") === "true") {
    const storeStatus = getStoreStatus();
    return NextResponse.json({
      success: true,
      storeStatus,
      latestRun: getLatestRefreshRun(),
      recentRuns: getRecentRefreshRuns(),
    });
  }

  // Check Vercel Cron header or execute as scheduled cron
  const isVercelCron = Boolean(
    request.headers.get("x-vercel-cron") ||
    request.headers.get("user-agent")?.includes("vercel-cron")
  );

  const trigger = isVercelCron ? "cron" : "manual";

  // Optional CRON_SECRET verification if configured in production
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && isVercelCron) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized cron request" }, { status: 401 });
    }
  }

  // For cron or direct GET, execute full refresh
  try {
    const shouldClearCache = searchParams.get("clearCache") === "true";
    const result = await executeFullRefresh(trigger, { clearCache: shouldClearCache });

    return NextResponse.json({
      success: true,
      trigger,
      message: "Scheduled refresh completed",
      runRecord: result.runRecord,
      totalActive: result.persistentStats.totalActive,
      durationMs: result.totalDurationMs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        trigger,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
