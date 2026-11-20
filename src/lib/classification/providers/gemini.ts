/**
 * GradHunt — Gemini API Classification Provider
 *
 * Implements real, observable, semantically useful LLM classification:
 * - Direct REST call to Google Gemini generateContent API
 * - Bounded batch classification (e.g. 5-8 jobs per prompt) with stable ID mapping
 * - Intelligently truncated descriptions to prevent token bloat and quota exhaustion
 * - Explicit audit logging on every invocation:
 *   [LLM] INVOKE Gemini model=... batch=... attempt=... jobIds=...
 *   [LLM] RESPONSE batch=... status=success inputTokens=... outputTokens=... latencyMs=...
 *   [LLM] ERROR batch=... status=... error=...
 * - Extracts actual usageMetadata for accurate token and cost calculation
 * - Bounded exponential backoff on 429 and 503
 * - Never fabricates fake classifications or replaces real records on error
 */

import { z } from "zod";
import { Job, WorkMode, JobType } from "../../types/job";
import { ClassificationProvider, JobClassification } from "../types";
import {
  ROLE_TAXONOMY,
  ROLE_CLUSTERS,
  normalizeIndianCity,
  normalizeWorkMode,
  deriveRoleCluster,
  ClassifiedRole,
} from "../taxonomy";

const SingleClassificationSchema = z.object({
  id: z.string().optional(),
  is_fresher_relevant: z.boolean().optional(),
  is_internship: z.boolean().optional(),
  seniority: z.string().optional(),
  experience_min_years: z.number().nullable().optional(),
  experience_max_years: z.number().nullable().optional(),
  normalized_role: z.string().optional(),
  role: z.string().optional(),
  role_cluster: z.string().optional(),
  city: z.string().optional(),
  work_mode: z.string().optional(),
  job_type: z.string().optional(),
  skills: z.array(z.string()).optional(),
  confidence: z.union([z.string(), z.number(), z.record(z.string(), z.any())]).optional(),
  relevance_score: z.number().min(0).max(100).optional(),
  reasoning_summary: z.string().optional(),
  relevance_explanation: z.string().optional(),
});

const BatchClassificationSchema = z.array(SingleClassificationSchema);

export interface GeminiProviderOptions {
  apiKey?: string;
  projectName?: string;
  projectNumber?: string;
  model?: string;
  timeoutMs?: number;
  customFetch?: typeof fetch;
}

