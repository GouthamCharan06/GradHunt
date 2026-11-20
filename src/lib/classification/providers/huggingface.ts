/**
 * GradHunt — Hugging Face Inference API Provider
 *
 * Implements Step 8 & 9:
 * Calls Hugging Face hosted inference API to tag role, city, and workMode.
 * Uses strict Zod schema validation and rejects malformed responses without inventing data.
 */

import { z } from "zod";
import { Job } from "../../types/job";
import { ClassificationProvider, JobClassification } from "../types";
import {
  ROLE_TAXONOMY,
  normalizeIndianCity,
  normalizeWorkMode,
  deriveRoleCluster,
  ClassifiedRole,
} from "../taxonomy";

const ClassificationOutputSchema = z.object({
  role: z.enum(ROLE_TAXONOMY),
  city: z.string().min(1),
  workMode: z.enum(["remote", "hybrid", "on-site", "unknown"]),
});

export class HuggingFaceProvider implements ClassificationProvider {
  name = "huggingface";
  private apiKey: string;
  private model: string;
  private endpoint: string;
  private timeoutMs: number;

  constructor(options: {
    apiKey?: string;
    model?: string;
    endpoint?: string;
    timeoutMs?: number;
  } = {}) {
    this.apiKey = options.apiKey || process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN || "";
    this.model = options.model || process.env.LLM_MODEL || "meta-llama/Llama-3.2-3B-Instruct";
    this.endpoint =
      options.endpoint ||
      process.env.HUGGINGFACE_INFERENCE_URL ||
      `https://api-inference.huggingface.co/models/${this.model}`;
    this.timeoutMs = options.timeoutMs || parseInt(process.env.LLM_TIMEOUT_MS || "15000", 10);
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async classify(job: Job): Promise<JobClassification> {
    if (!this.isAvailable()) {
      throw new Error("Hugging Face API key not configured (HUGGINGFACE_API_KEY or HF_TOKEN required)");
    }

    const taxonomyList = ROLE_TAXONOMY.join(", ");
    const snippet = job.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 800);

    const prompt = `You are an automated job taxonomy classifier for an Indian job discovery platform.
Analyze this job and classify it. Output ONLY a valid JSON object, with no markdown backticks, no explanations, no other text.

Allowed roles (choose exactly one):
[${taxonomyList}]

Job Details:
Title: ${job.title}
Company: ${job.company}
Location: ${job.rawLocation || job.city}
Snippet: ${snippet}

Required JSON structure:
{"role": "Role Name", "city": "City Name or Pan-India", "workMode": "remote|hybrid|on-site|unknown"}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 120,
            temperature: 0.01,
            return_full_text: false,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hugging Face inference error (HTTP ${response.status}): ${errorText.slice(0, 200)}`);
      }

      const json = await response.json();
      let rawText = "";

      if (Array.isArray(json) && json[0]?.generated_text) {
        rawText = json[0].generated_text;
      } else if (typeof json === "string") {
        rawText = json;
      } else if (json.generated_text) {
        rawText = json.generated_text;
      } else {
        rawText = JSON.stringify(json);
      }

      // Extract JSON payload
      const cleaned = rawText
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error(`LLM output did not contain a valid JSON object: "${cleaned.slice(0, 100)}"`);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = ClassificationOutputSchema.parse(parsed);

      const role = validated.role as ClassifiedRole;
      return {
        role,
        role_cluster: deriveRoleCluster(role),
        city: normalizeIndianCity(validated.city, job.rawLocation || job.city),
        workMode: normalizeWorkMode(validated.workMode, job.rawLocation),
        job_type: job.jobType || "full-time",
        relevanceScore: 75,
        relevanceExplanation: "Hugging Face fallback tagging",
        source: "llm",
        model: this.model,
        rawResponse: jsonMatch[0],
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
