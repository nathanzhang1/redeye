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
   * CSS selector for Browser Run waitForSelector (faster than networkidle).
   * Only used when fetchMode is "browser".
   */
  browserWaitForSelector?: string;
  /**
   * keywords — title/URL must match new-grad + SWE keywords (default)
   * all_jobs — any job detail link matching jobPathPattern
   *            (use when the URL is already filtered, e.g. Meta University Grad)
   */
  matchMode?: "keywords" | "all_jobs";
  /** Regex tested against pathname for all_jobs mode (default: /\/jobs\/\d+/i) */
  jobPathPattern?: string;
  /**
   * If set, job title must match at least one (case-insensitive, word-boundary).
   * Applied after matchMode filtering.
   */
  titleIncludes?: string[];
  /**
   * If set, skip jobs whose title matches any of these (same matching rules as
   * titleIncludes). Applied after titleIncludes.
   */
  titleExcludes?: string[];
  /**
   * Greenhouse-style `{ departments: [{ name, jobs }] }` feeds: only include jobs
   * from departments whose name exactly matches one of these (case-insensitive).
   */
  departmentIncludes?: string[];
  /**
   * If set, job location text must include at least one (case-insensitive).
   * Combined with locationExcludes when both are set.
   */
  locationIncludes?: string[];
  /** If set, skip jobs whose location text includes any of these (case-insensitive). */
  locationExcludes?: string[];
  /**
   * Greenhouse-style job `metadata` entries: each `{ name, value }` must match
   * (case-insensitive) an entry on the job. All listed pairs are required.
   */
  metadataIncludes?: { name: string; value: string }[];
  /**
   * When a JSON feed row has an id but no URL, build one with `{id}` replaced.
   * Example: https://jobs.uber.com/en/jobs/{id}/
   */
  jobUrlTemplate?: string;
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
  "emerging talent",
  "graduate",
] as const;

export const DEFAULT_ROLE_KEYWORDS = [
  "software engineer",
  "swe",
  "software developer",
  "software engineering",
  "software development engineer",
] as const;

export const DEFAULT_JOB_PATH_PATTERN = String.raw`/jobs/\d+`;

/**
 * Add companies one by one, then redeploy (or restart wrangler dev --remote).
 */
