/**
 * GradHunt — Controlled Role Taxonomy & Normalization
 *
 * Implements Step 10:
 * Controlled taxonomy: Software Engineering, Data & AI, DevOps & Cloud,
 * Cybersecurity, Product, Design, Marketing, Sales, Finance, HR,
 * Operations, Customer Support, Research, and Other.
 */

import { WorkMode } from "../types/job";
import { INDIAN_CITY_CANONICAL_MAP, INDIAN_STATES } from "../pipeline/normalize";

export const ROLE_TAXONOMY = [
  "Software Engineering",
  "Data & AI",
  "DevOps & Cloud",
  "Cybersecurity",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Finance",
  "HR",
  "Operations",
  "Customer Support",
  "Research",
  "Other",
] as const;

export type ClassifiedRole = (typeof ROLE_TAXONOMY)[number];

export const ROLE_CLUSTERS = [
  "Software Engineering",
  "Data & AI",
  "DevOps & Cloud",
  "Cybersecurity",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Finance",
  "HR",
  "Operations",
  "Customer Support",
  "Research",
  "Other",
] as const;

export type RoleCluster = (typeof ROLE_CLUSTERS)[number];

export function deriveRoleCluster(role: string): RoleCluster {
  const r = role.toLowerCase();
  if (r.includes("cyber") || r.includes("security") || r.includes("infosec")) return "Cybersecurity";
  if (r.includes("devops") || r.includes("cloud") || r.includes("sre") || r.includes("infrastructure")) return "DevOps & Cloud";
  if (r.includes("data") || r.includes("ai") || r.includes("machine learning") || r.includes("ml")) return "Data & AI";
  if (r.includes("product")) return "Product";
  if (r.includes("design") || r.includes("ui") || r.includes("ux")) return "Design";
  if (r.includes("marketing") || r.includes("growth") || r.includes("content")) return "Marketing";
  if (r.includes("sales") || r.includes("business development")) return "Sales";
  if (r.includes("finance") || r.includes("accounting") || r.includes("payroll")) return "Finance";
  if (r.includes("hr") || r.includes("human resources") || r.includes("talent") || r.includes("people")) return "HR";
  if (r.includes("operations") || r.includes("logistics")) return "Operations";
  if (r.includes("support") || r.includes("customer")) return "Customer Support";
  if (r.includes("research")) return "Research";
  if (
    r.includes("software") ||
    r.includes("engineer") ||
    r.includes("developer") ||
    r.includes("frontend") ||
    r.includes("backend") ||
    r.includes("full-stack") ||
    r.includes("mobile") ||
    r.includes("qa") ||
    r.includes("test") ||
    r.includes("it") ||
    r.includes("hardware")
  ) {
    return "Software Engineering";
  }
  return "Other";
}

export function isValidRole(role: string): role is ClassifiedRole {
  return ROLE_TAXONOMY.includes(role as ClassifiedRole);
}

/**
 * High-precision deterministic role classifier.
 * Used as the bedrock baseline and as a deterministic fallback if the LLM provider
 * is unconfigured, times out, or produces unparseable output.
 */
