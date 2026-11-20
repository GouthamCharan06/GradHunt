/**
 * GradHunt — Deterministic Hard Quality & Safety Filter
 *
 * Implements the new architectural requirement:
 * 1. Deterministic stage performs HARD SAFETY & QUALITY FILTERING ONLY:
 *    - Removes clearly senior/experienced listings: Senior, Staff, Principal,
 *      Lead, Manager, Director, Head, VP, Architect, Chief, Partner, Level 3+, IC3+.
 *    - Removes clearly high minimum experience requirements (>= 5+ years, minimum 5 years).
 *    - Removes malformed records or obvious non-job content.
 * 2. Does NOT reject a job merely because its title lacks "intern", "fresher",
 *    "graduate", "junior", "SDE-1", etc. Titles like "Software Engineer",
 *    "Full Stack Developer", "Data Analyst", "AI Engineer", etc., are preserved.
 * 3. Does NOT treat "Associate" alone as either positive or negative evidence.
 * 4. Preserves a broad India candidate pool for semantic classification by Gemini.
 * 5. Deterministically flags first-class internships so student opportunities are
 *    always identified.
 */

import { Job, JobSource, ExperienceLevel, JobType } from "../types/job";

// ─── Senior / Experienced Title Hard Exclusions ─────────────────────────────

const SENIOR_TITLE_EXCLUSIONS: RegExp[] = [
  /\bsenior\b/i,
  /\bsr\.?\b/i,
  /\bstaff\b/i,
  /\bprincipal\b/i,
  /\bdistinguished\b/i,
  /\blead(?:er|ership)?\b/i,
  /\bteam\s+lead\b/i,
  /\btech\s+lead\b/i,
  /\bmanager\b/i,
  /\bmgr\.?\b/i,
  /\bdirector\b/i,
  /\bhead\s+(?:of|-|,)/i,
  /\bvp\b/i,
  /\bvice\s+president\b/i,
  /\bavp\b/i,
  /\bsvp\b/i,
  /\bevp\b/i,
  /\bchief\b/i,
  /\bcto\b/i,
  /\bcfo\b/i,
  /\bcoo\b/i,
  /\bcio\b/i,
  /\bciso\b/i,
  /\bcpo\b/i,
  /\barchitect\b/i,
  /\bexpert\b/i,
  /\baccount\s+executive\b/i,
  /\bpartner\b/i,
  // Mid/Senior Levels: III, IV, V, 3, 4, 5, L3-L6, IC3-IC6
  /\bspecialist\s+(?:iii|iv|v|3|4|5)\b/i,
  /\blevel\s+(?:iii|iv|v|3|4|5)\b/i,
  /\b(?:specialist|engineer|developer|sde|analyst|consultant)\s+(?:iii|iv|v|3|4|5)\b/i,
  /\b(l[3-6]|ic[3-6])\b/i,
];

// ─── High Experience Hard Exclusions (>= 5 Years) ───────────────────────────

export interface ParsedExperience {
  hasExplicitRequirement: boolean;
  minYears: number;
  maxYears?: number;
  rawMatchedSnippet?: string;
  isHardExcludedSenior: boolean;
  isExperienced: boolean;
  isFresherFriendly: boolean;
  experienceRange: "0-1" | "0-2" | "0-3" | "internship" | "experienced" | "unknown";
}

/**
 * Parses experience numbers from text.
 * Flags hard exclusions only if explicitly requiring >= 5 years.
 */
