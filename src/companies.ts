export type Company = {
  /** Stable id used in KV keys — do not rename after first deploy */
  id: string;
  name: string;
  /** Career / jobs search URL to poll */
  url: string;
  /**
   * html — plain fetch (default)
   * browser — Cloudflare Browser Run (JS-rendered pages like Meta)
   */
  fetchMode?: "html" | "browser";
  /**
   * keywords — title/URL must match new-grad + SWE keywords (default)
   * all_jobs — any job detail link matching jobPathPattern
   *            (use when the URL is already filtered, e.g. Meta University Grad)
   */
  matchMode?: "keywords" | "all_jobs";
  /** Regex tested against pathname for all_jobs mode (default: /\/jobs\/\d+/i) */
  jobPathPattern?: string;
  /** Title/URL must match at least one (new-grad signal); keywords mode only */
  keywords?: string[];
  /** Title/URL must match at least one (SWE signal); keywords mode only */
  roleKeywords?: string[];
};

export const DEFAULT_KEYWORDS = [
  "new grad",
  "university",
  "early career",
  "grad",
  "campus",
  "university grad",
  "new graduate",
] as const;

export const DEFAULT_ROLE_KEYWORDS = [
  "software engineer",
  "swe",
  "software developer",
  "software engineering",
] as const;

export const DEFAULT_JOB_PATH_PATTERN = String.raw`/jobs/\d+`;

/**
 * Add companies one by one, then redeploy (or restart wrangler dev --remote).
 */
export const COMPANIES: Company[] = [
  {
    id: "meta",
    name: "Meta",
    url: "https://www.metacareers.com/jobsearch/?teams[0]=University%20Grad%20-%20Engineering%2C%20Tech%20%26%20Design&offices[0]=Menlo%20Park%2C%20CA",
    fetchMode: "browser",
    matchMode: "all_jobs",
    // Meta job detail pages look like /jobs/123456789012345
    jobPathPattern: String.raw`/jobs/\d+`,
  },
];
