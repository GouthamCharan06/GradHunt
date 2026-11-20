/**
 * GradHunt — Fresher Eligibility & Experience Parser Unit Tests
 *
 * Tests Step 2 rules:
 * - Positive signals: intern, graduate, new grad, junior, trainee, apprentice, 0-1y
 * - Senior title exclusions: Senior, Staff, Principal, Lead, Manager, Director, Head, VP, Architect, etc.
 * - Explicit experience exclusions: 2+, 3+, 5+, 7+, 10+ years
 * - Associate rules: Associate alone is not proof; technical associate and apprentice associate are preserved
 * - Preservation of legitimate entry-level titles (SDE 1, Software Engineer I, GET)
 * - Safe handling of company boilerplate (e.g. "Founded 10+ years ago")
 * - Generic description phrases do NOT qualify non-tech roles
 */

import { evaluateFresherEligibility, parseExperienceRequirement } from "../candidate-filter";
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

function makeMockJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "test::123",
    source: "greenhouse",
    sourceJobId: "123",
    title: "Software Engineer",
    company: "Acme Corp",
    city: "Bengaluru",
    country: "India",
    workMode: "on-site",
    rawLocation: "Bengaluru, India",
    isRemote: false,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    sourceUrl: "https://example.com/jobs/123",
    applicationUrl: "https://example.com/apply/123",
    description: "Write clean code. Join our engineering team.",
    isFresherCandidate: false,
    isFresherEligible: false,
    isActive: true,
    experienceLevel: "unknown",
    jobType: "full-time",
    dedupKey: "dedup123",
    crossDedupKey: "acme|software engineer|bengaluru",
    ...overrides,
  };
}

console.log("=== Running Fresher Eligibility & Experience Parser Tests ===");

// ── 1. Senior / Experienced Title Exclusions ────────────────────────────────
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Senior Software Engineer" })).isEligible,
  "Excludes 'Senior Software Engineer'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Sr. Backend Developer" })).isEligible,
  "Excludes 'Sr. Backend Developer'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Staff DevOps Engineer" })).isEligible,
  "Excludes 'Staff DevOps Engineer'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Principal Systems Architect" })).isEligible,
  "Excludes 'Principal Systems Architect'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Lead Software Development Engineer" })).isEligible,
  "Excludes 'Lead Software Development Engineer'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Engineering Manager - Backend" })).isEligible,
  "Excludes 'Engineering Manager - Backend'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Director of Engineering" })).isEligible,
  "Excludes 'Director of Engineering'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Head of Infrastructure" })).isEligible,
  "Excludes 'Head of Infrastructure'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "VP of Product Development" })).isEligible,
  "Excludes 'VP of Product Development'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Solutions Architect" })).isEligible,
  "Excludes 'Solutions Architect'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Account Executive, Large Enterprises" })).isEligible,
  "Excludes 'Account Executive'"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Software Engineer II" })).isEligible,
  "Excludes 'Software Engineer II' (Mid/Senior Level 2)"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Specialist 2, Cloud Operations" })).isEligible,
  "Excludes 'Specialist 2'"
);

// ── 2. Explicit Experience Requirements (>= 2 years) ────────────────────────
assert(
  !evaluateFresherEligibility(
    makeMockJob({
      title: "Software Engineer",
      description: "Minimum 3 years of experience in distributed systems.",
    })
  ).isEligible,
  "Excludes Software Engineer requiring 3 years of experience"
);
assert(
  !evaluateFresherEligibility(
    makeMockJob({
      title: "Backend Developer",
      description: "Requires at least 2+ years of professional backend development.",
    })
  ).isEligible,
  "Excludes Backend Developer requiring 2+ years"
);
assert(
  !evaluateFresherEligibility(
    makeMockJob({
      title: "Data Analyst",
      description: "Qualifications: 5-7 years of experience in SQL and ETL pipelines.",
    })
  ).isEligible,
  "Excludes Data Analyst requiring 5-7 years"
);

// ── 3. Positive Fresher / Intern Signals ─────────────────────────────────────
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Software Engineer, Intern" })).isEligible,
  "Includes 'Software Engineer, Intern'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "ENG Project/ Program - Intern" })).isEligible,
  "Includes 'ENG Project/ Program - Intern'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Product Management Intern" })).isEligible,
  "Includes 'Product Management Intern'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Payroll Industrial Trainee" })).isEligible,
  "Includes 'Payroll Industrial Trainee'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Graduate Engineer Trainee - Software" })).isEligible,
  "Includes 'Graduate Engineer Trainee'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Junior Software Engineer" })).isEligible,
  "Includes 'Junior Software Engineer'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Software Engineer 1" })).isEligible,
  "Includes 'Software Engineer 1'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "SDE-1 (Frontend)" })).isEligible,
  "Includes 'SDE-1 (Frontend)'"
);

// ── 4. Associate Disqualification & Preservation ─────────────────────────────
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Operations Associate" })).isEligible,
  "Excludes non-tech 'Operations Associate' without 0-1y signals"
);
assert(
  !evaluateFresherEligibility(makeMockJob({ title: "Public Relations Associate" })).isEligible,
  "Excludes 'Public Relations Associate'"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Operations Associate, Apprenticeship" })).isEligible,
  "Includes 'Operations Associate, Apprenticeship' due to explicit apprenticeship signal"
);
assert(
  evaluateFresherEligibility(makeMockJob({ title: "Associate Software Engineer" })).isEligible,
  "Includes 'Associate Software Engineer' (technical entry title)"
);

// ── 5. Safe Handling of Company History (No False Positives) ────────────────
const boilerplateExp = parseExperienceRequirement(
  "Founded 10+ years ago, Acme Corp builds payment infrastructure. We are looking for fresh talent."
);
assert(
  !boilerplateExp.isExperienced,
  "Does not flag 'Founded 10+ years ago' as applicant experience requirement"
);

// ── 6. Generic Description Phrases ──────────────────────────────────────────
assert(
  !evaluateFresherEligibility(
    makeMockJob({
      title: "Office Coordinator",
      description: "Our office supports a large software engineering team building cloud solutions.",
    })
  ).isEligible,
  "Does not qualify 'Office Coordinator' merely because description mentions 'software engineering'"
);

console.log(`\nAll ${passed}/${total} Fresher Eligibility tests passed successfully!\n`);
