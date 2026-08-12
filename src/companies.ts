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
   * If set, job title must match every entry (same matching rules as
   * titleIncludes). Combined with titleIncludes when both are set.
   */
  titleIncludesAll?: string[];
  /**
   * If set, skip jobs whose title matches any of these (same matching rules as
   * titleIncludes). Applied after titleIncludes / titleIncludesAll.
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
  /**
   * If set, POST this JSON body to `url` instead of GET (Phenom widgets, etc.).
   */
  fetchBody?: Record<string, unknown>;
  /**
   * Extra pagination offsets to fetch and concatenate (e.g. LinkedIn guest
   * `start=` pages). Each offset replaces/adds `start=` on `url`.
   */
  fetchStartOffsets?: number[];
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
  "2027",
  "entry",
  "entry level",
  "entry-level",
  "graduation",
] as const;

export const DEFAULT_ROLE_KEYWORDS = [
  "software engineer",
  "swe",
  "software developer",
  "software engineering",
  "software development engineer",
  "frontend engineer",
  "backend engineer",
  "full stack engineer",
  "mobile engineer",
  "devops engineer",
  "security engineer",
  "data engineer",
  "machine learning engineer",
  "ai engineer",
  "cloud engineer",
  "network engineer",
  "database engineer",
  "system engineer",
  "security engineer",
  "forward deployed",
  "applied ai engineer",
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
    id: "adobe",
    name: "Adobe",
    // Intern & Graduate landing filters (experienceLevel) don't persist in the URL.
    // Human UI: https://careers.adobe.com/us/en/intern-and-graduate
    // Phenom widgets POST with those levels; SWE via title "Software"; drop Intern.
    url: "https://careers.adobe.com/widgets",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Workday apply: /external_experienced/job/<loc>/<slug>_R####/apply
    jobPathPattern: String.raw`/job/[^/]+/[^/]+`,
    fetchBody: {
      lang: "en_us",
      deviceType: "desktop",
      country: "us",
      pageName: "search-results",
      ddoKey: "refineSearch",
      from: 0,
      jobs: true,
      counts: true,
      all_fields: [
        "category",
        "country",
        "state",
        "city",
        "type",
        "experienceLevel",
      ],
      size: 50,
      clearAll: false,
      jdsource: "facets",
      isSliderEnable: false,
      pageId: "page15",
      siteType: "external",
      keywords: "",
      global: true,
      selected_fields: {
        experienceLevel: ["University Graduate", "University Intern"],
      },
      locationData: {},
      s: "1",
      refNum: "ADOBUS",
    },
    titleIncludes: ["Software"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "dropbox",
    name: "Dropbox",
    // Engineering + Remote - US: All locations (dropbox.jobs HTML is 403; Greenhouse).
    // Human UI: https://www.dropbox.jobs/en/jobs/?location=Remote+-+US%3A+All+locations&team=Engineering
    // New-grad + SWE keywords.
    url: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs?content=false",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /listing/<id>
    jobPathPattern: String.raw`/listing/\d+`,
    metadataIncludes: [
      { name: "Career Page Allocation", value: "Engineering" },
    ],
    locationIncludes: ["Remote - US: All locations"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    // Official Greenhouse board is test noise; poll public guest job search API.
    // Human UI: companies LinkedIn/Drawbridge/Lynda + Entry + Engineering + Full-time
    // https://www.linkedin.com/jobs/search/?f_C=1337,2587638,39939&f_E=2&f_F=eng&f_JT=F&geoId=92000000
    // New-grad + SWE keywords; drop Intern titles. Paginate guest `start=` pages.
    url: "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=1337%2C2587638%2C39939&f_E=2&f_F=eng&f_JT=F&geoId=92000000&sortBy=R&start=0",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /jobs/view/<slug>-<id>
    jobPathPattern: String.raw`/jobs/view/`,
    // Guest API ~10 cards/page; keep light to avoid LinkedIn 429s from Workers IPs.
    fetchStartOffsets: [0, 10],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "snap",
    name: "Snap",
    // Engineering + Regular + US hubs (Bellevue/Chicago/LA/NY/PA/SF/Santa Monica/Seattle).
    // Human UI: https://careers.snap.com/jobs?role=Engineering&type=Regular&location=Bellevue&location=Chicago&location=Los+Angeles&location=New+York&location=Palo+Alto&location=San+Francisco&location=Santa+Monica&location=Seattle
    // Same filters via /api/jobs; new-grad + SWE keywords (no early-career titles today).
    url: "https://careers.snap.com/api/jobs?role=Engineering&type=Regular&location=Bellevue&location=Chicago&location=Los+Angeles&location=New+York&location=Palo+Alto&location=San+Francisco&location=Santa+Monica&location=Seattle",
    fetchMode: "html",
    matchMode: "keywords",
    // Workday apply: /recruiting/snapchat/snap/job/<loc>/<slug>_<id>
    jobPathPattern: String.raw`/job/`,
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "airbnb",
    name: "Airbnb",
    // Engineering + United States (FacetWP page is WordPress; poll Greenhouse depts).
    // Human UI: https://careers.airbnb.com/positions/?_departments=engineering&_where_you_work=united-states&_jobs_sort=updated_at
    // New-grad + SWE keywords; drop Intern titles.
    url: "https://boards-api.greenhouse.io/v1/boards/airbnb/departments",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /positions/<id>
    jobPathPattern: String.raw`/positions/\d+`,
    departmentIncludes: ["Software Engineering", "Engineering & Technology"],
    // Board uses "United States", "Remote - USA", "Remote - US", "San Francisco, CA", …
    locationIncludes: ["United States", "USA", "Remote - US", ", CA"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "doordash",
    name: "DoorDash",
    // Engineering + intern/early-career toggle (intern=1). Site is CF-blocked; Greenhouse.
    // Human UI: https://careersatdoordash.com/job-search/?job_ids=3420554&location=&function=&intern=1&department=Engineering%7C&spage=1
    // Require title "Entry-Level" + new-grad/SWE keywords; drop Intern titles.
    url: "https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs?content=false",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: job-boards.greenhouse.io/doordashusa/jobs/<id>
    jobPathPattern: String.raw`/jobs/\d+`,
    metadataIncludes: [
      { name: "Careers Page Sorting: Department", value: "Engineering" },
    ],
    titleIncludes: ["Entry-Level"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "spotify",
    name: "Spotify",
    // Eng categories + US hubs + Early Career Program (currently empty).
    // Human UI: https://www.lifeatspotify.com/jobs?c=backend&c=client-c&c=data&c=developer-tools-infrastructure&c=engineering-leadership&c=machine-learning&c=mobile&c=network-engineering-it&c=security&c=tech-research&c=web&l=united-states-of-america-home-mix&l=new-york&l=boston&l=los-angeles&l=washington-d-c&j=early-career-program
    // API mirrors URL filters; all early-career hits except Intern titles.
    url: "https://api.lifeatspotify.com/wp-json/animal/v1/job/search?c=backend%2Cclient-c%2Cdata%2Cdeveloper-tools-infrastructure%2Cengineering-leadership%2Cmachine-learning%2Cmobile%2Cnetwork-engineering-it%2Csecurity%2Ctech-research%2Cweb&l=united-states-of-america-home-mix%2Cnew-york%2Cboston%2Clos-angeles%2Cwashington-d-c&j=early-career-program",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /jobs/<slug>
    jobPathPattern: String.raw`/jobs/[a-z0-9-]+`,
    jobUrlTemplate: "https://www.lifeatspotify.com/jobs/{id}",
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "snowflake",
    name: "Snowflake",
    // GenSWE early-career landing (roles embedded as Phenom job cards).
    // Human UI: https://careers.snowflake.com/us/en/generalsoftwareengineeringprogram
    // Any /us/en/job/ card on this page (currently Software Engineer - Backend).
    url: "https://careers.snowflake.com/us/en/generalsoftwareengineeringprogram",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /us/en/job/<id>/<slug>
    jobPathPattern: String.raw`/us/en/job/[^/]+/[^/]+`,
  },
  {
    id: "github",
    name: "GitHub",
    // Engineering + IC + United States (newest first). Jibe API; page returns all SWE.
    // Human UI: https://www.github.careers/careers-home/jobs?view=search&page=1&locations=,,United%20States&sortBy=posted_date&descending=true&tags5=Individual%20Contributor&categories=Engineering
    // New-grad + SWE keywords on titles; drop Intern. Newest page is enough for alerts.
    url: "https://www.github.careers/api/jobs?page=1&locations=%2C%2CUnited%20States&sortBy=posted_date&descending=true&tags5=Individual%20Contributor&categories=Engineering",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /careers-home/jobs/<slug>
    jobPathPattern: String.raw`/careers-home/jobs/\d+`,
    jobUrlTemplate: "https://www.github.careers/careers-home/jobs/{id}",
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "asana",
    name: "Asana",
    // Emerging Talent / Early Career Programs (university-recruiting page; empty today).
    // Human UI: https://asana.com/jobs/university-recruiting#jobs
    // Include parent + child GH depts; SWE via title Engineer; drop Intern.
    url: "https://boards-api.greenhouse.io/v1/boards/asana/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /jobs/apply/<id>
    jobPathPattern: String.raw`/jobs/apply/\d+`,
    departmentIncludes: [
      "Early Career Programs",
      "Apprenticeships",
      "Internship",
      "New Grad",
      "Returnship",
      "University",
    ],
    titleIncludes: ["Engineer"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "docusign",
    name: "DocuSign",
    // UI "University & New Grad"; Jibe API category term is "University" (empty of SWE today).
    // Human UI: https://careers.docusign.com/careers-home/jobs?categories=University%20%26%20New%20Grad&sortBy=posted_date&descending=true&page=1
    // SWE via title Engineer; drop Intern.
    url: "https://careers.docusign.com/api/jobs?page=1&categories=University&sortBy=posted_date&descending=true",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers-home/jobs/<slug>
    jobPathPattern: String.raw`/careers-home/jobs/\d+`,
    jobUrlTemplate: "https://careers.docusign.com/careers-home/jobs/{id}",
    titleIncludes: ["Engineer"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    // University department page (Explore open roles; empty today — CF blocks HTML).
    // Human UI: https://www.pinterestcareers.com/departments/university/
    // Greenhouse University + University Engineering; SWE-adjacent titles.
    url: "https://boards-api.greenhouse.io/v1/boards/pinterest/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /jobs/?gh_jid=<id>
    jobPathPattern: String.raw`/jobs/`,
    departmentIncludes: ["University", "University Engineering"],
    titleIncludes: ["Engineer", "SWE", "Software", "Machine Learning"],
  },
  {
    id: "openai",
    name: "OpenAI",
    // Applied AI / FDE / Codex / Core Platform teams + San Francisco (UUID filters on site).
    // Human UI: https://openai.com/careers/search/?c=923a141e-…&l=bbd9f7fe-… (SF)
    // Ashby GraphQL (posting-api is ~12MB); new-grad + SWE keywords; drop Intern.
    url: "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /openai/<uuid>
    jobPathPattern: String.raw`/openai/[0-9a-f-]{36}`,
    jobUrlTemplate: "https://jobs.ashbyhq.com/openai/{id}",
    fetchBody: {
      operationName: "ApiJobBoardWithTeams",
      variables: { organizationHostedJobsPageName: "openai" },
      query:
        "query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) { jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) { teams { id name parentTeamId } jobPostings { id title teamId locationId locationName employmentType } } }",
    },
    departmentIncludes: [
      "Forward Deployed Engineering",
      "Applied AI",
      "Applied AI Engineering",
      "Applied AI Infrastructure",
      "B2B Applications",
      "Codex - Engineering",
      "Core Product & Platform",
      "Core Product & Platform | API",
    ],
    locationIncludes: ["San Francisco"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "box",
    name: "Box",
    // Engineering + North America (careers.box.com is CF-blocked; Greenhouse).
    // Human UI: https://careers.box.com/en/jobs/?search=&region=North+America&team=Engineering&pagesize=20#results
    // Eng dept tree + NA locations; new-grad + SWE keywords; drop Intern.
    url: "https://boards-api.greenhouse.io/v1/boards/boxinc/departments",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: job-boards.greenhouse.io/boxinc/jobs/<id>
    jobPathPattern: String.raw`/jobs/\d+`,
    departmentIncludes: [
      "Engineering",
      "Experiences",
      "Core Platform",
      "Cloud Engineering - R&D",
      "EBOS/TPM",
      "Engineering Admin",
      "Engineering Operations - COGs",
      "Enterprise",
      "Workflows",
    ],
    locationIncludes: [
      "United States",
      "Canada",
      "Redwood City",
      "San Francisco",
      "New York",
      "Chicago",
      "Austin",
      "Boston",
      ", CA",
      ", NY",
      ", TX",
      ", IL",
      ", MA",
      ", CO",
      ", WA",
    ],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "twosigma",
    name: "Two Sigma",
    // Pre-filtered Avature: Function=Engineering + Experience=Early Careers.
    // Human UI: https://careers.twosigma.com/careers/OpenRoles/?5085=[16718776]&5086=[16718736]&…
    // Notify on every listing under those filters (empty today).
    url: "https://careers.twosigma.com/careers/OpenRoles/?5085=%5B16718776%5D&5085_format=3148&5086=%5B16718736%5D&5086_format=3149&listFilterMode=1&jobRecordsPerPage=20&",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/JobDetail/<slug>/<id>
    jobPathPattern: String.raw`/careers/JobDetail/[^/]+/\d+`,
  },
  {
    id: "twitch",
    name: "Twitch",
    // Careers UI filters don't persist / no new-grad facet (Greenhouse embed).
    // Human UI: https://careers.twitch.com/en/careers
    // Title must include both "Software Engineer" and level "I"; drop Intern.
    url: "https://boards-api.greenhouse.io/v1/boards/twitch/jobs?content=false",
    fetchMode: "html",
    matchMode: "all_jobs",
    jobPathPattern: String.raw`/jobs/\d+`,
    titleIncludesAll: ["Software Engineer", "I"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "mongodb",
    name: "MongoDB",
    // Students & Graduates → Explore roles "Early Talent" (College Students / New Grad).
    // Human UI: https://www.mongodb.com/company/careers/students-and-graduates
    // Also PRO/PTO New Grads under Product; US + SWE titles; empty today.
    url: "https://boards-api.greenhouse.io/v1/boards/mongodb/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/job/?gh_jid=<id>
    jobPathPattern: String.raw`/careers/job`,
    departmentIncludes: ["New Grad", "PRO New Grads", "PTO New Grads"],
    titleIncludes: ["Engineer", "Software", "SWE", "Machine Learning"],
    locationIncludes: [
      "United States",
      "USA",
      "Remote North America",
      "New York",
      "San Francisco",
      "Palo Alto",
      "Austin",
      "Seattle",
      "Chicago",
      "Boston",
      "Atlanta",
      "Denver",
      "Los Angeles",
      "Washington DC",
      "Raleigh",
      "Dallas",
      "Miami",
      "California",
      "Colorado",
      "Texas",
    ],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "paypal",
    name: "PayPal",
    // US + Software Engineering (Eightfold PCSX; legacy /api/apply/v2 is 403).
    // Human UI: https://paypal.eightfold.ai/careers?…&location=united+states&filter_job_category=Software+Engineering
    // New-grad + SWE keywords on that feed; paginate start= (10/page, ~29 roles).
    url: "https://paypal.eightfold.ai/api/pcsx/search?domain=paypal.com&query=&location=united+states&start=0&num=10&sort_by=timestamp&filter_include_remote=1&filter_include_relocation=0&filter_job_category=Software+Engineering",
    fetchMode: "html",
    matchMode: "keywords",
    // Detail: /careers/job/<pid>
    jobPathPattern: String.raw`/careers/job/\d+`,
    jobUrlTemplate: "https://paypal.eightfold.ai/careers/job/{id}",
    fetchStartOffsets: [0, 10, 20],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    // Pre-filtered Eightfold PCSX: Entry + SWE profession/discipline + IC + FT + US.
    // Human UI: https://apply.careers.microsoft.com/careers?…&filter_seniority=Entry&filter_profession=software+engineering&…
    // Titles are not reliable new-grad signals — notify every listing under these filters.
    url: "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=United+States%2C+Multiple+Locations%2C+Multiple+Locations&start=0&num=20&sort_by=timestamp&filter_include_remote=0&filter_include_relocation=0&filter_career_discipline=Software+Engineering&filter_employment_type=full-time&filter_roletype=individual+contributor&filter_profession=software+engineering&filter_seniority=Entry",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers/job/<pid>
    jobPathPattern: String.raw`/careers/job/\d+`,
    jobUrlTemplate: "https://apply.careers.microsoft.com/careers/job/{id}",
    fetchStartOffsets: [0, 20],
  },
  {
    id: "affirm",
    name: "Affirm",
    // Careers #jobOpenings Engineering filter (Greenhouse embed; board affirm).
    // Human UI: https://www.affirm.com/careers#jobOpenings
    // Eng dept teams; new-grad signal is level "I" (not II); drop Intern.
    url: "https://boards-api.greenhouse.io/v1/boards/affirm/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: job-boards.greenhouse.io/affirm/jobs/<id>
    jobPathPattern: String.raw`/jobs/\d+`,
    departmentIncludes: [
      "Consumer Engineering",
      "Financial Platforms - Engineering",
      "Infrastructure Platform Eng",
      "Returnly Engineering",
    ],
    titleIncludesAll: ["Engineer", "I"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "amd",
    name: "AMD",
    // Pre-filtered: new grad (tags1=Yes) + Engineering + United States (Jibe).
    // Human UI: https://careers.amd.com/careers-home/jobs?page=1&tags1=Yes&categories=Engineering&country=United%20States&sortBy=posted_date&descending=true
    // SWE-adjacent titles only (feed is mostly mechanical/thermal/RTL today).
    url: "https://careers.amd.com/api/jobs?page=1&tags1=Yes&categories=Engineering&country=United%20States&sortBy=posted_date&descending=true",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /careers-home/jobs/<slug>
    jobPathPattern: String.raw`/careers-home/jobs/\d+`,
    jobUrlTemplate: "https://careers.amd.com/careers-home/jobs/{id}",
    titleIncludes: ["Software", "SWE", "Developer", "Machine Learning"],
    titleExcludes: ["Intern", "Internship", "Internships"],
  },
  {
    id: "intuit",
    name: "Intuit",
    // New College Grad category (TalentBrew). Keyword search
    // /search-jobs/interns%20new%20college%20grads/ is noisy (~383 mixed roles).
    // Human UI: https://jobs.intuit.com/category/new-college-grad-jobs/27595/9205760/1
    // SWE-adjacent titles; drop Intern/Co-op.
    url: "https://jobs.intuit.com/category/new-college-grad-jobs/27595/9205760/1",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /job/<city>/<slug>/<org>/<id>
    jobPathPattern: String.raw`/job/[^/]+/[^/]+/\d+/\d+`,
    titleIncludes: ["Software", "SWE", "Developer", "Machine Learning"],
    titleExcludes: ["Intern", "Internship", "Internships", "Co-op", "Coop"],
  },
  {
    id: "scale",
    name: "Scale AI",
    // University page "Open university roles" (Greenhouse: External Dept / University).
    // Human UI: https://scale.com/careers/university
    // SWE-adjacent titles; drop Intern / recruiting ops (empty SWE today).
    url: "https://boards-api.greenhouse.io/v1/boards/scaleai/departments",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail on site: /careers/<id> (GH: job-boards.greenhouse.io/scaleai/jobs/<id>)
    jobPathPattern: String.raw`/jobs/\d+`,
    departmentIncludes: ["University"],
    titleIncludes: [
      "Software",
      "SWE",
      "Developer",
      "Machine Learning",
      "Forward Deployed",
      "AI Engineer",
      "Data Engineer",
      "Security Engineer",
      "Infrastructure",
    ],
    titleExcludes: [
      "Intern",
      "Internship",
      "Internships",
      "Recruiter",
      "Recruiting",
    ],
  },
  {
    id: "sig",
    name: "Susquehanna",
    // Pre-filtered: New Graduates + June 2027 Start + Philly/NY (Jibe).
    // Human UI: https://careers.sig.com/jobs?…&tags3=June%202027%20Start&categories=New%20Graduates&city=Bala%20Cynwyd…%7CNew%20York
    // SWE-adjacent titles; drop Master's / PhD / Intern (quant tracks today).
    url: "https://careers.sig.com/api/jobs?page=1&tags3=June%202027%20Start&categories=New%20Graduates&sortBy=posted_date&descending=true&city=Bala%20Cynwyd%20(Philadelphia%20Area)%7CNew%20York",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /jobs/<slug>
    jobPathPattern: String.raw`/jobs/\d+`,
    jobUrlTemplate: "https://careers.sig.com/jobs/{id}",
    titleIncludes: ["Engineer", "Software", "SWE", "Developer", "Machine Learning"],
    titleExcludes: [
      "Master's",
      "Masters",
      "Master",
      "PhD",
      "Ph.D",
      "Intern",
      "Internship",
      "Internships",
    ],
  },
  {
    id: "servicenow",
    name: "ServiceNow",
    // Eng + Early Career + US (Phenom; direct HTML is a JS shell, /widgets 405).
    // Human UI: https://careers.servicenow.com/jobs/?…&team=Engineering…&jobPostingType=Early+Career&country=United+States
    // Jina reader returns the filtered result cards as markdown links.
    // Early Career facet includes non-new-grad titles; require new-grad title semantics.
    url: "https://r.jina.ai/https://careers.servicenow.com/jobs/?search=&team=Engineering%2C+Infrastructure+and+Operations&jobPostingType=Early+Career&country=United+States&pagesize=20",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Detail: /jobs/<id>/<slug>/
    jobPathPattern: String.raw`/jobs/\d+/`,
    titleIncludes: [
      "New Grad",
      "New Graduate",
      "University",
      "Campus",
      "Early Career",
      "Emerging Talent",
      "Graduate",
      "Entry Level",
      "Entry-Level",
      "Associate",
    ],
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
