/**
 * GradHunt — Environment Configuration
 *
 * Validates and exports environment variables.
 * Fails loudly at startup if required variables are missing.
 */

function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(
      `[GradHunt] Missing required environment variable: ${name}. ` +
        `Check your .env.local or Vercel environment settings.`
    );
  }
  return value ?? "";
}

export function getConfig() {
  return {
    /** Hugging Face API token for LLM classification. */
    huggingFaceApiToken: getEnvVar("HUGGINGFACE_API_TOKEN", false),

    /** Hugging Face model ID for classification. */
    huggingFaceModelId: getEnvVar(
      "HUGGINGFACE_MODEL_ID",
      false
    ) || "mistralai/Mixtral-8x7B-Instruct-v0.1",

    /** Cron secret for securing the /api/refresh endpoint. */
    cronSecret: getEnvVar("CRON_SECRET", false),

    /** Node environment. */
    nodeEnv: process.env.NODE_ENV ?? "development",

    /** Whether we're in production. */
    isProduction: process.env.NODE_ENV === "production",

    /** Base URL for the application. */
    baseUrl: getEnvVar("NEXT_PUBLIC_BASE_URL", false) || "http://localhost:3000",
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
