import { z } from "zod";
import { ROLE_TAXONOMY } from "./job";

/**
 * Zod schema for approved JobSource.
 */
export const JobSourceSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "recruitee",
  "pinpoint",
]);

/**
 * Zod schema for role taxonomy.
 */
export const RoleCategorySchema = z.enum(ROLE_TAXONOMY);

/**
 * Zod schema for experience level.
 */
export const ExperienceLevelSchema = z.enum([
  "intern",
  "entry",
  "junior",
  "mid",
  "senior",
  "lead",
  "manager",
  "unknown",
]);

/**
 * Zod schema for job type.
 */
export const JobTypeSchema = z.enum([
  "full-time",
  "part-time",
  "internship",
  "contract",
  "freelance",
  "unknown",
]);

/**
 * Zod schema for work mode.
 */
export const WorkModeSchema = z.enum([
  "remote",
  "hybrid",
  "on-site",
  "unknown",
]);

/**
 * Zod schema for Hugging Face LLM structured classification output.
 * Validates the raw JSON output produced by the LangChain + HF pipeline.
 */
export const JobClassificationOutputSchema = z.object({
  role: RoleCategorySchema,
  jobType: JobTypeSchema,
  experienceLevel: ExperienceLevelSchema,
  isFresherEligible: z.boolean(),
  classifiedCity: z.string().min(1),
  classifiedCountry: z.string().min(1),
  confidenceScore: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
});

export type JobClassificationOutput = z.infer<
  typeof JobClassificationOutputSchema
>;

/**
 * Zod schema for Canonical Job.
 * Validates that jobs entering and exiting the pipeline have valid fields,
 * real non-empty IDs, non-empty direct source and application URLs, valid ISO dates, etc.
 */
export const CanonicalJobSchema = z.object({
  id: z.string().min(1),
  sourceJobId: z.string().min(1),
  source: JobSourceSchema,
  sourceUrl: z.string().url(),
  applicationUrl: z.string().url(),
  title: z.string().min(1),
  company: z.string().min(1),
  description: z.string(),
  city: z.string().min(1),
  state: z.string().optional(),
  country: z.string().min(1),
  isRemote: z.boolean(),
  workMode: WorkModeSchema.default("unknown"),
  rawLocation: z.string().default(""),
  publishedAt: z.string().datetime({ offset: true }),
  fetchedAt: z.string().datetime({ offset: true }),
  isFresherCandidate: z.boolean(),
  postedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
  lastSyncedAt: z.string().optional(),
  sourceStatus: z.enum(["active", "closed", "unverified"]).optional(),
  timestampKind: z.enum(["posted", "updated", "published", "unknown"]).optional(),
  isTimestampReliable: z.boolean().optional(),
  isWithin24Hours: z.boolean().optional(),
  experienceRange: z.enum(["0-1", "0-2", "0-3", "internship", "experienced", "unknown"]).optional(),
  role: RoleCategorySchema.optional(),
  normalized_role: z.string().optional(),
  role_cluster: z.string().optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  relevanceExplanation: z.string().optional(),
  reasoning_summary: z.string().optional(),
  classificationStatus: z.enum(["llm_success", "llm_cached", "llm_failed", "llm_not_run"]).optional(),
  llmError: z.string().optional(),
  experience_min_years: z.number().nullable().optional(),
  experience_max_years: z.number().nullable().optional(),
  skills: z.array(z.string()).optional(),
  confidence: z
    .object({
      role: z.enum(["high", "medium", "low"]).optional(),
      city: z.enum(["high", "medium", "low"]).optional(),
      work_mode: z.enum(["high", "medium", "low"]).optional(),
    })
    .optional(),
  jobType: JobTypeSchema.optional(),
  experienceLevel: ExperienceLevelSchema.optional(),
  isFresherEligible: z.boolean().optional(),
  classifiedCity: z.string().optional(),
  classifiedCountry: z.string().optional(),
  dedupKey: z.string().min(1),
  crossDedupKey: z.string().min(1),
  isActive: z.boolean(),
  classifiedAt: z.string().datetime({ offset: true }).optional(),
});
