/**
 * GradHunt — Deduplication Tests
 *
 * Tests Step 5 deduplication:
 * - Exact source deduplication (same source and sourceJobId)
 * - Cross-source deduplication (same company, title, city)
 * - Retention of newest timestamp
 */

import { deduplicateJobs } from "../dedup";
import { makeDedupKey, makeCrossDedupKey } from "../normalize";
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

function makeJob(id: string, company: string, title: string, city: string, publishedAt: string): Job {
  return {
    id,
    source: "greenhouse",
    sourceJobId: id,
    title,
    company,
    city,
    country: "India",
    workMode: "on-site",
    rawLocation: city,
    isRemote: false,
    publishedAt,
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://example.com/jobs/${id}`,
    applicationUrl: `https://example.com/apply/${id}`,
    description: "Sample description",
    isFresherCandidate: true,
    isFresherEligible: true,
    isActive: true,
    experienceLevel: "entry",
    jobType: "full-time",
    dedupKey: makeDedupKey("greenhouse", id),
    crossDedupKey: makeCrossDedupKey(company, title, city),
  };
}

console.log("=== Running Deduplication Engine Tests ===");

// 1. No duplicates in distinct list
const uniqueList = [
  makeJob("1", "Rubrik", "Software Engineer Intern", "Bengaluru", "2026-11-18T10:00:00Z"),
  makeJob("2", "Stripe", "Software Engineer, Intern", "Bengaluru", "2026-11-18T11:00:00Z"),
  makeJob("3", "Gitlab", "Junior QA Engineer", "Bengaluru", "2026-11-18T12:00:00Z"),
];
const res1 = deduplicateJobs(uniqueList);
assert(res1.deduplicated.length === 3, "Retains all 3 unique jobs");
assert(res1.duplicatesRemoved === 0, "Zero duplicates removed for unique list");

// 2. Exact DedupKey duplicate
const exactDupList = [
  makeJob("1", "Rubrik", "Software Engineer Intern", "Bengaluru", "2026-11-18T10:00:00Z"),
  makeJob("1", "Rubrik", "Software Engineer Intern", "Bengaluru", "2026-11-18T10:00:00Z"),
];
const res2 = deduplicateJobs(exactDupList);
assert(res2.deduplicated.length === 1, "Deduplicates exact source ID duplicate");
assert(res2.duplicatesRemoved === 1, "Reports 1 duplicate removed");

// 3. Cross-source duplicate (same company, title, and city with different IDs)
const olderJob = makeJob("gh-101", "Acme", "Frontend Intern", "Bengaluru", "2026-11-17T10:00:00Z");
const newerJob = makeJob("lv-202", "Acme", "Frontend Intern", "Bengaluru", "2026-11-18T15:00:00Z");
newerJob.source = "lever";
newerJob.dedupKey = makeDedupKey("lever", "lv-202");

const crossList = [olderJob, newerJob];
const res3 = deduplicateJobs(crossList);
assert(res3.deduplicated.length === 1, "Deduplicates cross-source duplicate");
assert(res3.duplicatesRemoved === 1, "Reports 1 cross-source duplicate removed");
assert(res3.deduplicated[0].id === "lv-202", "Retains the newer posting timestamp");

console.log(`\nAll ${passed}/${total} Deduplication tests passed successfully!\n`);
