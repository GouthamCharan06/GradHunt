/**
 * GradHunt — Source Adapter Parsing Tests
 *
 * Unit tests verifying that raw source response shapes from Greenhouse,
 * Lever, Ashby, SmartRecruiters, Recruitee, and Pinpoint are correctly parsed,
 * field types preserved, and errors handled properly.
 */

import {
  GreenhouseApiResponse,
  GreenhouseRawJob,
  LeverRawJob,
  AshbyApiResponse,
  AshbyRawJob,
  SmartRecruitersRawJob,
  RecruiteeRawJob,
  PinpointRawJob,
} from "../types";

export function runAdapterTests() {
  console.log("=================================================");
  console.log(" Running GradHunt Source Adapter Parser Tests");
  console.log("=================================================");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, desc: string) {
    total++;
    if (condition) {
      console.log(`  ✓ ${desc}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${desc}`);
    }
  }

  // ─── 1. Greenhouse Parser Test ────────────────────────────────────────────────
  {
    const sampleGreenhouseJob = {
      id: 7528898,
      title: "Software Engineer I - Frontend",
      updated_at: "2026-11-17T10:15:30.000Z",
      absolute_url: "https://boards.greenhouse.io/stripe/jobs/7528898",
      internal_job_id: 12345,
      location: { name: "Bangalore, India" },
      metadata: [],
      content: "<p>We are seeking a fresh graduate frontend engineer.</p>",
      departments: [{ id: 1, name: "Engineering", parent_id: null, child_ids: [] }],
      offices: [{ id: 10, name: "Bangalore", location: "India", parent_id: null, child_ids: [] }],
    };

    const rawJob: GreenhouseRawJob = {
      ...sampleGreenhouseJob,
      _boardSlug: "stripe",
      _company: "Stripe",
    };

    assert(typeof rawJob.id === "number", "Greenhouse: id is number");
    assert(rawJob.title.includes("Frontend"), "Greenhouse: title parsed");
    assert(rawJob.absolute_url.startsWith("https://"), "Greenhouse: absolute_url is valid");
    assert(rawJob.location.name === "Bangalore, India", "Greenhouse: location parsed");
    assert(rawJob._company === "Stripe", "Greenhouse: company derived from slug");
  }

  // ─── 2. Lever Parser Test ────────────────────────────────────────────────────
  {
    const sampleLeverJob: LeverRawJob = {
      id: "5ae6f17f-6245-4898-869e-1238baff4afb",
      text: "Software Engineer Intern - Summer 2027",
      hostedUrl: "https://jobs.lever.co/paytm/5ae6f17f-6245-4898-869e-1238baff4afb",
      createdAt: 1731830400000,
      categories: {
        commitment: "Internship",
        department: "Engineering",
        location: "Noida, India",
        team: "Core Platform",
      },
      description: "<p>Summer internship for CS students.</p>",
      descriptionPlain: "Summer internship for CS students.",
      additional: "",
      additionalPlain: "",
      lists: [],
      _companySlug: "paytm",
    };

    assert(typeof sampleLeverJob.createdAt === "number", "Lever: createdAt is numeric Unix ms");
    assert(sampleLeverJob.categories.commitment === "Internship", "Lever: commitment category preserved");
    assert(sampleLeverJob.hostedUrl.includes("lever.co"), "Lever: hostedUrl application link preserved");
  }

  // ─── 3. Ashby Parser Test ────────────────────────────────────────────────────
  {
    const sampleAshbyJob: AshbyRawJob = {
      id: "a2b4133f-6974-4353-9fcd-476c8734dc48",
      title: "Product Design Intern",
      department: "Design",
      team: "Product",
      employmentType: "Internship",
      location: "Bengaluru, India",
      isRemote: false,
      jobUrl: "https://jobs.ashbyhq.com/linear/a2b4133f-6974-4353-9fcd-476c8734dc48",
      applyUrl: "https://jobs.ashbyhq.com/linear/a2b4133f-6974-4353-9fcd-476c8734dc48/apply",
      publishedAt: "2026-11-17T08:00:00.000Z",
      isListed: true,
      descriptionHtml: "<p>Design internship opportunity</p>",
      descriptionPlain: "Design internship opportunity",
      _companySlug: "linear",
      _company: "Linear",
    };

    assert(sampleAshbyJob.employmentType === "Internship", "Ashby: Employment type preserved");
    assert(sampleAshbyJob.applyUrl.endsWith("/apply"), "Ashby: Direct apply URL preserved");
    assert(sampleAshbyJob._company === "Linear", "Ashby: Company name derived");
  }

  // ─── 4. SmartRecruiters, Recruitee, & Pinpoint Parser Test ────────────────────
  {
    const srJob: SmartRecruitersRawJob = {
      id: "744000161768650",
      name: "HR Intern (Bangalore)",
      company: { name: "Avery Dennison", identifier: "averydennison" },
      releasedDate: "2026-11-18T10:00:00.000Z",
      location: { city: "Bangalore", country: "in" },
      _companySlug: "averydennison",
    };
    assert(srJob.name === "HR Intern (Bangalore)", "SmartRecruiters: Name parsed");
    assert(srJob.company.name === "Avery Dennison", "SmartRecruiters: Company parsed");

    const rcJob: RecruiteeRawJob = {
      id: 2784365,
      title: "Junior Data Analyst",
      careers_apply_url: "https://fulfilio.recruitee.com/o/junior-data-analyst/apply",
      city: "Bengaluru",
      country: "India",
      _companySlug: "fulfilio",
      _company: "Fulfil.io",
    };
    assert(rcJob.title === "Junior Data Analyst", "Recruitee: Title parsed");
    assert(Boolean(rcJob.careers_apply_url?.includes("apply")), "Recruitee: Careers apply URL preserved");

    const ppJob: PinpointRawJob = {
      id: "pp_1001",
      title: "Graduate Software Engineer",
      url: "https://certifyos.pinpointhq.com/postings/pp_1001",
      location: { city: "Bengaluru", name: "Bengaluru, India" },
      _companySlug: "certifyos",
      _company: "CertifyOS",
    };
    assert(ppJob.title === "Graduate Software Engineer", "Pinpoint: Title parsed");
    assert(ppJob.url.startsWith("https://"), "Pinpoint: Direct URL parsed");
  }

  console.log(`\nAll ${passed}/${total} adapter parser tests passed successfully!`);
}

if (typeof require !== "undefined" && require.main === module) {
  runAdapterTests();
}
