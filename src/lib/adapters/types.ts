/**
 * GradHunt — Source Adapter Types
 *
 * Raw record types for each source and the shared adapter interface.
 * These are the shapes returned by the source APIs BEFORE normalization.
 * Normalization into the canonical Job schema happens in Phase 3.
 */

import { JobSource, SourceError } from "../types/job";

// ─── Shared Adapter Interface ─────────────────────────────────────────────────

/** What every source adapter must return. */
export interface RawFetchResult<T = unknown> {
  source: JobSource;
  /** Raw records exactly as returned by the source API (typed per source). */
  records: T[];
  /** Per-board/slug errors that didn't prevent partial results. */
  errors: SourceError[];
  /** Total fetch duration in milliseconds. */
  durationMs: number;
  /** ISO-8601 timestamp when the fetch started. */
  fetchedAt: string;
}

/** Diagnostic summary for development logging. */
export interface AdapterDiagnostics {
  source: JobSource;
  totalRecords: number;
  withUsableId: number;
  withTimestamp: number;
  withApplicationUrl: number;
  withDescription: number;
  boardsAttempted: number;
  boardsSucceeded: number;
  boardsFailed: number;
  durationMs: number;
  errors: string[];
}

// ─── Greenhouse Raw Types ─────────────────────────────────────────────────────

export interface GreenhouseRawJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  internal_job_id: number;
  location: {
    name: string;
  };
  metadata: Array<{
    id: number;
    name: string;
    value: string | string[] | null;
    value_type: string;
  }>;
  content: string; // HTML description
  departments: Array<{
    id: number;
    name: string;
    parent_id: number | null;
    child_ids: number[];
  }>;
  offices: Array<{
    id: number;
    name: string;
    location: string;
    parent_id: number | null;
    child_ids: number[];
  }>;
  // Board slug is NOT in the API response — we add it
  _boardSlug: string;
  _company: string;
}

export interface GreenhouseApiResponse {
  jobs: Array<Omit<GreenhouseRawJob, "_boardSlug" | "_company">>;
  meta: {
    total: number;
  };
}

// ─── Lever Raw Types ──────────────────────────────────────────────────────────

export interface LeverRawJob {
  id: string;
  text: string; // job title
  hostedUrl: string; // application URL
  createdAt: number; // Unix timestamp in ms
  categories: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
  description: string; // HTML
  descriptionPlain: string;
  additional: string; // HTML — extra info
  additionalPlain: string;
  lists: Array<{
    text: string;
    content: string; // HTML
  }>;
  country?: string;
  workplaceType?: string;
  // We add this — not from API
  _companySlug: string;
}

// ─── Ashby Raw Types ──────────────────────────────────────────────────────────

export interface AshbyRawJob {
  id: string;
  title: string;
  location: string;
  department: string;
  team?: string;
  employmentType?: string;
  isRemote: boolean;
  publishedAt: string; // ISO-8601
  updatedAt?: string;
  jobUrl: string; // application URL
  applyUrl: string; // direct apply link
  descriptionHtml: string;
  descriptionPlain: string;
  isListed: boolean;
  // We add this — not from API
  _companySlug: string;
  _company: string;
}

export interface AshbyApiResponse {
  jobs: Array<Omit<AshbyRawJob, "_companySlug" | "_company">>;
  apiVersion: string;
}

// ─── SmartRecruiters Raw Types ────────────────────────────────────────────────

export interface SmartRecruitersRawJob {
  id: string;
  name: string;
  uuid?: string;
  refNumber?: string;
  company: {
    identifier: string;
    name: string;
  };
  releasedDate: string; // ISO-8601
  location: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  department?: {
    id?: string;
    label?: string;
  };
  typeOfEmployment?: {
    id?: string;
    label?: string;
  };
  experienceLevel?: {
    id?: string;
    label?: string;
  };
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: {
    sections?: {
      companyDescription?: { text?: string };
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
      additionalInformation?: { text?: string };
    };
  };
  _companySlug: string;
}

export interface SmartRecruitersApiResponse {
  totalFound: number;
  offset: number;
  limit: number;
  content: SmartRecruitersRawJob[];
}

// ─── Recruitee Raw Types ──────────────────────────────────────────────────────

export interface RecruiteeRawJob {
  id: number;
  title: string;
  description?: string;
  requirements?: string;
  careers_url?: string;
  careers_apply_url?: string;
  city?: string;
  state_name?: string;
  country?: string;
  location?: string;
  published_at?: string;
  updated_at?: string;
  on_site?: boolean;
  remote?: boolean;
  _companySlug: string;
  _company: string;
}

export interface RecruiteeApiResponse {
  offers: RecruiteeRawJob[];
}

// ─── Pinpoint Raw Types ───────────────────────────────────────────────────────

export interface PinpointRawJob {
  id: string;
  title: string;
  description?: string;
  skills_knowledge_expertise?: string;
  key_responsibilities?: string;
  url: string;
  employment_type?: string;
  employment_type_text?: string;
  workplace_type?: string;
  workplace_type_text?: string;
  location?: {
    city?: string;
    name?: string;
    province?: string;
    postal_code?: string;
    street_address?: string | null;
  };
  job?: {
    department?: {
      name?: string;
    };
  };
  _companySlug: string;
  _company: string;
}
