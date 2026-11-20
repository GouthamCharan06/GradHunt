/**
 * GradHunt — LLM & Taxonomy Classification Tests
 *
 * Tests Steps 8, 9, 10, 11:
 * - Controlled taxonomy matching
 * - Deterministic role mapping
 * - Indian city normalization
 * - Caching behavior (hash based)
 * - Provider fallback on error
 */

import {
  ROLE_TAXONOMY,
  classifyRoleDeterministically,
  normalizeIndianCity,
  normalizeWorkMode,
} from "../taxonomy";
import {
  getCachedClassification,
  setCachedClassification,
  computeJobContentHash,
  clearClassificationCache,
} from "../cache";
import { classifyJob, setClassificationProvider } from "../classifier";
import { ClassificationProvider, JobClassification } from "../types";
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

function makeJob(title: string, city: string = "Bengaluru", desc: string = ""): Job {
  return {
    id: `test::${title}`,
    source: "greenhouse",
    sourceJobId: title,
    title,
    company: "Test Corp",
    city,
    country: "India",
    workMode: "on-site",
    rawLocation: city,
    isRemote: false,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://example.com",
    applicationUrl: "https://example.com/apply",
    description: desc,
    isFresherCandidate: true,
    isFresherEligible: true,
    isActive: true,
    experienceLevel: "entry",
    jobType: "full-time",
    dedupKey: `dedup_${title}`,
    crossDedupKey: `test corp|${title.toLowerCase()}|${city.toLowerCase()}`,
  };
}

console.log("=== Running Classification & Taxonomy Tests ===");

// ── 1. Taxonomy Adherence ───────────────────────────────────────────────────
assert(ROLE_TAXONOMY.includes("Software Engineering"), "Taxonomy includes Software Engineering");
assert(ROLE_TAXONOMY.includes("Data & AI"), "Taxonomy includes Data & AI");
assert(ROLE_TAXONOMY.includes("DevOps & Cloud"), "Taxonomy includes DevOps & Cloud");
assert(ROLE_TAXONOMY.includes("Cybersecurity"), "Taxonomy includes Cybersecurity");
assert(ROLE_TAXONOMY.includes("Product"), "Taxonomy includes Product");
assert(ROLE_TAXONOMY.includes("Design"), "Taxonomy includes Design");
assert(ROLE_TAXONOMY.includes("Marketing"), "Taxonomy includes Marketing");
assert(ROLE_TAXONOMY.includes("Sales"), "Taxonomy includes Sales");
assert(ROLE_TAXONOMY.includes("Finance"), "Taxonomy includes Finance");
assert(ROLE_TAXONOMY.includes("HR"), "Taxonomy includes HR");
assert(ROLE_TAXONOMY.includes("Operations"), "Taxonomy includes Operations");
assert(ROLE_TAXONOMY.includes("Customer Support"), "Taxonomy includes Customer Support");
assert(ROLE_TAXONOMY.includes("Research"), "Taxonomy includes Research");
assert(ROLE_TAXONOMY.includes("Other"), "Taxonomy includes Other");

// ── 2. Deterministic Role Classification ────────────────────────────────────
assert(
  classifyRoleDeterministically("Frontend Developer Intern") === "Software Engineering",
  "Frontend Developer -> Software Engineering"
);
assert(
  classifyRoleDeterministically("Data Analyst Trainee") === "Data & AI",
  "Data Analyst -> Data & AI"
);
assert(
  classifyRoleDeterministically("Machine Learning Engineer") === "Data & AI",
  "Machine Learning -> Data & AI"
);
assert(
  classifyRoleDeterministically("Cloud Support Associate") === "DevOps & Cloud",
  "Cloud Support -> DevOps & Cloud"
);
assert(
  classifyRoleDeterministically("Security Analyst Trainee") === "Cybersecurity",
  "Security Analyst -> Cybersecurity"
);
assert(
  classifyRoleDeterministically("Product Management Intern") === "Product",
  "Product Management Intern -> Product"
);
assert(
  classifyRoleDeterministically("UI/UX Design Intern") === "Design",
  "UI/UX Design -> Design"
);
assert(
  classifyRoleDeterministically("Payroll Industrial Trainee") === "Finance",
  "Payroll Industrial Trainee -> Finance"
);
assert(
  classifyRoleDeterministically("Talent Acquisition Intern") === "HR",
  "Talent Acquisition -> HR"
);

// ── 3. Indian City Normalization ────────────────────────────────────────────
assert(normalizeIndianCity("Bangalore", "Bangalore, India") === "Bengaluru", "Bangalore -> Bengaluru");
assert(normalizeIndianCity("Gurgaon", "Gurgaon, HR") === "Gurugram", "Gurgaon -> Gurugram");
assert(normalizeIndianCity("Bombay", "Bombay") === "Mumbai", "Bombay -> Mumbai");
assert(normalizeIndianCity("New Delhi", "New Delhi, DL") === "New Delhi", "New Delhi -> New Delhi");
assert(normalizeIndianCity("Hyderabad", "Hyderabad") === "Hyderabad", "Hyderabad -> Hyderabad");
assert(normalizeIndianCity("remote", "Remote across India") === "Pan-India", "Remote in India -> Pan-India");

// ── 4. Work Mode Normalization ──────────────────────────────────────────────
assert(normalizeWorkMode("remote", "Work From Home") === "remote", "Work From Home -> remote");
assert(normalizeWorkMode("hybrid", "Bangalore Hybrid") === "hybrid", "Bangalore Hybrid -> hybrid");
assert(normalizeWorkMode("on-site", "Bengaluru Office") === "on-site", "Office -> on-site");

// ── 5. Caching Behavior ────────────────────────────────────────────────────
clearClassificationCache();
const sampleJob = makeJob("Junior Software Engineer", "Bengaluru", "TypeScript development");
const initialHash = computeJobContentHash(sampleJob);

setCachedClassification(sampleJob, {
  role: "Software Engineering",
  city: "Bengaluru",
  workMode: "on-site",
  source: "llm",
  model: "meta-llama/Llama-3.2-3B-Instruct",
});

const cached = getCachedClassification(sampleJob);
assert(cached !== null, "Retrieves cached classification");
assert(cached?.source === "cache", "Marks source as cache");
assert(cached?.role === "Software Engineering", "Retains cached role");

// Mutating job title changes content hash and causes cache miss
const changedJob = { ...sampleJob, title: "Data Analyst Intern" };
assert(computeJobContentHash(changedJob) !== initialHash, "Content hash changes when job content changes");
assert(getCachedClassification(changedJob) === null, "Cache miss for changed job content");

// ── 6. Provider Error Fallback ─────────────────────────────────────────────
class FailingProvider implements ClassificationProvider {
  name = "failing-mock";
  async classify(): Promise<JobClassification> {
    throw new Error("Simulated upstream provider outage");
  }
}

async function testFallback() {
  setClassificationProvider(new FailingProvider());
  const jobToClassify = makeJob("Cloud Engineer Intern", "Pune");
  const result = await classifyJob(jobToClassify);

  assert(result !== null, "Fallback returns valid classification despite provider failure");
  assert(result.source === "deterministic", "Labels fallback as deterministic");
  assert(result.role === "DevOps & Cloud", "Deterministic fallback accurately classified role");
}

testFallback().then(() => {
  setClassificationProvider(null); // Reset
  console.log(`\nAll ${passed}/${total} Classification tests passed successfully!\n`);
});
