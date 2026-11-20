/**
 * Phase 1 Foundation Verification Test
 *
 * Verifies that the Canonical Job Schema and Zod validation
 * correctly accept valid jobs and reject invalid/mocked/incomplete jobs.
 */
import { CanonicalJobSchema, JobClassificationOutputSchema } from "./types/job.schema";
import { Job, JobSource, ROLE_TAXONOMY } from "./types/job";

export function testSchemaValidation() {
  console.log("Running Phase 1 Foundation Schema Verification...");

  const validJob: Job = {
    id: "greenhouse::12345",
    sourceJobId: "12345",
    source: "greenhouse",
    sourceUrl: "https://boards.greenhouse.io/example/jobs/12345",
    applicationUrl: "https://boards.greenhouse.io/example/jobs/12345#app",
    title: "Software Engineering Intern",
    company: "ExampleCorp",
    description: "Looking for passionate interns pursuing B.Tech in Computer Science.",
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    isRemote: false,
    workMode: "on-site",
    rawLocation: "Bengaluru, Karnataka, India",
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    isFresherCandidate: true,
    dedupKey: "a1b2c3d4e5f6",
    crossDedupKey: "examplecorp|software engineering intern|bengaluru",
    isActive: true,
  };

  // Test 1: Valid canonical job parses successfully
  const parsed = CanonicalJobSchema.safeParse(validJob);
  if (!parsed.success) {
    throw new Error(`Schema validation failed on valid job: ${JSON.stringify(parsed.error)}`);
  }
  console.log("✓ Test 1 Passed: Valid canonical job validated by Zod schema");

  // Test 2: Invalid source is rejected
  const invalidSourceJob = { ...validJob, source: "unauthorized_mock_feed" };
  const invalidSourceParse = CanonicalJobSchema.safeParse(invalidSourceJob);
  if (invalidSourceParse.success) {
    throw new Error("Schema unexpectedly allowed unauthorized job source");
  }
  console.log("✓ Test 2 Passed: Unauthorized job source rejected");

  // Test 3: Empty application URL is rejected (preserves real source URL rule)
  const emptyUrlJob = { ...validJob, applicationUrl: "not-a-valid-url" };
  const emptyUrlParse = CanonicalJobSchema.safeParse(emptyUrlJob);
  if (emptyUrlParse.success) {
    throw new Error("Schema unexpectedly allowed invalid application URL");
  }
  console.log("✓ Test 3 Passed: Invalid application URL rejected");

  // Test 4: Classification output schema validates structured LLM output format
  const validClassification = {
    role: "Software Engineering",
    jobType: "internship",
    experienceLevel: "intern",
    isFresherEligible: true,
    classifiedCity: "Bengaluru",
    classifiedCountry: "India",
    confidenceScore: 0.95,
    reasoning: "Title specifies intern and description mentions currently pursuing B.Tech.",
  };
  const parsedClassification = JobClassificationOutputSchema.safeParse(validClassification);
  if (!parsedClassification.success) {
    throw new Error(`Classification schema failed: ${JSON.stringify(parsedClassification.error)}`);
  }
  console.log("✓ Test 4 Passed: Structured AI classification output validated by Zod schema");

  // Test 5: Role taxonomy integrity check
  if (ROLE_TAXONOMY.length < 20 || !ROLE_TAXONOMY.includes("Software Engineering")) {
    throw new Error("Role taxonomy is incomplete");
  }
  console.log(`✓ Test 5 Passed: Role taxonomy contains ${ROLE_TAXONOMY.length} defined categories`);

  console.log("\nALL PHASE 1 FOUNDATION TESTS PASSED SUCCESSFULLY.");
}

// Run if directly executed
if (require.main === module) {
  testSchemaValidation();
}
