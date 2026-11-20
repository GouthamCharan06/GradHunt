/**
 * GradHunt — Rolling Store Tests
 *
 * Tests Step 5:
 * - Rolling window ingestion
 * - Purging stale jobs older than window
 * - Merging and deduplicating new jobs
 * - Retaining active jobs across runs
 */

import { ingestRollingJobs, getStoredJobs, setStoredJobs } from "../../store";
import { Job } from "../../types/job";

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string) {
  total++;
  if (!condition) {
    console.error(`  FAIL: ${testName}`);
    throw new Error(`Test failed: ${testName}`);
  }
  passed++;
  console.log(`  PASS: ${testName}`);
}

function makeJob(id: string, publishedAt: string, company: string = "Acme"): Job {
  return {
    id: `gh::${id}`,
    source: "greenhouse",
    sourceJobId: id,
    title: "Software Engineer Intern",
    company,
    city: "Bengaluru",
    country: "India",
    workMode: "on-site",
    rawLocation: "Bengaluru",
    isRemote: false,
    publishedAt,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://example.com/jobs/${id}`,
    applicationUrl: `https://example.com/apply/${id}`,
    description: "Write code",
    isFresherCandidate: true,
    isFresherEligible: true,
    isActive: true,
    experienceLevel: "intern",
    jobType: "internship",
    dedupKey: `dedup_${id}`,
    crossDedupKey: `${company}|software engineer intern|bengaluru`,
  };
}

console.log("=== Running Rolling Window Store Tests ===");

const now = new Date("2026-11-18T12:00:00Z");

// Reset store to known state
setStoredJobs([]);

// 1. Initial Ingestion
const initialJobs = [
  makeJob("1", "2026-11-18T10:00:00Z", "Rubrik"), // 2h old
  makeJob("2", "2026-11-18T06:00:00Z", "Stripe"), // 6h old
];
const stats1 = ingestRollingJobs(initialJobs, now, 24);

assert(stats1.newlyAdded === 2, "Added 2 new jobs initially");
assert(getStoredJobs().length === 2, "Store holds 2 jobs");

// 2. Next run 2 hours later with 1 new job and 1 existing job
const laterNow = new Date("2026-11-18T14:00:00Z");
const run2Jobs = [
  makeJob("1", "2026-11-18T10:00:00Z", "Rubrik"), // still fresh (4h old)
  makeJob("3", "2026-11-18T13:30:00Z", "Gitlab"), // new job (0.5h old)
];

const stats2 = ingestRollingJobs(run2Jobs, laterNow, 24);
assert(stats2.newlyAdded === 1, "Added 1 new job (Gitlab)");
assert(stats2.updated === 1, "Updated 1 existing job (Rubrik)");
assert(stats2.retainedFromPrevious === 2, "Retained both Rubrik and Stripe from previous store");
assert(getStoredJobs().length === 3, "Store now holds 3 unique jobs");

// 3. Purging stale jobs older than 24 hours
const nextDay = new Date("2026-11-19T13:00:00Z"); // 25 hours later
// At this point, job 2 (from 2026-11-18T06:00) is 31h old -> expired!
// job 1 (from 2026-11-18T10:00) is 27h old -> expired!
// job 3 (from 2026-11-18T13:30) is 23.5h old -> still fresh!
const run3Jobs = [
  makeJob("4", "2026-11-19T12:00:00Z", "Anyscale"), // 1h old
];

const stats3 = ingestRollingJobs(run3Jobs, nextDay, 24);
assert(stats3.expiredCount === 2, "Purged 2 stale jobs older than 24h window");
assert(stats3.retainedFromPrevious === 1, "Retained 1 still-fresh job from previous run (job 3)");
assert(getStoredJobs().length === 2, "Store holds 2 jobs (job 3 and job 4)");

console.log(`\nAll ${passed}/${total} Rolling Window Store tests passed successfully!\n`);