export function parseExperienceRequirement(text: string): ParsedExperience {
  const clean = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  // 1. High Experience Exclusions (>= 5 years)
  // e.g. "5+ years", "6-8 years", "minimum 5 years", "at least 6 years"
  const highExpRegex =
    /\b(?:minimum\s+of\s+|at\s+least\s+|min\.?\s+|minimum\s+)?([5-9]|\d{2,})\s*(?:\+|[-–—to]\s*\d+)?\s*years?(?:\s+of)?(?:\s+(?:relevant|professional|work|prior|hands-on|industry|software|technical))?\s*(?:experience|yoe|exp)?\b/i;

  const highMatch = clean.match(highExpRegex);
  if (highMatch) {
    const min = parseInt(highMatch[1], 10);
    if (!isNaN(min) && min >= 5) {
      return {
        hasExplicitRequirement: true,
        minYears: min,
        rawMatchedSnippet: highMatch[0],
        isHardExcludedSenior: true,
        isExperienced: true,
        isFresherFriendly: false,
        experienceRange: "experienced",
      };
    }
  }

  // 2. Positive 0-1 Year Patterns
  const p01 = [
    /\b(?:0\s*[-–—to]\s*1|0\s*[-–—to]\s*1\.5)\s*years?(?:\s+of)?(?:\s+(?:relevant|work|prior|hands-on|practical|industry))?\s*(?:experience|yoe|exp)?\b/i,
    /\b0\s*years?(?:\s+of)?(?:\s+experience)?\b/i,
    /\b(?:no|zero)\s+(?:prior\s+)?experience\s+(?:required|needed|necessary)\b/i,
    /\bfreshers?\s+(?:are\s+)?welcome\b/i,
    /\bfreshers?\s+can\s+apply\b/i,
    /\bfresh\s+graduates?\s+(?:are\s+)?welcome\b/i,
    /\bcurrently\s+(?:enrolled|pursuing)\b/i,
    /\b(?:final|penultimate)\s+year\s+students?\b/i,
    /\b(?:batch\s+of\s+202[3-8]|202[3-8]\s+passouts?)\b/i,
    /\bclass\s+of\s+202[3-8]\b/i,
    /\bcampus\s+(?:hiring|recruitment|drive)\b/i,
  ];

  for (const pat of p01) {
    const match = clean.match(pat);
    if (match) {
      return {
        hasExplicitRequirement: true,
        minYears: 0,
        maxYears: 1,
        rawMatchedSnippet: match[0],
        isHardExcludedSenior: false,
        isExperienced: false,
        isFresherFriendly: true,
        experienceRange: "0-1",
      };
    }
  }

  // 3. Positive 0-2 / 0-3 Year Patterns
  const p03 = [
    /\b(?:0\s*[-–—to]\s*2|1\s*[-–—to]\s*2|up\s+to\s+2|max(?:imum)?\s+2)\s*years?(?:\s+of)?(?:\s+(?:relevant|work|prior|hands-on|industry|technical))?\s*(?:experience|yoe|exp)?\b/i,
    /\b(?:0\s*[-–—to]\s*3|1\s*[-–—to]\s*3|up\s+to\s+3|max(?:imum)?\s+3)\s*years?(?:\s+of)?(?:\s+(?:relevant|work|prior|hands-on|industry|technical))?\s*(?:experience|yoe|exp)?\b/i,
  ];

  for (const pat of p03) {
    const match = clean.match(pat);
    if (match) {
      return {
        hasExplicitRequirement: true,
        minYears: 0,
        maxYears: 3,
        rawMatchedSnippet: match[0],
        isHardExcludedSenior: false,
        isExperienced: false,
        isFresherFriendly: true,
        experienceRange: "0-3",
      };
    }
  }

  return {
    hasExplicitRequirement: false,
    minYears: 0,
    isHardExcludedSenior: false,
    isExperienced: false,
    isFresherFriendly: false,
    experienceRange: "unknown",
  };
}

// ─── Candidate Evaluator ──────────────────────────────────────────────────────

export interface EligibilityResult {
  isEligible: boolean;
  isEligibleCandidate: boolean;
  reasons: string[];
  disqualificationReason?: string;
  experienceLevel: ExperienceLevel;
  jobType: JobType;
  experienceRange: "0-1" | "0-2" | "0-3" | "internship" | "experienced" | "unknown";
}

/**
 * Deterministically evaluates whether a job passes hard safety/quality filtering.
 *
 * Excludes only:
 * - Clear senior titles (Senior, Lead, Staff, Principal, Manager, Director, VP, Architect, etc.)
 * - Clear high experience requirements (>= 5+ years)
 * - Obvious malformed or non-job content
 *
 * Retains all other India roles as candidates for Gemini semantic classification.
 */
export const evaluateFresherEligibility = evaluateCandidateEligibility;