export const COMPANIES: Company[] = [
  // HTML/JSON scrapes first so Browser Run quota isn't burned before them.
  {
    id: "amazon",
    name: "Amazon",
    // Jobs for Grads (US + Software Development + PMT). Page is JS-rendered;
    // poll the public search.json that backs the same filters.
    // Human UI: https://www.amazon.jobs/content/en/career-programs/university/jobs-for-grads?country[]=US&category[]=Project/Program/Product+Management--Technical&category[]=Software+Development
    url: "https://www.amazon.jobs/en/search.json?team_category[]=jobs-for-grads&normalized_country_code[]=USA&category[]=software-development&category[]=project-program-product-management-technical&result_limit=100&offset=0&sort=recent",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail pages: /en/jobs/<id>/<slug>
    jobPathPattern: String.raw`/en/jobs/\d+`,
  },
  {
    id: "databricks",
    name: "Databricks",
    // University Recruiting + US careers page is Gatsby/JS; poll Greenhouse board JSON.
    // Human UI: https://www.databricks.com/company/careers/open-positions?department=University%20Recruiting&location=United%20States
    url: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /company/careers/open-positions/job?gh_jid=<id>
    jobPathPattern: String.raw`/company/careers/open-positions/job`,
    titleIncludes: ["New Grad"],
  },
  {
    id: "uber",
    name: "Uber",
    // University + Engineering + US page is Cloudflare-blocked; poll Oracle HCM JSON.
    // Human UI: https://jobs.uber.com/en/jobs/?team=University&subTeam=Engineering&countries=United+States
    // selectedLocationsFacet=300000000484560 is United States.
    url: "https://iaziqy.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=all&finder=findReqs;keyword=Graduate,siteNumber=CX,selectedLocationsFacet=300000000484560,limit=100,offset=0",
    fetchMode: "html",
    matchMode: "all_jobs",
    jobPathPattern: String.raw`/en/jobs/\d+`,
    jobUrlTemplate: "https://jobs.uber.com/en/jobs/{id}/",
    titleIncludes: ["Graduate"],
  },
  {
    id: "netflix",
    name: "Netflix",
    // University Recruiting + Engineering/PM + onsite + UCAN. Eightfold PCS JSON.
    // Human UI: https://explore.jobs.netflix.net/careers?query=University%20Recruiting&Teams=Product%20Management&Teams=Engineering&Work%20Type=onsite&Region=ucan&domain=netflix.com&sort_by=new
    // Currently often empty; bootstrap empty and alert when roles appear.
    url: "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&query=University%20Recruiting&Teams=Product%20Management&Teams=Engineering&Work%20Type=onsite&Region=ucan&sort_by=new&start=0&num=20",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/job/<pid>
    jobPathPattern: String.raw`/careers/job/\d+`,
  },
  {
    id: "stripe",
    name: "Stripe",
    // US + Full time + title "New Grad". Page filters are client-side; we parse
    // __NEXT_DATA__ jobIndexData (see extractJobs).
    // Human UI: https://stripe.com/careers/search?query=New+Grad&locations=North+America--United+States&employment_types=Full+time
    url: "https://stripe.com/careers/search",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/listing/<slug>/<greenhouseId>
    jobPathPattern: String.raw`/careers/listing/[^/]+/\d+`,
    titleIncludes: ["New Grad"],
  },
  {
    id: "coinbase",
    name: "Coinbase",
    // Engineering depts + CA/NY/NC (non-remote). Title: New Grad / Early / Graduate.
    // Human UI: https://www.coinbase.com/careers/positions?department=Engineering,...&location=ca,ny,nc
    url: "https://boards-api.greenhouse.io/v1/boards/coinbase/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/positions/<id>
    jobPathPattern: String.raw`/careers/positions/\d+`,
    departmentIncludes: [
      "Engineering",
      "Engineering - Backend",
      "Engineering - Frontend",
      "Engineering - Infrastructure",
      "Engineering - Managers",
      "Engineering - Security",
    ],
    locationIncludes: [", CA", ", NY", ", NC", "New York", "Charlotte", "San Francisco"],
    locationExcludes: ["Remote"],
    titleIncludes: ["New Grad", "Early", "Graduate"],
  },
  {
    id: "figma",
    name: "Figma",
    // Early Career dept only; exclude PhD titles.
    // Human UI: https://www.figma.com/careers/ (#early-career)
    url: "https://boards-api.greenhouse.io/v1/boards/figma/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Greenhouse detail: /figma/jobs/<id>
    jobPathPattern: String.raw`/jobs/\d+`,
    departmentIncludes: ["Early Career"],
    titleExcludes: ["PhD"],
  },
  {
    id: "notion",
    name: "Notion",
    // Early Career + San Francisco. Titles: New Grad / Early Career
    // (Notion currently posts "Early Career"; keep New Grad for renames).
    // Human UI: https://www.notion.com/careers?department=earlycareer&location=san-francisco-california
    url: "https://api.ashbyhq.com/posting-api/job-board/notion",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Ashby detail: /notion/<uuid>
    jobPathPattern: String.raw`/notion/[0-9a-f-]{36}`,
    departmentIncludes: ["Early Career"],
    locationIncludes: ["San Francisco"],
    titleIncludes: ["New Grad", "Early Career"],
  },
  {
    id: "datadog",
    name: "Datadog",
    // Early Career job type + title Engineer + USA (incl. multi-location).
    // Human UI: https://careers.datadoghq.com/all-jobs/?time_type%5B0%5D=Early%20Career
    url: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs?content=false",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /detail/<id>/?gh_jid=<id>
    jobPathPattern: String.raw`/detail/\d+`,
    metadataIncludes: [
      { name: "Early Career Time Type", value: "Early Career" },
    ],
    titleIncludes: ["Engineer"],
    locationIncludes: ["USA"],
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    // Pre-filtered Avature search: Early Careers + NY/SF + Data / Eng&CTO / Product.
    // Human UI: https://bloomberg.avature.net/careers/SearchJobs/?1845=...&1686=...&2562=...
    url: "https://bloomberg.avature.net/careers/SearchJobs/?1845=%5B162508%2C162484%5D&1845_format=3996&1686=%5B55478%5D&1686_format=2312&2562=%5B219290%2C219293%2C219309%5D&2562_format=6594&listFilterMode=1&jobRecordsPerPage=12&",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/JobDetail/<slug>/<id>
    jobPathPattern: String.raw`/careers/JobDetail/[^/]+/\d+`,
  },
  {
    id: "robinhood",
    name: "Robinhood",
    // Careers UI "Early Talent and Internships" category (hash filters don't persist).
    // Human UI: https://careers.robinhood.com/#page-block-mzzcf1eaais
    // Then new-grad + SWE keywords; drop Intern/Internship titles.
    url: "https://boards-api.greenhouse.io/v1/boards/robinhood/jobs?content=false",
    fetchMode: "html",
    matchMode: "keywords",
    jobPathPattern: String.raw`/jobs/\d+`,
    metadataIncludes: [
      { name: "Careers Page Bucket", value: "EARLY TALENT AND INTERNSHIPS" },
    ],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "shopify",
    name: "Shopify",
    // Engineering & Data page surfaces SWE intern/new-grad postings; board is Ashby
    // behind /careers/feed.xml (discipline filters aren't in the URL).
    // Human UI: https://www.shopify.com/careers/disciplines/engineering-data
    // New-grad + SWE keywords; drop Intern/Internship titles.
    url: "https://www.shopify.com/careers/feed.xml",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /careers/<slug>_<uuid>
    jobPathPattern: String.raw`/careers/[^/]+_[0-9a-f-]{36}`,
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "ramp",
    name: "Ramp",
    // Emerging Talent page lists Ashby team "Emerging Talent - SWE" (hash isn't a filter).
    // Human UI: https://ramp.com/emerging-talent#jobs
    // New-grad + SWE keywords; drop Intern/Internship titles.
    url: "https://api.ashbyhq.com/posting-api/job-board/ramp",
    fetchMode: "html",
    matchMode: "keywords",
    // Ashby detail: /ramp/<uuid>
    jobPathPattern: String.raw`/ramp/[0-9a-f-]{36}`,
    departmentIncludes: ["Emerging Talent - SWE"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    // Careers search=Engineer (client-side); Greenhouse board + title Engineer.
    // Human UI: https://www.cloudflare.com/careers/jobs/?search=Engineer
    // New-grad + SWE keywords (intern Engineer roles won't match new-grad terms).
    url: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs?content=false",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /cloudflare/jobs/<id>
    jobPathPattern: String.raw`/jobs/\d+`,
    titleIncludes: ["Engineer"],
  },
  {
    id: "lyft",
    name: "Lyft",
    // Early Talent dept (page has no open roles right now).
    // Human UI: https://www.lyft.com/careers/early-talent
    // New-grad + SWE keywords; drop Intern/Internship titles.
    url: "https://boards-api.greenhouse.io/v1/boards/lyft/departments",
    fetchMode: "html",
    matchMode: "keywords",
    // CareerPuck detail: /job-board/lyft/job/<id>
    jobPathPattern: String.raw`/job/\d+`,
    departmentIncludes: ["Early Talent"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "apple",
    name: "Apple",
    // Pre-filtered: Fresh Graduates (General) + US + SWE/ML teams
    url: "https://jobs.apple.com/en-us/search?search=Full+Time+Opportunity+for+Fresh+Graduates+%28General%29&sort=relevance&location=united-states-USA&team=machine-learning-infrastructure-MLAI-MLI+deep-learning-and-reinforcement-learning-MLAI-DLRL+natural-language-processing-and-speech-technologies-MLAI-NLP+computer-vision-MLAI-CV+applied-research-MLAI-AR+apps-and-frameworks-SFTWR-AF+cloud-and-infrastructure-SFTWR-CLD+core-operating-systems-SFTWR-COS+devops-and-site-reliability-SFTWR-DSR+engineering-project-management-SFTWR-EPM+information-systems-and-technology-SFTWR-ISTECH+machine-learning-and-ai-SFTWR-MCHLN+security-and-privacy-SFTWR-SEC+software-quality-automation-and-tools-SFTWR-SQAT+wireless-software-SFTWR-WSFT",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Real roles: /en-us/details/<id>/<slug>
    // Exclude .../locationPicker "Where we're hiring" links.
    jobPathPattern: String.raw`/details/[0-9-]+/[^/]+$`,
  },
  {
    id: "google",
    name: "Google",
    url: "https://www.google.com/about/careers/applications/jobs/results?target_level=EARLY&location=United%20States&degree=BACHELORS&employment_type=FULL_TIME&sort_by=date&q=Campus",
    fetchMode: "html",
    matchMode: "all_jobs",
    // /jobs/results/<id>-software-engineer-early-career-campus
    jobPathPattern: String.raw`/jobs/results/\d+-`,
    titleIncludes: ["Campus"],
  },
  {
    id: "meta",
    name: "Meta",
    url: "https://www.metacareers.com/jobsearch/?sort_by_new=true&teams[0]=Product%20Management&teams[1]=Data%20%26%20Analytics&teams[2]=Software%20Engineering&teams[3]=University%20Grad%20-%20Engineering%2C%20Tech%20%26%20Design&offices[0]=Menlo%20Park%2C%20CA&offices[1]=New%20York%2C%20NY&offices[2]=Bellevue%2C%20WA&roles[0]=Full%20time%20employment",
    fetchMode: "browser",
    browserWaitForSelector:
      'a[href*="job_details"], a[href*="/jobs/"]',
    matchMode: "all_jobs",
    // Meta detail pages: /profile/job_details/<id> (older: /jobs/<id>)
    jobPathPattern: String.raw`/(?:profile/job_details|jobs)/\d+`,
    titleIncludes: ["University Grad"],
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    url: "https://jobs.nvidia.com/careers?start=0&location=united+states&pid=893396905668&sort_by=timestamp&filter_include_remote=1&filter_include_relocation=0&filter_job_category=engineering&filter_work_location_option=office&filter_job_type=new+college+graduate&filter_time_type=full+time",
    fetchMode: "browser",
    // Page may show zero New College Grad 2027 roles — wait for job cards or empty state.
    browserWaitForSelector:
      'a[href*="/careers/job/"], [class*="position"], [class*="no-result"], [class*="NoResult"]',
    matchMode: "all_jobs",
    // Eightfold: /careers/job/<pid>
    jobPathPattern: String.raw`/careers/job/\d+`,
    titleIncludes: ["New College Grad 2027"],
  },
];
