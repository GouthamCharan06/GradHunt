/**
 * GradHunt — Phase 3 Pipeline Tests
 *
 * Tests normalization, India-only enforcement, location parsing,
 * freshness filtering, and candidate filtering.
 *
 * NOTE: Fixtures below are strictly for testing parser/pipeline logic.
 * They are NOT available to production code and are NOT mock data.
 */

import {
  normalizeGreenhouse,
  normalizeLever,
  normalizeAshby,
  normalizeSmartRecruiters,
  parseLocation,
  formatCompanyName,
} from "../normalize";
import { filterByFreshness } from "../freshness";
import { filterFresherCandidates, parseExperienceRequirement } from "../candidate-filter";
import { searchAndRankJobs, computeSearchRelevance } from "../search";
import { Job } from "../../types/job";
import { GreenhouseRawJob, LeverRawJob, AshbyRawJob, SmartRecruitersRawJob } from "../../adapters/types";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeGreenhouseRaw(overrides: Partial<GreenhouseRawJob> = {}): GreenhouseRawJob {
  return {
    id: 12345,
    title: "Software Engineer",
    updated_at: new Date().toISOString(),
    absolute_url: "https://boards.greenhouse.io/example/jobs/12345",
    internal_job_id: 67890,
    location: { name: "Bengaluru, India" },
    metadata: [],
    content: "<p>Build great software.</p>",
    departments: [],
    offices: [],
    _boardSlug: "example",
    _company: "Example",
    ...overrides,
  };
}

function makeLeverRaw(overrides: Partial<LeverRawJob> = {}): LeverRawJob {
  return {
    id: "abc-123",
    text: "Frontend Developer",
    hostedUrl: "https://jobs.lever.co/spotify/abc-123",
    createdAt: Date.now(),
    categories: { location: "Mumbai, India", department: "Engineering" },
    description: "<div>Join our team</div>",
    descriptionPlain: "Join our team",
    additional: "",
    additionalPlain: "",
    lists: [],
    country: "IN",
    workplaceType: "onsite",
    _companySlug: "spotify",
    ...overrides,
  };
}

function makeAshbyRaw(overrides: Partial<AshbyRawJob> = {}): AshbyRawJob {
  return {
    id: "ashby-001",
    title: "Backend Engineer",
    location: "Bengaluru, India",
    department: "Engineering",
    employmentType: "FullTime",
    isRemote: false,
    publishedAt: new Date().toISOString(),
    jobUrl: "https://jobs.ashbyhq.com/linear/ashby-001",
    applyUrl: "https://jobs.ashbyhq.com/linear/ashby-001/apply",
    descriptionHtml: "<p>Build distributed systems.</p>",
    descriptionPlain: "Build distributed systems.",
    isListed: true,
    _companySlug: "linear",
    _company: "Linear",
    ...overrides,
  };
}