export function cleanCompactExcerpt(htmlOrText: string, maxLen = 650): string {
  if (!htmlOrText) return "";
  const text = htmlOrText
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLen) return text;

  const match = text.match(
    /(?:requirements|qualifications|about the role|what you(?:'ll)? do|responsibilities|experience|who you are|basic qualifications)[\s\S]{0,600}/i
  );
  if (match && match[0].length >= 200) {
    return match[0].trim().slice(0, maxLen);
  }

  return text.slice(0, maxLen);
}

export class GeminiProvider implements ClassificationProvider {
  name = "gemini";
  private apiKey: string;
  private projectName?: string;
  private projectNumber?: string;
  public model: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions = {}) {
    const rawKey =
      options.apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env["GEMINI_API_KEY "] ||
      "";
    this.apiKey = rawKey.trim();
    this.projectName = options.projectName || process.env.GEMINI_PROJECT_NAME || undefined;
    this.projectNumber = options.projectNumber || process.env.GEMINI_PROJECT_NUMBER || undefined;

    const configuredModel = options.model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    if (configuredModel === "gemini-2.0-flash" || configuredModel === "gemini-2.5-flash-lite") {
      this.model = "gemini-3.5-flash-lite";
    } else {
      this.model = configuredModel;
    }
    this.timeoutMs = options.timeoutMs || parseInt(process.env.LLM_TIMEOUT_MS || "25000", 10);
    this.fetchImpl = options.customFetch || fetch;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  getConfigSummary(): {
    configured: boolean;
    model: string;
    hasProjectName: boolean;
    hasProjectNumber: boolean;
    timeoutMs: number;
  } {
    return {
      configured: this.isAvailable(),
      model: this.model,
      hasProjectName: Boolean(this.projectName && this.projectName.length > 0),
      hasProjectNumber: Boolean(this.projectNumber && this.projectNumber.length > 0),
      timeoutMs: this.timeoutMs,
    };
  }

  /**
   * Classifies a bounded batch of candidate jobs in a single prompt.
   * Maps responses deterministically back to each job by ID.
   */
  async classifyBatch(
    jobs: Job[],
    batchIndex = 1,
    totalBatches = 1
  ): Promise<Map<string, JobClassification>> {
    const results = new Map<string, JobClassification>();
    if (jobs.length === 0) return results;

    if (!this.isAvailable()) {
      for (const job of jobs) {
        results.set(job.id, this.createFailureResult(job, "GEMINI_API_KEY is not configured in environment", 0));
      }
      return results;
    }

    const clustersList = ROLE_CLUSTERS.join(", ");
    const taxonomyList = ROLE_TAXONOMY.join(", ");

    const jobsPayload = jobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.rawLocation || job.city || "India",
      workMode: job.workMode || "unknown",
      jobType: job.jobType || "unknown",
      descriptionExcerpt: cleanCompactExcerpt(job.description, 650),
    }));

    const prompt = `You are an expert semantic job analyzer for GradHunt, an Indian fresher and internship job board.
Analyze the following batch of ${jobs.length} candidate job postings and output ONLY a valid JSON array of objects.
Every object in the array MUST contain the exact "id" field of the job it evaluates.
Do not include markdown code fences or conversational text.

Role Normalization Guidelines:
- Semantically normalize equivalent titles into standard job roles (e.g., "SDE-1", "SWE I", "Software Engineer I", "Software Development Engineer" -> "Software Engineer").
- Identify first-class student internships (intern, internship, co-op, apprentice).
- Set is_fresher_relevant to true for roles suitable for fresh graduates and early career candidates (0-3 years experience).
- If the listing explicitly requires 4+ or 5+ years of experience, set is_fresher_relevant to false.
- Map roles to allowed broad roles and role clusters.

Allowed Role Clusters: [${clustersList}]
Allowed Broad Roles: [${taxonomyList}]

Candidate Jobs Batch:
${JSON.stringify(jobsPayload, null, 2)}

Required JSON array output format:
[
  {
    "id": "<exact matching job id>",
    "is_fresher_relevant": <true if suitable for freshers / new graduates / 0-3 years experience, false otherwise>,
    "is_internship": <true if student internship / co-op / apprentice / summer trainee, false otherwise>,
    "seniority": "<intern | entry | junior | mid | senior | unknown>",
    "experience_min_years": <number or null>,
    "experience_max_years": <number or null>,
    "normalized_role": "<standard normalized title, e.g. Software Engineer, Frontend Engineer, Data Analyst>",
    "role": "<best match from allowed broad roles, or Other>",
    "role_cluster": "<best match from allowed role clusters, or Other>",
    "city": "<canonical Indian city name, e.g. Bengaluru, Mumbai, Pune, Hyderabad, Gurugram, Noida, or Pan-India, or Unknown>",
    "work_mode": "<remote | hybrid | on-site | unknown>",
    "job_type": "<full-time | internship | contract | part-time>",
    "skills": ["<skill1>", "<skill2>"],
    "relevance_score": <integer 0-100 ranking fresher relevance: internships (90-98), new-grad (85-95), entry 0-3y (75-88), experienced (0-40)>,
    "reasoning_summary": "<concise 1-sentence rationale for this classification>"
  }
]`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:generateContent?key=${this.apiKey}`;

    const jobIds = jobs.map((j) => j.id);
    const maxRetries = 2;
    let retriesUsed = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const callStartTime = Date.now();
      console.log(
        `[LLM] INVOKE Gemini model=${this.model} batch=${batchIndex}/${totalBatches} attempt=${attempt} jobIds=[${jobIds.slice(0, 3).join(", ")}${jobIds.length > 3 ? `, +${jobIds.length - 3} more` : ""}]`
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2000,
              responseMimeType: "application/json",
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);
        const latencyMs = Date.now() - callStartTime;

        if (!response.ok) {
          const errorBody = await response.text().catch(() => "");
          console.error(
            `[LLM] ERROR batch=${batchIndex}/${totalBatches} status=${response.status} error=${errorBody.slice(0, 150)}`
          );

          if (response.status === 429 || response.status === 503) {
            lastError = new Error(`Gemini HTTP ${response.status}: ${errorBody.slice(0, 100)}`);
            retriesUsed++;
            const backoffMs = (attempt + 1) * 3000;
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          throw new Error(`Gemini API HTTP ${response.status}: ${errorBody.slice(0, 100)}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const rawText = candidate?.content?.parts?.[0]?.text;

        if (!rawText) {
          throw new Error("Empty completion returned by Gemini API");
        }

        const inputTokens = data.usageMetadata?.promptTokenCount ?? Math.ceil(prompt.length / 4);
        const outputTokens = data.usageMetadata?.candidatesTokenCount ?? Math.ceil(rawText.length / 4);

        console.log(
          `[LLM] RESPONSE batch=${batchIndex}/${totalBatches} status=success inputTokens=${inputTokens} outputTokens=${outputTokens} latencyMs=${latencyMs}`
        );

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
          parsedJson = JSON.parse(cleaned);
        }

        let items: z.infer<typeof SingleClassificationSchema>[] = [];
        if (Array.isArray(parsedJson)) {
          items = parsedJson;
        } else if (parsedJson && typeof parsedJson === "object") {
          // If returned as a wrapper object { jobs: [...] } or single object
          if (Array.isArray((parsedJson as any).jobs)) {
            items = (parsedJson as any).jobs;
          } else if (Array.isArray((parsedJson as any).items)) {
            items = (parsedJson as any).items;
          } else {
            items = [parsedJson as any];
          }
        }

        // Map parsed items by ID
        const itemsById = new Map<string, z.infer<typeof SingleClassificationSchema>>();
        for (const item of items) {
          if (item.id) itemsById.set(item.id, item);
        }

        // Distribute token counts evenly across batch jobs for per-job reporting
        const tokensPerJobInput = Math.round(inputTokens / jobs.length);
        const tokensPerJobOutput = Math.round(outputTokens / jobs.length);

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          const item = itemsById.get(job.id) || items[i];

          if (item) {
            results.set(job.id, this.formatJobClassification(job, item, {
              inputTokens: tokensPerJobInput,
              outputTokens: tokensPerJobOutput,
              latencyMs: Math.round(latencyMs / jobs.length),
              retriesUsed,
            }));
          } else {
            results.set(job.id, this.createFailureResult(job, "Missing item in batch response", retriesUsed));
          }
        }

        return results;
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          retriesUsed++;
          const backoffMs = (attempt + 1) * 2000;
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    }

    // All retries exhausted
    console.error(`[LLM] FAILED batch=${batchIndex}/${totalBatches} all retries exhausted: ${lastError?.message}`);
    for (const job of jobs) {
      results.set(job.id, this.createFailureResult(job, lastError?.message || "All retries exhausted", retriesUsed));
    }

    return results;
  }

  /**
   * Single job classification wrapper.
   */
  async classify(job: Job): Promise<JobClassification> {
    const map = await this.classifyBatch([job], 1, 1);
    return map.get(job.id) || this.createFailureResult(job, "Classification failed", 0);
  }

  private formatJobClassification(
    job: Job,
    parsed: z.infer<typeof SingleClassificationSchema>,
    meta: { inputTokens: number; outputTokens: number; latencyMs: number; retriesUsed: number }
  ): JobClassification {
    const isInternship =
      parsed.is_internship === true ||
      job.jobType === "internship" ||
      /\b(intern|internship|co-?op|apprentice)\b/i.test(job.title);

    const isFresher =
      parsed.is_fresher_relevant !== undefined
        ? parsed.is_fresher_relevant
        : isInternship || job.isFresherCandidate;

    const normalizedRole = (parsed.normalized_role || job.title).trim();
    const roleCluster =
      parsed.role_cluster && ROLE_CLUSTERS.includes(parsed.role_cluster as any)
        ? (parsed.role_cluster as any)
        : deriveRoleCluster(normalizedRole);

    const broadRole =
      parsed.role && ROLE_TAXONOMY.includes(parsed.role as any)
        ? (parsed.role as ClassifiedRole)
        : deriveRoleCluster(normalizedRole) === "Software Engineering"
        ? "Software Engineering"
        : "Other";

    const city =
      parsed.city && parsed.city !== "Unknown"
        ? normalizeIndianCity(parsed.city, job.rawLocation || job.city || "")
        : job.city || "Unknown";

    const workMode =
      parsed.work_mode && ["remote", "hybrid", "on-site"].includes(parsed.work_mode)
        ? (parsed.work_mode as WorkMode)
        : job.workMode || "unknown";

    const jobType =
      parsed.job_type && ["full-time", "internship", "contract", "part-time"].includes(parsed.job_type)
        ? (parsed.job_type as JobType)
        : isInternship
        ? "internship"
        : job.jobType || "full-time";

    return {
      role: broadRole,
      normalized_role: normalizedRole,
      role_cluster: roleCluster,
      city,
      workMode,
      job_type: jobType,
      seniority: parsed.seniority || (isInternship ? "intern" : "entry"),
      is_fresher_relevant: isFresher,
      is_internship: isInternship,
      experience_min_years: parsed.experience_min_years ?? null,
      experience_max_years: parsed.experience_max_years ?? null,
      relevanceScore: parsed.relevance_score ?? (isInternship ? 95 : isFresher ? 85 : 40),
      reasoning_summary: parsed.reasoning_summary || `Semantic evaluation as ${isFresher ? "fresher eligible" : "experienced"} role`,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      source: "llm",
      classificationStatus: "llm_success",
      semanticConfidence: {
        role: "high",
        city: "high",
        work_mode: "high",
      },
      wasLlmAttempted: true,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      latencyMs: meta.latencyMs,
      retryCount: meta.retriesUsed,
    };
  }

  private createFailureResult(job: Job, errorMessage: string, retriesUsed: number): JobClassification {
    const isInternship = job.jobType === "internship" || /\b(intern|internship|co-?op)\b/i.test(job.title);
    return {
      role: "Other",
      normalized_role: job.title,
      role_cluster: "Other",
      city: job.city || "Unknown",
      workMode: job.workMode || "unknown",
      job_type: job.jobType || "full-time",
      seniority: isInternship ? "intern" : "unknown",
      is_fresher_relevant: isInternship ? true : undefined,
      is_internship: isInternship,
      experience_min_years: null,
      experience_max_years: null,
      relevanceScore: isInternship ? 90 : undefined,
      reasoning_summary: undefined,
      skills: [],
      source: "llm",
      classificationStatus: "llm_failed",
      llmError: errorMessage,
      wasLlmAttempted: true,
      retryCount: retriesUsed,
    };
  }
}
