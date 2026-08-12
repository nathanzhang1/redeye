import {
  Company,
  DEFAULT_JOB_PATH_PATTERN,
  DEFAULT_KEYWORDS,
  DEFAULT_ROLE_KEYWORDS,
} from "./companies";

export type JobListing = {
  id: string;
  title: string;
  url: string;
};

const USER_AGENT =
  "Mozilla/5.0 (compatible; RedeyeJobTracker/1.0; +https://github.com/redeye)";

const FETCH_TIMEOUT_MS = 30_000;
// Ashby boards embed full job HTML and routinely exceed 2MB.
const MAX_HTML_BYTES = 4_000_000;

export async function fetchCareerPage(
  url: string,
  postBody?: Record<string, unknown>,
): Promise<string> {
  const isJinaReader =
    /(?:^|\.)r\.jina\.ai\//i.test(url) || url.startsWith("https://r.jina.ai/");
  // Jina free tier 429s easily from Workers IPs — back off harder.
  const maxAttempts = isJinaReader ? 5 : 1;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }

    const response = await fetch(url, {
      method: postBody ? "POST" : "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: isJinaReader
          ? "text/plain,text/markdown,*/*"
          : "text/html,application/xhtml+xml,application/json",
        ...(isJinaReader ? { "X-Return-Format": "markdown" } : {}),
        ...(postBody ? { "Content-Type": "application/json" } : {}),
      },
      body: postBody ? JSON.stringify(postBody) : undefined,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    lastStatus = response.status;

    if (response.status === 429 && attempt < maxAttempts) {
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(`Empty body from ${url}`);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        void reader.cancel();
        throw new Error(`HTML from ${url} exceeded ${MAX_HTML_BYTES} bytes`);
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(
      merged,
    );
  }

  throw new Error(`HTTP ${lastStatus} fetching ${url}`);
}

