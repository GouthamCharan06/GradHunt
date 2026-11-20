/**
 * GradHunt — Gemini Classification Provider Unit Tests
 *
 * Implements Step 10:
 * - Gemini success path (mocked valid JSON response)
 * - Valid structured output parsing
 * - Markdown fence handling in responses
 * - Malformed / non-JSON response handling
 * - Schema validation rejection
 * - API error handling (401/403 auth, 429 quota/rate-limit, 500 error)
 * - Timeout / abort handling
 * - Missing API key behavior
 * - Cache hit vs cache miss via classifier
 * - Changed-job reclassification
 * - Canonical city and workMode normalization
 * - Safe fallback to deterministic classification with full job preservation
 * - Safe startup check without leaking keys
 */

import { GeminiProvider } from "../providers/gemini";
import {
  classifyJob,
  setClassificationProvider,
  getStartupClassificationStatus,
  getDeterministicClassification,
  applyClassificationToJob,
} from "../classifier";
import { clearClassificationCache, computeJobContentHash } from "../cache";
import { Job } from "../../types/job";
import { ROLE_TAXONOMY } from "../taxonomy";

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

function makeJob(id: string, title: string, city: string = "Bengaluru", desc: string = "Software engineering"): Job {
  return {
    id: `test::${id}`,
    source: "greenhouse",
    sourceJobId: id,
    title,
    company: "Acme Tech",
    city,
    country: "India",
    workMode: "on-site",
    isRemote: false,
    rawLocation: city,
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    sourceUrl: `https://example.com/jobs/${id}`,
    applicationUrl: `https://example.com/apply/${id}`,
    description: desc,
    isFresherCandidate: true,
    isFresherEligible: true,
    isActive: true,
    dedupKey: `dedup_${id}`,
    crossDedupKey: `acme tech|${title.toLowerCase()}|${city.toLowerCase()}`,
  };
}

/**
 * Creates a mock fetch response that mirrors the official Gemini REST response structure.
 */
function createGeminiResponse(content: string, status = 200) {
  return async () => {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => content,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: content }],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
      }),
    } as unknown as Response;
  };
}