export function classifyRoleDeterministically(title: string, description: string = ""): ClassifiedRole {
  const text = `${title} ${title}`.toLowerCase(); // double weight title

  // 1. Cybersecurity
  if (/\b(cyber\s*security|infosec|information\s+security|penetration\s+test|soc\s+analyst|security\s+operations|soc\b|security\s+engineer|security\s+analyst|security\s+intern|vulnerability)\b/i.test(text)) {
    return "Cybersecurity";
  }

  // 2. DevOps & Cloud
  if (/\b(devops|sre|site\s+reliability|cloud\b|cloud\s+engineer|cloud\s+architect|cloud\s+support|infrastructure|platform\s+engineer|systems?\s+engineer|kubernetes|ci\s*\/\s*cd)\b/i.test(text)) {
    return "DevOps & Cloud";
  }

  // 3. Data & AI
  if (/\b(data\s+analyst|data\s+scientist|data\s+engineer|machine\s+learning|ml\b|ai\b|artificial\s+intelligence|deep\s+learning|nlp|computer\s+vision|bi\s+developer|business\s+intelligence|analytics\s+engineer)\b/i.test(text)) {
    return "Data & AI";
  }

  // 4. Product
  if (/\b(product\s+manager|product\s+management|apm\b|associate\s+product\s+manager|product\s+analyst|product\s+owner)\b/i.test(text)) {
    return "Product";
  }

  // 5. Design
  if (/\b(ui\s*\/\s*ux|ui\s+designer|ux\s+designer|product\s+designer|graphic\s+designer|visual\s+designer|web\s+designer)\b/i.test(text)) {
    return "Design";
  }

  // 6. Marketing
  if (/\b(marketing|growth|seo|sem|content\s+writer|content\s+marketing|social\s+media|digital\s+marketing|brand|communications?)\b/i.test(text)) {
    return "Marketing";
  }

  // 7. Sales
  if (/\b(sales|business\s+development|bdr\b|sdr\b|inside\s+sales|account\s+executive|account\s+representative)\b/i.test(text)) {
    return "Sales";
  }

  // 8. Finance
  if (/\b(finance|financial|accountant|accounting|accounts|payroll|tax|taxation|audit|auditor|treasury|billing)\b/i.test(text)) {
    return "Finance";
  }

  // 9. HR
  if (/\b(human\s+resources|hr\b|talent\s+acquisition|recruiter|recruiting|people\s+operations|people\s+ops)\b/i.test(text)) {
    return "HR";
  }

  // 10. Operations
  if (/\b(operations|logistics|supply\s+chain|procurement|facilities|workplace)\b/i.test(text)) {
    return "Operations";
  }

  // 11. Customer Support
  if (/\b(customer\s+support|customer\s+success|technical\s+support|helpdesk|client\s+support|support\s+engineer|service\s+desk)\b/i.test(text)) {
    return "Customer Support";
  }

  // 12. Research
  if (/\b(researcher|research\s+scientist|research\s+intern|applied\s+scientist|postdoc)\b/i.test(text)) {
    return "Research";
  }

  // 13. Software Engineering (broadest tech category)
  if (/\b(software\s+engineer|software\s+developer|developer|sde|frontend|backend|full[- ]?stack|web\s+developer|mobile\s+developer|ios|android|qa\s+engineer|test\s+engineer|quality\s+assurance|firmware|embedded|programmer)\b/i.test(text)) {
    return "Software Engineering";
  }

  return "Other";
}

/**
 * Normalizes Indian city strictly without inventing locations.
 * Uses the canonical Indian city map or preserves the source location.
 */
export function normalizeIndianCity(candidateCity: string, rawLocation: string): string {
  const check = (candidateCity + " " + rawLocation).toLowerCase().trim();

  // Sort by length descending so "new delhi" matches before "delhi"
  const sortedKeys = Object.keys(INDIAN_CITY_CANONICAL_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const reg = new RegExp(`\\b${key}\\b`, "i");
    if (reg.test(check)) {
      return INDIAN_CITY_CANONICAL_MAP[key];
    }
  }

  for (const state of INDIAN_STATES) {
    const reg = new RegExp(`\\b${state}\\b`, "i");
    if (reg.test(check)) {
      return state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
    }
  }

  if (check.includes("pan-india") || check.includes("pan india") || check.includes("india")) {
    return "Pan-India";
  }

  return candidateCity.trim() || "Pan-India";
}

/**
 * Normalizes work mode deterministically based on source signals.
 */
export function normalizeWorkMode(mode: string | undefined, rawLocation: string = ""): WorkMode {
  const s = (mode ?? "").toLowerCase().trim();
  const raw = rawLocation.toLowerCase();

  if (s === "remote" || raw.includes("remote") || raw.includes("work from home") || raw.includes("wfh")) {
    return "remote";
  }
  if (s === "hybrid" || raw.includes("hybrid")) {
    return "hybrid";
  }
  if (s === "on-site" || s === "onsite" || raw.includes("on-site") || raw.includes("onsite")) {
    return "on-site";
  }
  return "unknown";
}