export async function extractJobs(
  company: Company,
  html: string,
): Promise<JobListing[]> {
  const trimmed = html.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return extractJobsFromJson(company, trimmed);
  }

  // Shopify (and similar) XML job boards: <source><job>...</job></source>
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<source") ||
    trimmed.startsWith("<rss")
  ) {
    const jobs = parseXmlJobFeed(trimmed);
    return extractJobsFromJson(company, JSON.stringify({ jobs }));
  }

  // Stripe careers embeds a full job index in __NEXT_DATA__ (URL filters are client-side).
  if (company.id === "stripe") {
    const fromIndex = await extractStripeJobIndex(company, html);
    if (fromIndex) return fromIndex;
  }

  const base = new URL(company.url);
  const matchMode = company.matchMode ?? "keywords";
  const jobPathRe = new RegExp(
    company.jobPathPattern ?? DEFAULT_JOB_PATH_PATTERN,
    "i",
  );

  const keywords = (company.keywords ?? [...DEFAULT_KEYWORDS]).map((k) =>
    k.toLowerCase(),
  );
  const roleKeywords = (company.roleKeywords ?? [
    ...DEFAULT_ROLE_KEYWORDS,
  ]).map((k) => k.toLowerCase());

  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const byUrl = new Map<string, JobListing>();

  type HtmlJobHit = { href: string; titleHint: string };
  const hits: HtmlJobHit[] = [];

  for (const match of anchors) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    // Phenom (Snowflake GenSWE) can emit duplicate href attrs: CMS junk first,
    // then the real https://…/job/… URL. Prefer a real absolute job URL.
    const hrefCandidates = [
      ...attrs.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi),
    ].map((m) => m[2].trim());
    const href =
      hrefCandidates.find(
        (h) => /^https?:\/\//i.test(h) && /\/job\//i.test(h),
      ) ??
      hrefCandidates.find((h) => /^https?:\/\//i.test(h)) ??
      hrefCandidates.find((h) => h.startsWith("/")) ??
      hrefCandidates[0];
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }

    let title = decodeHtmlEntities(stripTags(inner)).replace(/\s+/g, " ").trim();
    const aria = attrs.match(/\baria-label\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (aria) {
      const ariaTitle = decodeHtmlEntities(aria)
        .replace(/^learn more about\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (ariaTitle && ariaTitle.length <= 300) {
        // Prefer aria-label when link text is empty / "Learn more"
        if (!title || /^learn more$/i.test(title) || title.length < ariaTitle.length) {
          title = ariaTitle;
        }
      }
    }
    hits.push({ href, titleHint: title });
  }

  // Markdown links (e.g. Jina reader proxy): [Title](https://…/jobs/…)
  for (const match of html.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi)) {
    hits.push({ href: match[2], titleHint: match[1].replace(/\s+/g, " ").trim() });
  }

  for (const hit of hits) {
    let absolute: URL;
    try {
      absolute = new URL(hit.href, base);
    } catch {
      continue;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      continue;
    }

    let title = hit.titleHint;
    // Phenom (Snowflake GenSWE): empty link text + "Click to apply…" aria — use URL slug.
    if (
      !title ||
      title.length > 300 ||
      /^learn more$/i.test(title) ||
      /^click to apply\b/i.test(title)
    ) {
      // Google: /jobs/results/<id>-software-engineer-early-career-campus
      // Phenom: /us/en/job/<id>/Software-Engineer-Backend
      // ServiceNow: /jobs/<id>/<slug>/
      const slugTitle =
        titleFromGoogleSlug(absolute.pathname) ??
        titleFromJobPathSlug(absolute.pathname);
      if (slugTitle) {
        title = slugTitle;
      } else {
        const idFromPath =
          absolute.pathname.match(
            /\/(?:profile\/job_details|jobs|careers\/job)\/(\d+)/i,
          )?.[1] ??
          absolute.pathname.match(/\/jobs\/results\/(\d+)/i)?.[1] ??
          absolute.pathname.match(/\/details\/([0-9-]+)/i)?.[1];
        if (!idFromPath) continue;
        title = `Job ${idFromPath}`;
      }
    }

    if (matchMode === "all_jobs") {
      if (!jobPathRe.test(absolute.pathname)) continue;
    } else {
      const haystack =
        `${title} ${absolute.pathname} ${absolute.search}`.toLowerCase();
      if (
        !matchesAny(haystack, keywords) ||
        !matchesAny(haystack, roleKeywords)
      ) {
        continue;
      }
    }

    if (company.titleIncludes?.length) {
      if (!titleMatchesIncludes(title, company.titleIncludes)) continue;
    }
    if (company.titleIncludesAll?.length) {
      if (!titleMatchesAllIncludes(title, company.titleIncludesAll)) continue;
    }
    if (company.titleExcludes?.length) {
      if (titleMatchesIncludes(title, company.titleExcludes)) continue;
    }

    // HTML cards often put location in link text and/or URL slug.
    const locationText = `${title} ${absolute.pathname}`;
    if (!locationAllowed(locationText, company)) continue;

    const canonical = canonicalizeJobUrl(absolute);
    const id = await jobId(company.id, canonical);
    const existing = byUrl.get(canonical);
    // Prefer a real title over the Job <id> fallback
    if (!existing || existing.title.startsWith("Job ")) {
      byUrl.set(canonical, { id, title, url: canonical });
    }
  }

  return [...byUrl.values()];
}

/**
 * Public JSON job feeds (Amazon search.json, Greenhouse, Oracle HCM, Eightfold, …).
 * Supported shapes:
 * - [{ … }] / { jobs: […] } / { positions: […] } (Eightfold PCS)
 * - { data: { positions: […] } } (Eightfold PCSX)
 * - { items: [{ requisitionList: […] }] } (Oracle recruitingCEJobRequisitions)
 * Row fields: title|Title|name|posting_name,
 * absolute_url|canonicalPositionUrl|positionUrl|job_path|url,
 * and/or id|Id (+ jobUrlTemplate)
 */