function makeFreshJob(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: "test::1",
    sourceJobId: "1",
    source: "greenhouse",
    sourceUrl: "https://example.com/1",
    applicationUrl: "https://example.com/1",
    title: "Software Engineer",
    company: "TestCo",
    description: "Build things.",
    city: "Mumbai",
    country: "India",
    isRemote: false,
    workMode: "on-site",
    rawLocation: "Mumbai, India",
    publishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    fetchedAt: now.toISOString(),
    isFresherCandidate: false,
    dedupKey: "abc123",
    crossDedupKey: "testco|software engineer|mumbai",
    isActive: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════════════

export function runPhase3Tests() {
  console.log("═".repeat(60));
  console.log(" Phase 3 Pipeline Tests (with India-Only Enforcement)");
  console.log("═".repeat(60));

  // ── 1. Location Parsing & India Detection ────────────────────────────
  console.log("\n── Location Parsing & India Detection ──");

  {
    const loc = parseLocation("Bengaluru, India");
    assert(loc.city === "Bengaluru", "Location: Bengaluru city extracted");
    assert(loc.country === "India", "Location: India country extracted");
    assert(loc.isIndia === true, "Location: isIndia is true");
    assert(loc.workMode === "on-site", "Location: default workMode on-site");
  }

  {
    const loc = parseLocation("Bangalore, Karnataka");
    assert(loc.city === "Bengaluru", "Location: Bangalore alias normalized to Bengaluru");
    assert(loc.country === "India", "Location: Karnataka state implies India");
    assert(loc.isIndia === true, "Location: isIndia true from state/city");
  }

  {
    const loc = parseLocation("Gurgaon, India");
    assert(loc.city === "Gurugram", "Location: Gurgaon normalized to Gurugram");
    assert(loc.country === "India", "Location: India confirmed");
  }

  {
    const loc = parseLocation("Remote - India");
    assert(loc.city === "Pan-India", "Location: Remote India city is Pan-India");
    assert(loc.country === "India", "Location: India confirmed for remote");
    assert(loc.isRemote === true, "Location: isRemote true");
    assert(loc.workMode === "remote", "Location: workMode remote");
    assert(loc.isIndiaRemote === true, "Location: isIndiaRemote true");
  }

  {
    const loc = parseLocation("Bengaluru, India (Remote)");
    assert(loc.city === "Bengaluru", "Location: city preserved when remote");
    assert(loc.workMode === "remote", "Location: workMode is remote");
    assert(loc.isIndiaRemote === true, "Location: isIndiaRemote true");
  }

  {
    const loc = parseLocation("Mumbai, India (Hybrid)");
    assert(loc.city === "Mumbai", "Location: Mumbai city");
    assert(loc.workMode === "hybrid", "Location: workMode hybrid");
    assert(!loc.isRemote, "Location: hybrid is not fully remote");
  }

  // ── 2. Non-India Location Exclusion ─────────────────────────────────
  console.log("\n── Non-India Location Exclusion ──");

  {
    // Generic "Remote" without India must NOT be classified as India
    const loc = parseLocation("Remote");
    assert(loc.isIndia === false, "Location: generic Remote is NOT India");
    assert(loc.country === "Unknown", "Location: country is Unknown");
    assert(loc.isIndiaRemote === false, "Location: isIndiaRemote false");
  }

  {
    const loc = parseLocation("Singapore");
    assert(loc.isIndia === false, "Location: Singapore is NOT India");
    assert(loc.country === "Singapore", "Location: Singapore country preserved");
  }

  {
    const loc = parseLocation("San Francisco, CA");
    assert(loc.isIndia === false, "Location: SF is NOT India");
    assert(loc.country === "CA", "Location: US state parsed");
  }

  {
    const loc = parseLocation("Barcelona, Spain");
    assert(loc.isIndia === false, "Location: Spain is NOT India");
    assert(loc.country === "Spain", "Location: Spain country preserved");
  }

  {
    const loc = parseLocation("London, UK");
    assert(loc.isIndia === false, "Location: London is NOT India");
    assert(loc.country === "UK", "Location: UK parsed");
  }

  // ── 3. Source Options Location Parsing ──────────────────────────────
  console.log("\n── Source Options Location Parsing ──");

  {
    // Lever with sourceCountry === "IN" and location "Remote"
    const loc = parseLocation("Remote", { sourceCountry: "IN", sourceWorkplaceType: "remote" });
    assert(loc.isIndia === true, "Location: Lever IN code classifies as India");
    assert(loc.country === "India", "Location: country is India");
    assert(loc.workMode === "remote", "Location: workMode remote");
    assert(loc.isIndiaRemote === true, "Location: isIndiaRemote true");
  }

  {
    // Lever with sourceCountry === "US" and location "Remote"
    const loc = parseLocation("Remote", { sourceCountry: "US", sourceWorkplaceType: "remote" });
    assert(loc.isIndia === false, "Location: Lever US code is NOT India");
  }

  // ── 4. Generic Company Name Formatting ─────────────────────────────
  console.log("\n── Generic Company Name Formatting ──");

  assert(formatCompanyName("Airbnb", "airbnb") === "Airbnb", "Company: source name preserved");
  assert(formatCompanyName(undefined, "stripe") === "Stripe", "Company: slug formatted generically");
  assert(formatCompanyName(undefined, "uber-technologies") === "Uber Technologies", "Company: hyphenated slug formatted");
  assert(formatCompanyName(undefined, "razorpay_software") === "Razorpay Software", "Company: underscore slug formatted");

  // ── 5. Authoritative Location & Stripe US/Canada Exclusion ─────────
  console.log("\n── Authoritative Location & Stripe Multi-Office Exclusion ──");

  {
    // The infamous Stripe US/Canada listing that leaked when company office locations were used
    const stripeLocation = "Seattle, San Francisco, New York, Chicago, Atlanta, Remote in the US, Canada";
    const loc = parseLocation(stripeLocation);
    assert(loc.isIndia === false, "Authoritative Location: Stripe US/Canada is strictly NOT India");
    assert(loc.country !== "India", "Authoritative Location: country is not India");
  }

  // ── 6. Greenhouse Normalization ─────────────────────────────────────
  console.log("\n── Greenhouse Normalization ──");

  {
    const result = normalizeGreenhouse([makeGreenhouseRaw()], new Date().toISOString());
    assert(result.jobs.length === 1, "GH Norm: valid record normalizes");
    assert(result.jobs[0].country === "India", "GH Norm: Indian country parsed");
    assert(result.jobs[0].workMode === "on-site", "GH Norm: workMode assigned");
    assert(result.jobs[0].rawLocation.includes("Bengaluru"), "GH Norm: rawLocation preserved");
  }

  // ── 7. Lever Normalization ──────────────────────────────────────────
  console.log("\n── Lever Normalization ──");

  {
    const result = normalizeLever([makeLeverRaw()], new Date().toISOString());
    assert(result.jobs.length === 1, "Lever Norm: valid record normalizes");
    assert(result.jobs[0].country === "India", "Lever Norm: country resolved to India");
    assert(result.jobs[0].city === "Mumbai", "Lever Norm: city is Mumbai");
    assert(result.jobs[0].workMode === "on-site", "Lever Norm: workMode on-site");
  }

  // ── 8. Ashby Normalization ──────────────────────────────────────────
  console.log("\n── Ashby Normalization ──");

  {
    const result = normalizeAshby([makeAshbyRaw()], new Date().toISOString());
    assert(result.jobs.length === 1, "Ashby Norm: valid record normalizes");
    assert(result.jobs[0].city === "Bengaluru", "Ashby Norm: city Bengaluru");
    assert(result.jobs[0].country === "India", "Ashby Norm: country India");
  }

  // ── 9. SmartRecruiters Normalization ────────────────────────────────
  console.log("\n── SmartRecruiters Normalization ──");

  {
    const srRaw: SmartRecruitersRawJob = {
      id: "sr-100",
      name: "Associate Software Engineer",
      company: { name: "Avery Dennison", identifier: "averydennison" },
      releasedDate: "2026-11-17T10:00:00Z",
      location: { city: "Bengaluru", country: "in" },
      _companySlug: "averydennison",
    };
    const result = normalizeSmartRecruiters([srRaw], new Date().toISOString());
    assert(result.jobs.length === 1, "SmartRecruiters Norm: valid posting normalizes");
    assert(result.jobs[0].country === "India", "SmartRecruiters Norm: country is India");
  }

  // ── 10. Freshness Filter ────────────────────────────────────────────
  console.log("\n── Freshness Filter ──");

  {
    const now = new Date("2026-11-17T12:00:00Z");
    const fresh = makeFreshJob({
      publishedAt: new Date("2026-11-17T10:00:00Z").toISOString(), // 2h ago
    });
    const old = makeFreshJob({
      id: "test::2",
      publishedAt: new Date("2026-11-15T10:00:00Z").toISOString(), // 50h ago
    });
    const result = filterByFreshness([fresh, old], now, 24);
    assert(result.fresh.length === 1, "Freshness: 2h-old job passes");
    assert(result.excluded.length === 1, "Freshness: 50h-old job excluded");
  }

  // ── 11. Strict 0–1 Year Candidate Filter & Experience Parsing ───────
  console.log("\n── Strict Candidate Filter & Experience Parsing ──");

  {
    // Experience parser unit checks
    const exp3Plus = parseExperienceRequirement("Requires minimum 3+ years of experience in React.");
    assert(exp3Plus.isExperienced === true, "Exp Parser: 3+ years detected as experienced");
    assert(exp3Plus.isFresherFriendly === false, "Exp Parser: 3+ years not fresher friendly");

    const exp0to1 = parseExperienceRequirement("Looking for 0-1 years of experience or fresh graduates.");
    assert(exp0to1.isExperienced === false, "Exp Parser: 0-1 years is not experienced");
    assert(exp0to1.isFresherFriendly === true, "Exp Parser: 0-1 years is fresher friendly");

    // Title & Description exclusions
    const intern = makeFreshJob({ title: "Software Engineering Intern" });
    const senior = makeFreshJob({ title: "Senior Software Engineer" });
    const manager = makeFreshJob({ title: "Engineering Manager" });
    const prAssociate = makeFreshJob({
      title: "Public Relations Associate",
      description: "Manage client PR accounts and press releases.",
    });
    const techAssociate = makeFreshJob({
      title: "Associate Software Engineer",
      description: "0-1 years experience required. Freshers welcome.",
    });
    const juniorWith3Years = makeFreshJob({
      title: "Junior Developer",
      description: "Must have at least 3 years of hands-on experience building apps.",
    });
    const entrySde = makeFreshJob({
      title: "Software Engineer",
      description: "Build robust APIs and microservices.",
    });
    const sde2 = makeFreshJob({
      title: "Software Engineer II",
      description: "Mid-level role.",
    });

    const result = filterFresherCandidates([
      intern,
      senior,
      manager,
      prAssociate,
      techAssociate,
      juniorWith3Years,
      entrySde,
      sde2,
    ]);

    assert(result.candidates.length === 3, "Candidate Filter: exactly 3 qualify (intern, techAssociate, entrySde)");
    assert(result.candidates.some((j) => j.title === "Software Engineering Intern"), "Candidate Filter: Intern qualified");
    assert(result.candidates.some((j) => j.title === "Associate Software Engineer"), "Candidate Filter: Tech Associate with 0-1 yr qualified");
    assert(result.candidates.some((j) => j.title === "Software Engineer"), "Candidate Filter: Entry SDE qualified");
    assert(result.nonCandidates.some((j) => j.title === "Senior Software Engineer"), "Candidate Filter: Senior excluded");
    assert(result.nonCandidates.some((j) => j.title === "Engineering Manager"), "Candidate Filter: Manager excluded");
    assert(result.nonCandidates.some((j) => j.title === "Public Relations Associate"), "Candidate Filter: PR Associate excluded");
    assert(result.nonCandidates.some((j) => j.title === "Junior Developer"), "Candidate Filter: Junior with 3+ yrs excluded");
    assert(result.nonCandidates.some((j) => j.title === "Software Engineer II"), "Candidate Filter: SDE II level 2 excluded");
  }

  // ── 12. Deterministic Search Relevance ──────────────────────────────
  console.log("\n── Deterministic Search Relevance ──");

  {
    const sde = makeFreshJob({
      title: "Software Engineer",
      role: "Software Engineering",
      description: "Write code and develop features.",
    });
    const backendIntern = makeFreshJob({
      title: "Backend Developer Intern",
      role: "Backend Development",
      description: "Work on APIs and databases.",
    });
    const prAssociate = makeFreshJob({
      title: "Public Relations Associate",
      role: "Marketing / Growth",
      description: "We work closely with software engineer teams to publicize tech stories.",
    });
    const manager = makeFreshJob({
      title: "Engineering Manager",
      role: "Software Engineering",
      description: "Manage a team of software engineers.",
    });

    const ranked = searchAndRankJobs([prAssociate, sde, manager, backendIntern], "Software Engineer");

    // SDE must be first
    assert(ranked[0].title === "Software Engineer", "Search: Exact Software Engineer ranked first");
    // PR Associate must have score 0 and be EXCLUDED (even though description says software engineer)
    assert(!ranked.some((j) => j.title === "Public Relations Associate"), "Search: PR Associate with desc match is excluded");
  }

  {
    const backend = makeFreshJob({ title: "Backend Developer", role: "Backend Development" });
    const frontend = makeFreshJob({ title: "Frontend Engineer", role: "Frontend Development" });
    const dataAnalyst = makeFreshJob({ title: "Data Analyst", role: "Data Analytics" });
    const hr = makeFreshJob({ title: "HR Recruiter", description: "Hiring for data analyst and frontend engineer roles." });

    const backendSearch = searchAndRankJobs([frontend, backend, hr], "Backend Developer");
    assert(backendSearch[0].title === "Backend Developer", "Search: Backend Developer ranked first");
    assert(!backendSearch.some((j) => j.title === "HR Recruiter"), "Search: HR Recruiter excluded from Backend search");

    const frontendSearch = searchAndRankJobs([backend, frontend, hr], "Frontend Engineer");
    assert(frontendSearch[0].title === "Frontend Engineer", "Search: Frontend Engineer ranked first");
    assert(!frontendSearch.some((j) => j.title === "HR Recruiter"), "Search: HR Recruiter excluded from Frontend search");

    const dataSearch = searchAndRankJobs([backend, dataAnalyst, hr], "Data Analyst");
    assert(dataSearch[0].title === "Data Analyst", "Search: Data Analyst ranked first");
    assert(!dataSearch.some((j) => j.title === "HR Recruiter"), "Search: HR Recruiter excluded from Data Analyst search");
  }

  // ── 13. Pagination Logic ────────────────────────────────────────────
  console.log("\n── Pagination Logic (10-record max per page) ──");

  {
    const totalJobs = 25;
    const testJobs: Job[] = Array.from({ length: totalJobs }, (_, i) =>
      makeFreshJob({ id: `page-test-${i}`, title: `Job #${i + 1}` })
    );

    const limit = 10;
    const totalPages = Math.ceil(totalJobs / limit);
    assert(totalPages === 3, "Pagination: 25 jobs = 3 total pages with limit 10");

    // Page 1
    const page1Jobs = testJobs.slice(0, limit);
    assert(page1Jobs.length === 10, "Pagination: Page 1 has exactly 10 jobs");
    assert(page1Jobs[0].title === "Job #1", "Pagination: Page 1 starts at Job #1");
    assert(page1Jobs[9].title === "Job #10", "Pagination: Page 1 ends at Job #10");

    // Page 2
    const page2Jobs = testJobs.slice(limit, limit * 2);
    assert(page2Jobs.length === 10, "Pagination: Page 2 has exactly 10 jobs");
    assert(page2Jobs[0].title === "Job #11", "Pagination: Page 2 starts at Job #11");
    assert(page2Jobs[9].title === "Job #20", "Pagination: Page 2 ends at Job #20");

    // Page 3
    const page3Jobs = testJobs.slice(limit * 2, limit * 3);
    assert(page3Jobs.length === 5, "Pagination: Page 3 has remainder 5 jobs");
    assert(page3Jobs[0].title === "Job #21", "Pagination: Page 3 starts at Job #21");
    assert(page3Jobs[4].title === "Job #25", "Pagination: Page 3 ends at Job #25");
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log(` All ${passed}/${total} Phase 3 tests passed!`);
  console.log("═".repeat(60));
}

if (typeof require !== "undefined" && require.main === module) {
  runPhase3Tests();
}