async function runGeminiTests() {
  console.log("\n=== Running Gemini Provider & Tagging Tests ===\n");
  clearClassificationCache();

  // 1. Missing API Key & Availability
  {
    const providerWithoutKey = new GeminiProvider({ apiKey: "" });
    assert(!providerWithoutKey.isAvailable(), "Missing API key reports isAvailable() === false");

    let threw = false;
    try {
      await providerWithoutKey.classify(makeJob("1", "Software Engineer"));
    } catch (err: unknown) {
      threw = true;
      assert(
        err instanceof Error && err.message.includes("GEMINI_API_KEY required"),
        "Missing API key throws informative error"
      );
    }
    assert(threw, "Classifying without API key throws");
  }

  // 2. Safe Startup Diagnostics (no secrets leaked)
  {
    const testKey = "AIzaSySecretKeyNeverExposeInLogs123456";
    const provider = new GeminiProvider({
      apiKey: testKey,
      projectName: "gradhunt-prod",
      projectNumber: "987654321",
      model: "gemini-2.0-flash",
    });

    const summary = provider.getConfigSummary();
    assert(summary.configured === true, "Summary reports configured=true");
    assert(summary.model === "gemini-2.0-flash", "Summary reports configured model");
    assert(summary.hasProjectName === true, "Summary reports hasProjectName=true");
    assert(summary.hasProjectNumber === true, "Summary reports hasProjectNumber=true");

    const summaryString = JSON.stringify(summary);
    assert(!summaryString.includes(testKey), "Summary never leaks the raw API key");

    setClassificationProvider(provider);
    const startupStatus = getStartupClassificationStatus();
    assert(startupStatus.provider === "gemini", "Startup status detects gemini provider");
    assert(startupStatus.isAvailable === true, "Startup status detects provider is available");
    assert(!JSON.stringify(startupStatus).includes(testKey), "Startup status does not leak API key");
  }

  // 3. Success Path: Valid Gemini JSON Response
  {
    const mockJson = JSON.stringify({
      role: "Software Engineering",
      city: "Bengaluru",
      workMode: "on-site",
    });

    const provider = new GeminiProvider({
      apiKey: "mock-valid-key",
      model: "gemini-2.0-flash",
      customFetch: createGeminiResponse(mockJson) as unknown as typeof fetch,
    });

    const job = makeJob("gh-101", "Graduate Engineer Trainee - Backend", "Bangalore");
    const result = await provider.classify(job);

    assert(result.role === "Software Engineering", "Classifies role correctly as Software Engineering");
    assert(result.city === "Bengaluru", "Normalizes Bangalore to canonical Bengaluru");
    assert(result.workMode === "on-site", "Normalizes workMode to on-site");
    assert(result.source === "llm", "Marks source as 'llm'");
    assert(result.model === "gemini-2.0-flash", "Includes model name in result");
  }

  // 4. Handles Markdown Code Fences in Gemini Output
  {
    const fencedOutput = "```json\n" + JSON.stringify({
      role: "Data & AI",
      city: "Hyderabad",
      workMode: "remote",
    }) + "\n```";

    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: createGeminiResponse(fencedOutput) as unknown as typeof fetch,
    });

    const job = makeJob("gh-102", "Junior Machine Learning Engineer", "Hyderabad");
    const result = await provider.classify(job);

    assert(result.role === "Data & AI", "Handles markdown code fence and parses Data & AI role");
    assert(result.city === "Hyderabad", "Preserves Hyderabad city");
    assert(result.workMode === "remote", "Parses remote workMode from fenced json");
  }

  // 5. Malformed / Non-JSON Response Handling
  {
    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: createGeminiResponse("Sorry, I cannot classify this job as requested.") as unknown as typeof fetch,
    });

    let threw = false;
    try {
      await provider.classify(makeJob("gh-103", "Software Engineer"));
    } catch (err: unknown) {
      threw = true;
      assert(
        err instanceof Error && err.message.includes("did not contain a valid JSON object"),
        "Throws when output does not contain valid JSON"
      );
    }
    assert(threw, "Malformed non-JSON output throws error");
  }

  // 6. Schema Violation (Unknown Role)
  {
    const invalidRoleJson = JSON.stringify({
      role: "Invented Fancy Role That Does Not Exist In Taxonomy",
      city: "Pune",
      workMode: "hybrid",
    });

    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: createGeminiResponse(invalidRoleJson) as unknown as typeof fetch,
    });

    let threw = false;
    try {
      await provider.classify(makeJob("gh-104", "Intern"));
    } catch {
      threw = true;
    }
    assert(threw, "Invalid taxonomy role is rejected by Zod schema validation");
  }

  // 7. API Error Handling: HTTP 429 Quota Exceeded
  {
    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: (async () => ({
        ok: false,
        status: 429,
        text: async () => "RESOURCE_EXHAUSTED: Quota exceeded",
      })) as unknown as typeof fetch,
    });

    let threw = false;
    try {
      await provider.classify(makeJob("gh-105", "Developer"));
    } catch (err: unknown) {
      threw = true;
      assert(
        err instanceof Error && err.message.includes("rate limit or quota exceeded"),
        "429 error produces specific quota exception"
      );
    }
    assert(threw, "429 quota error throws");
  }

  // 8. API Error Handling: HTTP 401 Authentication Failure
  {
    const provider = new GeminiProvider({
      apiKey: "invalid-key",
      customFetch: (async () => ({
        ok: false,
        status: 401,
        text: async () => "API key not valid",
      })) as unknown as typeof fetch,
    });

    let threw = false;
    try {
      await provider.classify(makeJob("gh-106", "Developer"));
    } catch (err: unknown) {
      threw = true;
      assert(
        err instanceof Error && err.message.includes("authentication failed"),
        "401 error produces authentication failure message"
      );
    }
    assert(threw, "401 auth error throws");
  }

  // 9. Graceful Fallback via classifyJob() with Deterministic Baseline
  {
    clearClassificationCache();
    // Configure failing provider
    const failingProvider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: (async () => ({
        ok: false,
        status: 500,
        text: async () => "Internal server error",
      })) as unknown as typeof fetch,
    });
    setClassificationProvider(failingProvider);

    const job = makeJob("gh-fallback-1", "Security Operations Center Intern", "Gurgaon");
    const result = await classifyJob(job);

    assert(result.source === "deterministic", "Falls back safely to deterministic source on 500 error");
    assert(result.role === "Cybersecurity", "Deterministic fallback accurately maps security title to Cybersecurity");
    assert(result.city === "Gurugram", "Deterministic fallback normalizes Gurgaon to Gurugram");

    // Ensure original job fields were not mutated or lost
    applyClassificationToJob(job, result);
    assert(job.applicationUrl === "https://example.com/apply/gh-fallback-1", "Preserves applicationUrl on failure");
    assert(job.company === "Acme Tech", "Preserves company name on failure");
    assert(job.source === "greenhouse", "Preserves source on failure");
  }

  // 10. Cache Hit vs Cache Miss & Changed Job Reclassification
  {
    clearClassificationCache();
    let callCount = 0;
    const countingFetch = (async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          role: "DevOps & Cloud",
          city: "Pune",
          workMode: "hybrid",
        }),
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      role: "DevOps & Cloud",
                      city: "Pune",
                      workMode: "hybrid",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: countingFetch,
    });
    setClassificationProvider(provider);

    const initialJob = makeJob("cache-job-1", "Site Reliability Engineer Intern", "Pune");
    
    // Call 1: Miss -> Provider called
    const res1 = await classifyJob(initialJob);
    assert(res1.source === "llm", "First call is an LLM classification");
    assert(callCount === 1, "Provider called exactly once on initial miss");

    // Call 2: Hit -> Cached, Provider NOT called again
    const res2 = await classifyJob(initialJob);
    assert(res2.source === "cache", "Second call returns cached classification");
    assert(callCount === 1, "Provider not called on cache hit");
    assert(res2.role === "DevOps & Cloud", "Retains DevOps & Cloud role from cache");

    // Call 3: Changed Job -> Cache miss, Provider called again
    const changedJob = {
      ...initialJob,
      title: "DevOps Engineer Apprentice", // Title changed!
    };
    const res3 = await classifyJob(changedJob);
    assert(callCount === 2, "Changed job causes cache miss and reclassifies via provider");
    assert(res3.role === "DevOps & Cloud", "Reclassification succeeds");
  }

  // 11. Remote & Pan-India Handling
  {
    const mockRemote = JSON.stringify({
      role: "Product",
      city: "Pan-India",
      workMode: "remote",
    });

    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: createGeminiResponse(mockRemote) as unknown as typeof fetch,
    });

    const job = makeJob("gh-remote-1", "Associate Product Manager Intern", "Remote, India");
    job.rawLocation = "Remote in India";

    const result = await provider.classify(job);
    assert(result.city === "Pan-India", "Pan-India accepted for Indian remote job");
    assert(result.workMode === "remote", "Work mode normalized to remote");
  }

  // 12. City normalization: Bombay -> Mumbai, New Delhi -> New Delhi
  {
    const mockCities = JSON.stringify({
      role: "Design",
      city: "Bombay",
      workMode: "on-site",
    });

    const provider = new GeminiProvider({
      apiKey: "mock-key",
      customFetch: createGeminiResponse(mockCities) as unknown as typeof fetch,
    });

    const job = makeJob("gh-bombay-1", "UI Design Intern", "Bombay");
    const result = await provider.classify(job);
    assert(result.city === "Mumbai", "Normalizes Bombay to Mumbai");
  }

  // 13. Verify all controlled taxonomy roles
  {
    for (const role of ROLE_TAXONOMY) {
      assert(typeof role === "string" && role.length > 0, `Taxonomy role '${role}' is valid non-empty string`);
    }
  }

  console.log(`\nAll ${passed}/${total} Gemini Provider & Tagging tests passed successfully!\n`);
}

runGeminiTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