async function extractJobsFromJson(
  company: Company,
  text: string,
): Promise<JobListing[]> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Career page looked like JSON but failed to parse");
  }

  const jobs = jsonJobRows(data, company);
  if (!jobs) {
    throw new Error("JSON career feed missing jobs array");
  }

  const baseOrigin = new URL(company.url).origin;
  const matchMode = company.matchMode ?? "keywords";
  const jobPathRe = new RegExp(
    company.jobPathPattern ?? DEFAULT_JOB_PATH_PATTERN,
    "i",
  );
  const keywords = (company.keywords ?? [...DEFAULT_KEYWORDS]).map((k) =>
    k.toLowerCase(),
  );
  const roleKeywords = (company.roleKeywords ?? [
    ...DEFAULT_ROLE_KEYWORDS,
  ]).map((k) => k.toLowerCase());

  const byUrl = new Map<string, JobListing>();

  for (const raw of jobs) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const titleRaw =
      (typeof row.title === "string" && row.title) ||
      (typeof row.Title === "string" && row.Title) ||
      (typeof row.posting_name === "string" && row.posting_name) ||
      (typeof row.name === "string" && row.name) ||
      // Spotify Life at Spotify search: { text, id, … }
      (typeof row.text === "string" && row.text) ||
      "";
    const title = titleRaw.replace(/\s+/g, " ").trim();
    const boardId =
      (typeof row.id === "string" && row.id) ||
      (typeof row.id === "number" && String(row.id)) ||
      (typeof row.Id === "string" && row.Id) ||
      (typeof row.Id === "number" && String(row.Id)) ||
      // Jibe (GitHub careers): slug / req_id
      (typeof row.slug === "string" && row.slug) ||
      (typeof row.req_id === "string" && row.req_id) ||
      (typeof row.req_id === "number" && String(row.req_id)) ||
      "";
    const pathOrUrl =
      (typeof row.absolute_url === "string" && row.absolute_url) ||
      (typeof row.canonicalPositionUrl === "string" &&
        row.canonicalPositionUrl) ||
      (typeof row.positionUrl === "string" && row.positionUrl) ||
      (typeof row.job_path === "string" && row.job_path) ||
      (typeof row.jobPath === "string" && row.jobPath) ||
      (typeof row.jobUrl === "string" && row.jobUrl) ||
      (typeof row.applyUrl === "string" && row.applyUrl) ||
      (typeof row.url === "string" && row.url) ||
      (boardId && company.jobUrlTemplate
        ? company.jobUrlTemplate.replaceAll("{id}", boardId)
        : "");
    if (!title || !pathOrUrl) continue;

    if (
      company.departmentIncludes?.length &&
      !jsonDepartmentAllowed(row, company.departmentIncludes)
    ) {
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(pathOrUrl, baseOrigin);
    } catch {
      continue;
    }

    if (matchMode === "all_jobs") {
      if (!jobPathRe.test(absolute.pathname)) continue;
    } else {
      const haystack =
        `${title} ${absolute.pathname} ${absolute.search}`.toLowerCase();
      if (
        !matchesAny(haystack, keywords) ||
        !matchesAny(haystack, roleKeywords)
      ) {
        continue;
      }
    }

    if (company.titleIncludes?.length) {
      if (!titleMatchesIncludes(title, company.titleIncludes)) continue;
    }
    if (company.titleIncludesAll?.length) {
      if (!titleMatchesAllIncludes(title, company.titleIncludesAll)) continue;
    }
    if (company.titleExcludes?.length) {
      if (titleMatchesIncludes(title, company.titleExcludes)) continue;
    }

    if (
      company.metadataIncludes?.length &&
      !jsonMetadataAllowed(row, company.metadataIncludes)
    ) {
      continue;
    }

    const locationText = jsonLocationText(row);
    if (!locationAllowed(locationText, company)) continue;

    const canonical = canonicalizeJobUrl(absolute);
    const id = await jobId(company.id, canonical);
    byUrl.set(canonical, { id, title, url: canonical });
  }

  return [...byUrl.values()];
}

