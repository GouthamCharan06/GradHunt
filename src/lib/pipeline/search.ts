/**
 * GradHunt — Deterministic Search Relevance Engine
 *
 * Ranks and filters jobs strictly by relevance to the query.
 *
 * Rules:
 *   1. Exact/Phrase title match: Highest weight (150 pts).
 *   2. Token title matches: High weight (50–70 pts).
 *   3. Domain title affinity (e.g. searching "software engineer" boosts software,
 *      developer, sde, backend, frontend, application engineer).
 *   4. Normalized role/category match: Medium weight (30 pts).
 *   5. Company match: Medium weight (20 pts).
 *   6. Weak description-only matches: Receive 0 weight unless title/role has
 *      inherent domain affinity. An unrelated job (e.g. HR Manager) whose description
 *      happens to say "software engineer" receives a score of 0 and is EXCLUDED.
 *   7. Search never overrides eligibility constraints.
 */

import { Job } from "../types/job";

export interface ScoredJob {
  job: Job;
  score: number;
}

/**
 * Computes deterministic relevance score for a job against a query.
 * Returns score > 0 if relevant, or <= 0 if irrelevant.
 */
export function computeSearchRelevance(job: Job, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1; // All jobs match if query is empty

  const title = job.title.toLowerCase();
  const role = (job.role ?? "").toLowerCase();
  const company = job.company.toLowerCase();
  const desc = job.description.toLowerCase();

  let score = 0;

  // 1. Exact Title Match
  if (title === query) {
    score += 150;
  } else if (title.includes(query)) {
    score += 100;
  }

  // 2. Query Tokens in Title
  const queryTokens = query.split(/\s+/).filter((t) => t.length > 1);
  const matchedTokensInTitle = queryTokens.filter((token) => title.includes(token));

  if (queryTokens.length > 1 && matchedTokensInTitle.length === queryTokens.length) {
    score += 70; // All tokens present in title
  } else if (matchedTokensInTitle.length > 0) {
    score += (matchedTokensInTitle.length / queryTokens.length) * 50;
  }

  // 3. Domain Synonyms & Affinity for Software / Engineering Queries
  const isSoftwareSearch =
    /\b(software|developer|engineer|sde|backend|frontend|fullstack|full\s+stack|web|app)\b/i.test(query);

  if (isSoftwareSearch) {
    const isTechTitle =
      /\b(software|developer|sde|backend|frontend|fullstack|full\s+stack|engineer|programmer|application|systems?|web|mobile|intern)\b/i.test(
        title
      );
    if (isTechTitle) {
      score += 35;
    }

    // Heavy penalty for non-engineering titles if search was for software engineer
    const isNonTechTitle =
      /\b(marketing|sales|recruiter|human\s+resources|hr|public\s+relations|operations|talent|account\s+executive|finance|legal|admin)\b/i.test(
        title
      );
    if (isNonTechTitle && !title.includes("software")) {
      return 0; // Exclude entirely
    }
  }

  // 4. Role Category Match
  if (role && (role.includes(query) || query.includes(role))) {
    score += 30;
  }

  // 5. Company Match
  if (company === query) {
    score += 40;
  } else if (company.includes(query)) {
    score += 20;
  }

  // 6. Weak Description Match
  // Description match ONLY adds minimal points (5 pts) and ONLY if title or role
  // already had a positive match! A description-only match gets 0 and is excluded.
  if (score > 0 && desc.includes(query)) {
    score += 5;
  }

  return score;
}

/**
 * Filters and ranks jobs by relevance to query.
 * Irrelevant jobs (score <= 0) are excluded.
 * Default ranking: Strict latest application to oldest (newest first),
 * with search relevance score as tie-breaker.
 */
export function searchAndRankJobs(jobs: Job[], query: string, sortByDate: boolean = true): Job[] {
  if (!query || query.trim().length === 0) {
    return jobs;
  }

  const scored: ScoredJob[] = [];

  for (const job of jobs) {
    const score = computeSearchRelevance(job, query);
    if (score > 0) {
      scored.push({ job, score });
    }
  }

  // Rank by latest application first (or score if explicitly requested)
  scored.sort((a, b) => {
    if (sortByDate) {
      const timeA = new Date(a.job.postedAt || a.job.publishedAt).getTime();
      const timeB = new Date(b.job.postedAt || b.job.publishedAt).getTime();
      if (!isNaN(timeA) && !isNaN(timeB) && timeB !== timeA) {
        return timeB - timeA; // Latest date first
      }
      return b.score - a.score;
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeA = new Date(a.job.postedAt || a.job.publishedAt).getTime();
    const timeB = new Date(b.job.postedAt || b.job.publishedAt).getTime();
    return timeB - timeA;
  });

  return scored.map((s) => s.job);
}
