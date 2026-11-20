/**
 * GradHunt — Phase 2 Live Verification Script
 *
 * Runs all 4 source adapters against their real endpoints and
 * produces a diagnostic report. Execute with:
 *   node --loader ts-node/esm src/lib/adapters/verify.ts
 * Or via the /api/refresh endpoint.
 */

import { fetchAllSources } from "./index";

async function main() {
  console.log("=".repeat(70));
  console.log(" GradHunt — Phase 2 Live Source Verification");
  console.log("=".repeat(70));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("");

  const result = await fetchAllSources();

  console.log("");
  console.log("=".repeat(70));
  console.log(" VERIFICATION REPORT");
  console.log("=".repeat(70));
  console.log("");

  for (const diag of result.diagnostics) {
    console.log(`── ${diag.source.toUpperCase()} ${"─".repeat(50 - diag.source.length)}`);
    console.log(`  Total Records:      ${diag.totalRecords}`);
    console.log(`  With Usable ID:     ${diag.withUsableId}`);
    console.log(`  With Timestamp:     ${diag.withTimestamp}`);
    console.log(`  With Apply URL:     ${diag.withApplicationUrl}`);
    console.log(`  With Description:   ${diag.withDescription}`);
    console.log(`  Boards Attempted:   ${diag.boardsAttempted}`);
    console.log(`  Boards Succeeded:   ${diag.boardsSucceeded}`);
    console.log(`  Boards Failed:      ${diag.boardsFailed}`);
    console.log(`  Duration:           ${diag.durationMs}ms`);
    if (diag.errors.length > 0) {
      console.log(`  Errors:`);
      for (const err of diag.errors) {
        console.log(`    - ${err}`);
      }
    }
    console.log("");
  }

  console.log("── TOTALS ──────────────────────────────────────────────");
  console.log(`  Total Records:  ${result.totalRecords}`);
  console.log(`  Total Errors:   ${result.totalErrors}`);
  console.log(`  Total Duration: ${result.durationMs}ms`);
  console.log("=".repeat(70));

  // Print a few sample records per source
  console.log("");
  console.log("── SAMPLE RECORDS ──────────────────────────────────────");

  if (result.greenhouse.records.length > 0) {
    const s = result.greenhouse.records[0];
    console.log(`  [Greenhouse] "${s.title}" at ${s._company} | ${s.location?.name} | URL: ${s.absolute_url?.substring(0, 60)}...`);
  }
  if (result.lever.records.length > 0) {
    const s = result.lever.records[0];
    console.log(`  [Lever] "${s.text}" at ${s._companySlug} | ${s.categories?.location} | URL: ${s.hostedUrl?.substring(0, 60)}...`);
  }
  if (result.ashby.records.length > 0) {
    const s = result.ashby.records[0];
    console.log(`  [Ashby] "${s.title}" at ${s._company} | ${s.location} | URL: ${s.jobUrl?.substring(0, 60)}...`);
  }
  if (result.smartrecruiters.records.length > 0) {
    const s = result.smartrecruiters.records[0];
    console.log(`  [SmartRecruiters] "${s.name}" at ${s._companySlug} | ${s.location?.city} | ID: ${s.id}`);
  }
  if (result.recruitee.records.length > 0) {
    const s = result.recruitee.records[0];
    console.log(`  [Recruitee] "${s.title}" at ${s._company} | ${s.city} | ID: ${s.id}`);
  }
  if (result.pinpoint.records.length > 0) {
    const s = result.pinpoint.records[0];
    console.log(`  [Pinpoint] "${s.title}" at ${s._company} | ${s.location?.city} | URL: ${s.url?.substring(0, 60)}...`);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