function jsonJobRows(data: unknown, company: Company): unknown[] | null {
  if (Array.isArray(data)) return unwrapJsonJobHits(data);
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.jobs)) return unwrapJsonJobHits(obj.jobs);
  // Block careers: { currentPage: [...], total }
  if (Array.isArray(obj.currentPage)) return unwrapJsonJobHits(obj.currentPage);
  // Eightfold PCS: { positions: [...], count: N }
  if (Array.isArray(obj.positions)) return unwrapJsonJobHits(obj.positions);
  // Snap careers: { body: [{ _source: { title, absolute_url, … } }] }
  if (Array.isArray(obj.body)) return unwrapJsonJobHits(obj.body);
  // Spotify Life at Spotify: { result: [{ id, text, … }], main_categories }
  if (Array.isArray(obj.result)) return unwrapJsonJobHits(obj.result);

  // Phenom widgets: { refineSearch: { data: { jobs: [...] } } }
  const refine = obj.refineSearch;
  if (refine && typeof refine === "object") {
    const refineData = (refine as { data?: unknown }).data;
    if (refineData && typeof refineData === "object") {
      const jobs = (refineData as { jobs?: unknown }).jobs;
      if (Array.isArray(jobs)) return unwrapJsonJobHits(jobs);
    }
  }
  // Ashby GraphQL: { data: { jobBoard: { teams, jobPostings } } }
  // Phenom-ish: { data: { jobs: [...] } }
  if (obj.data && typeof obj.data === "object") {
    const dataObj = obj.data as Record<string, unknown>;
    const board = dataObj.jobBoard;
    if (board && typeof board === "object") {
      const ashby = ashbyGraphQlJobRows(
        board as { teams?: unknown[]; jobPostings?: unknown[] },
      );
      if (ashby) return ashby;
    }
    const jobs = dataObj.jobs;
    if (Array.isArray(jobs)) return unwrapJsonJobHits(jobs);
    // Eightfold PCSX: { data: { positions: [...] } }
    const positions = dataObj.positions;
    if (Array.isArray(positions)) return unwrapJsonJobHits(positions);
  }

  // Greenhouse departments: { departments: [{ name, jobs: [...] }] }
  if (Array.isArray(obj.departments)) {
    const wanted = (company.departmentIncludes ?? []).map((d) =>
      d.toLowerCase(),
    );
    const rows: unknown[] = [];
    for (const raw of obj.departments) {
      if (!raw || typeof raw !== "object") continue;
      const dept = raw as { name?: string; jobs?: unknown[] };
      const name = (dept.name ?? "").toLowerCase();
      if (wanted.length && !wanted.includes(name)) continue;
      if (Array.isArray(dept.jobs)) rows.push(...dept.jobs);
    }
    return unwrapJsonJobHits(rows);
  }

  // Oracle HCM: { items: [{ requisitionList: [...] }] }
  if (Array.isArray(obj.items)) {
    for (const item of obj.items) {
      if (!item || typeof item !== "object") continue;
      const list = (item as { requisitionList?: unknown }).requisitionList;
      if (Array.isArray(list)) return unwrapJsonJobHits(list);
    }
  }
  return null;
}

/** Elasticsearch-style hits: prefer `_source` when present. */
function unwrapJsonJobHits(rows: unknown[]): unknown[] {
  return rows.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const obj = raw as { _source?: unknown; data?: unknown };
    if (obj._source && typeof obj._source === "object") return obj._source;
    // Jibe (GitHub careers): { data: { title, slug, … } }
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data as Record<string, unknown>;
      if (typeof data.title === "string" || typeof data.slug === "string") {
        return data;
      }
    }
    return raw;
  });
}