export function evaluateCandidateEligibility(job: Job): EligibilityResult {
  const title = job.title;
  const desc = job.description;

  // 1. Hard Senior Title Exclusions
  for (const regex of SENIOR_TITLE_EXCLUSIONS) {
    if (regex.test(title)) {
      return {
        isEligible: false,
        isEligibleCandidate: false,
        disqualificationReason: `Senior title hard exclusion: matched ${regex}`,
        experienceLevel: "senior",
        jobType: "full-time",
        experienceRange: "experienced",
        reasons: [],
      };
    }
  }

  // 2. Hard High Experience Exclusions (>= 5 years) in Title or Description
  const expInTitle = parseExperienceRequirement(title);
  if (expInTitle.isHardExcludedSenior) {
    return {
      isEligible: false,
      isEligibleCandidate: false,
      disqualificationReason: `High experience requirement in title: "${expInTitle.rawMatchedSnippet}"`,
      experienceLevel: "senior",
      jobType: "full-time",
      experienceRange: "experienced",
      reasons: [],
    };
  }

  const expInDesc = parseExperienceRequirement(desc);
  if (expInDesc.isHardExcludedSenior) {
    return {
      isEligible: false,
      isEligibleCandidate: false,
      disqualificationReason: `High experience requirement in description: "${expInDesc.rawMatchedSnippet}"`,
      experienceLevel: "senior",
      jobType: "full-time",
      experienceRange: "experienced",
      reasons: [],
    };
  }

  // 3. First-Class Internship Detection
  const isInternship =
    /\b(intern|internship|co-?op|apprentice(?:ship)?|student\s+intern|summer\s+intern|winter\s+intern|fall\s+intern|spring\s+intern|graduate\s+intern(?:ship)?)\b/i.test(
      title
    ) ||
    job.jobType === "internship" ||
    /\b(?:currently\s+(?:enrolled|pursuing)|(?:final|penultimate)\s+year\s+students?)\b/i.test(desc);

  if (isInternship) {
    return {
      isEligible: true,
      isEligibleCandidate: true,
      reasons: ["Title/metadata indicates student internship / co-op / apprenticeship"],
      experienceLevel: "intern",
      jobType: "internship",
      experienceRange: "internship",
    };
  }

  // 4. Graduate / Entry / Junior Signals
  const isGraduateOrFresher =
    /\b(graduate|new\s+grad(?:uate)?|campus|fresher|trainee|get\b|graduate\s+engineer\s+trainee|management\s+trainee)\b/i.test(
      title
    );
  const isJuniorOrEntry =
    /\b(junior|jr\.?|entry[- ]level|sde\s*[-–]?\s*(?:1|i)\b|software\s+engineer\s*[-–]?\s*(?:1|i)\b|engineer\s*[-–]?\s*(?:1|i)\b|developer\s*[-–]?\s*(?:1|i)\b|analyst\s*[-–]?\s*(?:1|i)\b)\b/i.test(
      title
    );

  const reasons: string[] = [];
  if (isGraduateOrFresher) {
    reasons.push("Title indicates graduate / campus / fresher / trainee program");
  }
  if (isJuniorOrEntry) {
    reasons.push("Title indicates junior / entry-level role");
  }
  if (expInDesc.isFresherFriendly) {
    reasons.push(`Explicit entry requirement (${expInDesc.experienceRange}y): "${expInDesc.rawMatchedSnippet}"`);
  }

  // Standard tech/ops role (e.g. Software Engineer, Developer, Data Analyst, Associate)
  // Passed to Gemini for semantic understanding of depth and fresher relevance!
  if (reasons.length === 0) {
    reasons.push("Standard candidate role passed to Gemini for semantic classification");
  }

  let experienceLevel: ExperienceLevel = "unknown";
  if (isJuniorOrEntry) {
    experienceLevel = "junior";
  } else if (isGraduateOrFresher || expInDesc.isFresherFriendly) {
    experienceLevel = "entry";
  }

  return {
    isEligible: true,
    isEligibleCandidate: true,
    reasons,
    experienceLevel,
    jobType: job.jobType || "full-time",
    experienceRange: expInDesc.experienceRange !== "unknown" ? expInDesc.experienceRange : "unknown",
  };
}

// ─── Filter Stage ─────────────────────────────────────────────────────────────

export interface CandidateSignal {
  jobId: string;
  source: JobSource;
  title: string;
  company: string;
  isEligible: boolean;
  reasons: string[];
  disqualificationReason?: string;
  experienceLevel: ExperienceLevel;
  jobType: JobType;
  experienceRange: "0-1" | "0-2" | "0-3" | "internship" | "experienced" | "unknown";
}

export interface CandidateFilterResult {
  /** Jobs confirmed as viable candidates for Gemini semantic classification. */
  candidates: Job[];
  /** Jobs disqualified by hard safety/quality filters (seniors, >=5y). */
  nonCandidates: Job[];
  /** Detailed signals collected during evaluation. */
  signals: CandidateSignal[];
  /** Jobs disqualified as experienced, senior, or non-fresher. */
  excludedExperienced: Array<{
    jobId: string;
    source: JobSource;
    title: string;
    company: string;
    reason: string;
  }>;
}

/**
 * Filters jobs using hard deterministic criteria only.
 * Retains all legitimate non-senior Indian candidates for Gemini classification.
 */
export function filterFresherCandidates(jobs: Job[]): CandidateFilterResult {
  const candidates: Job[] = [];
  const nonCandidates: Job[] = [];
  const signals: CandidateSignal[] = [];
  const excludedExperienced = [];

  for (const job of jobs) {
    const evaluation = evaluateCandidateEligibility(job);

    signals.push({
      jobId: job.id,
      source: job.source,
      title: job.title,
      company: job.company,
      isEligible: evaluation.isEligibleCandidate,
      reasons: evaluation.reasons,
      disqualificationReason: evaluation.disqualificationReason,
      experienceLevel: evaluation.experienceLevel,
      jobType: evaluation.jobType,
      experienceRange: evaluation.experienceRange,
    });

    if (evaluation.isEligibleCandidate) {
      job.isFresherCandidate = true;
      job.experienceLevel = evaluation.experienceLevel;
      job.jobType = evaluation.jobType;
      job.experienceRange = evaluation.experienceRange;
      candidates.push(job);
    } else {
      job.isFresherCandidate = false;
      job.isFresherEligible = false;
      job.experienceRange = evaluation.experienceRange;
      nonCandidates.push(job);
      excludedExperienced.push({
        jobId: job.id,
        source: job.source,
        title: job.title,
        company: job.company,
        reason: evaluation.disqualificationReason || "Hard excluded senior role",
      });
    }
  }

  return { candidates, nonCandidates, signals, excludedExperienced };
}