/** Attach team names so departmentIncludes can match Ashby GraphQL postings. */
function ashbyGraphQlJobRows(board: {
  teams?: unknown[];
  jobPostings?: unknown[];
}): unknown[] | null {
  if (!Array.isArray(board.jobPostings)) return null;
  const teamName = new Map<string, string>();
  for (const raw of board.teams ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const team = raw as { id?: unknown; name?: unknown };
    if (typeof team.id === "string" && typeof team.name === "string") {
      teamName.set(team.id, team.name);
    }
  }
  return board.jobPostings.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const job = raw as Record<string, unknown>;
    const teamId = typeof job.teamId === "string" ? job.teamId : "";
    const team = teamName.get(teamId) ?? "";
    const locationName =
      typeof job.locationName === "string" ? job.locationName : "";
    return {
      ...job,
      team,
      department: team,
      ...(locationName ? { location: locationName } : {}),
    };
  });
}

function jsonLocationText(row: Record<string, unknown>): string {
  const location = row.location;
  if (typeof location === "string") return location;
  if (location && typeof location === "object") {
    const name = (location as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  if (typeof row.PrimaryLocation === "string") return row.PrimaryLocation;
  if (typeof row.normalized_location === "string") {
    return row.normalized_location;
  }
  if (typeof row.primary_location === "string") return row.primary_location;
  if (typeof row.locationsText === "string") return row.locationsText;
  if (typeof row.full_location === "string") return row.full_location;
  if (typeof row.location_name === "string") return row.location_name;
  if (typeof row.short_location === "string") return row.short_location;
  if (Array.isArray(row.offices)) {
    const parts = row.offices
      .map((office) => {
        if (!office || typeof office !== "object") return "";
        const o = office as { location?: unknown; name?: unknown };
        if (typeof o.location === "string" && o.location) return o.location;
        if (typeof o.name === "string" && o.name) return o.name;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  // Spotify: locations: [{ location: "New York", slug: "new-york" }]
  if (Array.isArray(row.locations)) {
    const parts = row.locations
      .map((loc) => {
        if (typeof loc === "string") return loc;
        if (!loc || typeof loc !== "object") return "";
        const o = loc as { location?: unknown; name?: unknown };
        if (typeof o.location === "string" && o.location) return o.location;
        if (typeof o.name === "string" && o.name) return o.name;
        return "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return "";
}

/**
 * Ashby-style flat rows: match department or team against departmentIncludes.
 * Greenhouse department feeds already filter upstream and omit department on
 * each job — if the row has no dept metadata, allow it through.
 */
function jsonDepartmentAllowed(
  row: Record<string, unknown>,
  departmentIncludes: string[],
): boolean {
  const wanted = departmentIncludes.map((d) => d.toLowerCase());
  const present = [row.department, row.team, row.Department, row.Team].filter(
    (raw): raw is string => typeof raw === "string" && raw.trim().length > 0,
  );
  if (!present.length) return true;
  return present.some((raw) => wanted.includes(raw.toLowerCase()));
}

/** Greenhouse job metadata: require each name/value pair (case-insensitive). */
function jsonMetadataAllowed(
  row: Record<string, unknown>,
  metadataIncludes: { name: string; value: string }[],
): boolean {
  const meta = row.metadata;
  if (!Array.isArray(meta)) return false;
  const entries = meta.filter(
    (m): m is { name: string; value: unknown } =>
      !!m &&
      typeof m === "object" &&
      typeof (m as { name?: unknown }).name === "string",
  );
  return metadataIncludes.every((want) => {
    const name = want.name.toLowerCase();
    const value = want.value.toLowerCase();
    return entries.some(
      (m) =>
        m.name.toLowerCase() === name &&
        typeof m.value === "string" &&
        m.value.toLowerCase() === value,
    );
  });
}

function locationAllowed(locationText: string, company: Company): boolean {
  const loc = locationText.toLowerCase();
  if (company.locationExcludes?.length) {
    if (
      company.locationExcludes.some((needle) =>
        loc.includes(needle.toLowerCase()),
      )
    ) {
      return false;
    }
  }
  if (company.locationIncludes?.length) {
    return company.locationIncludes.some((needle) =>
      loc.includes(needle.toLowerCase()),
    );
  }
  return true;
}

/** Case-insensitive; multi-word needles use substring, single tokens use word boundaries. */
function titleMatchesIncludes(title: string, needles: string[]): boolean {
  return needles.some((needle) => {
    const n = needle.trim();
    if (!n) return false;
    if (/\s/.test(n)) {
      return title.toLowerCase().includes(n.toLowerCase());
    }
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(title);
  });
}

/** Every needle must match (AND); each needle uses titleMatchesIncludes rules. */
function titleMatchesAllIncludes(title: string, needles: string[]): boolean {
  return needles.every((needle) => titleMatchesIncludes(title, [needle]));
}

type StripeLocation = {
  name: string;
  countryCode?: string;
  parentLocationIndex?: number;
};

type StripeListing = {
  greenhouseId: number;
  title: string;
  slug: string;
  locationIndices: number[];
  employmentType?: string;
};

/**
 * Stripe careers search: filter US + Full time + titleIncludes from embedded index.
 * Matches locations under the "United States" node (North America → United States).
 */
async function extractStripeJobIndex(
  company: Company,
  html: string,
): Promise<JobListing[] | null> {
  const match = html.match(
    /<script id="__NEXT_DATA__"[^>]*>(?<json>[\s\S]*?)<\/script>/i,
  );
  if (!match?.groups?.json) return null;

  let data: {
    props?: {
      pageProps?: {
        jobIndexData?: {
          filters?: { locations?: StripeLocation[] };
          listings?: StripeListing[];
        };
      };
    };
  };
  try {
    data = JSON.parse(match.groups.json);
  } catch {
    return null;
  }

  const index = data.props?.pageProps?.jobIndexData;
  const locations = index?.filters?.locations;
  const listings = index?.listings;
  if (!Array.isArray(locations) || !Array.isArray(listings)) return null;

  const usRoot = locations.findIndex((loc) => loc.name === "United States");
  if (usRoot < 0) {
    throw new Error("Stripe job index missing United States location node");
  }

  const underUs = new Set<number>();
  for (let i = 0; i < locations.length; i++) {
    if (stripeLocationUnder(locations, i, usRoot)) underUs.add(i);
  }

  const byUrl = new Map<string, JobListing>();
  for (const listing of listings) {
    if (!listing?.title || !listing.slug || !listing.greenhouseId) continue;
    if (listing.employmentType !== "Full time") continue;

    const inUs = (listing.locationIndices ?? []).some((idx) => underUs.has(idx));
    if (!inUs) continue;

    if (company.titleIncludes?.length) {
      if (!titleMatchesIncludes(listing.title, company.titleIncludes)) continue;
    }
    if (company.titleIncludesAll?.length) {
      if (!titleMatchesAllIncludes(listing.title, company.titleIncludesAll))
        continue;
    }
    if (company.titleExcludes?.length) {
      if (titleMatchesIncludes(listing.title, company.titleExcludes)) continue;
    }

    const absolute = new URL(
      `https://stripe.com/careers/listing/${listing.slug}/${listing.greenhouseId}`,
    );
    const jobPathRe = new RegExp(
      company.jobPathPattern ?? DEFAULT_JOB_PATH_PATTERN,
      "i",
    );
    if (!jobPathRe.test(absolute.pathname)) continue;

    const canonical = canonicalizeJobUrl(absolute);
    const id = await jobId(company.id, canonical);
    byUrl.set(canonical, {
      id,
      title: listing.title.replace(/\s+/g, " ").trim(),
      url: canonical,
    });
  }

  return [...byUrl.values()];
}

function stripeLocationUnder(
  locations: StripeLocation[],
  index: number,
  ancestor: number,
): boolean {
  let current: number | undefined = index;
  const seen = new Set<number>();
  while (current !== undefined && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = locations[current]?.parentLocationIndex;
  }
  return false;
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    );
}

/** Shopify careers XML feed (`/careers/feed.xml`) and similar `<job>` boards. */
function parseXmlJobFeed(xml: string): Array<Record<string, string>> {
  const jobs: Array<Record<string, string>> = [];
  for (const match of xml.matchAll(/<job>([\s\S]*?)<\/job>/gi)) {
    const block = match[1] ?? "";
    const title = xmlCdata(block, "title");
    const url =
      xmlCdata(block, "applyUrl") ||
      xmlCdata(block, "url") ||
      xmlCdata(block, "link");
    const id = xmlCdata(block, "partnerJobId") || xmlCdata(block, "id");
    const location = xmlCdata(block, "location");
    if (!title || !url) continue;
    const row: Record<string, string> = { title, url };
    if (id) row.id = id;
    if (location) row.location = location;
    jobs.push(row);
  }
  return jobs;
}

function xmlCdata(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`,
    "i",
  );
  const m = block.match(re);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

/** Prefer stable board job ids when present in the path. */
function canonicalizeJobUrl(url: URL): string {
  const uuid =
    String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;
  const boardId =
    url.pathname.match(/\/(?:profile\/job_details|jobs(?:\/view)?|careers\/job)\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/careers\/listing\/[^/]+\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/careers\/positions\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/jobs\/results\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/details\/([0-9-]+)/i)?.[1] ??
    url.pathname.match(/\/detail\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/listing\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/JobDetail\/[^/]+\/(\d+)/i)?.[1] ??
    url.pathname.match(/\/job\/([A-Za-z0-9_-]{6,})/i)?.[1] ??
    // Ashby: /notion/<uuid>
    url.pathname.match(new RegExp(String.raw`/[a-z0-9_-]+/(${uuid})$`, "i"))?.[1] ??
    // Shopify: /careers/<slug>_<uuid>
    url.pathname.match(new RegExp(String.raw`_(${uuid})$`, "i"))?.[1] ??
    // Workday: .../Job-Title_R123456/apply
    url.pathname.match(/_(R\d+(?:-\d+)?)(?:\/|$)/i)?.[1] ??
    // LinkedIn: /jobs/view/<slug>-<numericId>
    url.pathname.match(/\/jobs\/view\/(?:[^/]+-)?(\d+)\/?$/i)?.[1] ??
    url.searchParams.get("ashby_jid") ??
    url.searchParams.get("gh_jid") ??
    url.searchParams.get("jobId") ??
    url.searchParams.get("job_id");

  if (boardId) {
    const clean = new URL(url.origin + url.pathname);
    return `${clean.origin}${clean.pathname}#${boardId}`;
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|gh_src|ref|source)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

async function jobId(companyId: string, canonicalUrl: string): Promise<string> {
  const data = new TextEncoder().encode(`${companyId}\0${canonicalUrl}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** /jobs/results/<id>-software-engineer-early-career-campus -> title-ish string */
function titleFromGoogleSlug(pathname: string): string | null {
  const m = pathname.match(/\/jobs\/results\/\d+-([a-z0-9-]+)/i);
  if (!m?.[1]) return null;
  const titled = m[1]
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return titled || null;
}

/** /us/en/job/<id>/Software-Engineer-Backend -> "Software Engineer Backend" */
function titleFromJobPathSlug(pathname: string): string | null {
  const m =
    pathname.match(/\/job\/[^/]+\/([^/?#]+)/i) ??
    // ServiceNow Phenom: /jobs/<id>/<slug>/
    pathname.match(/\/jobs\/\d+\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  const titled = m[1]
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return titled || null;
}
