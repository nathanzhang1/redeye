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

const FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 2_000_000;

export async function fetchCareerPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/json",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

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

export async function extractJobs(
  company: Company,
  html: string,
): Promise<JobListing[]> {
  const trimmed = html.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return extractJobsFromJson(company, trimmed);
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

  for (const match of anchors) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;

    const href = hrefMatch[2].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }

    let absolute: URL;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
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
    if (!title || title.length > 300 || /^learn more$/i.test(title)) {
      // Google: /jobs/results/<id>-software-engineer-early-career-campus
      const slugTitle = titleFromGoogleSlug(absolute.pathname);
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
 * - { items: [{ requisitionList: […] }] } (Oracle recruitingCEJobRequisitions)
 * Row fields: title|Title|name|posting_name, absolute_url|canonicalPositionUrl|job_path|url,
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
      "";
    const title = titleRaw.replace(/\s+/g, " ").trim();
    const boardId =
      (typeof row.id === "string" && row.id) ||
      (typeof row.id === "number" && String(row.id)) ||
      (typeof row.Id === "string" && row.Id) ||
      (typeof row.Id === "number" && String(row.Id)) ||
      "";
    const pathOrUrl =
      (typeof row.absolute_url === "string" && row.absolute_url) ||
      (typeof row.canonicalPositionUrl === "string" &&
        row.canonicalPositionUrl) ||
      (typeof row.job_path === "string" && row.job_path) ||
      (typeof row.jobPath === "string" && row.jobPath) ||
      (typeof row.url === "string" && row.url) ||
      (boardId && company.jobUrlTemplate
        ? company.jobUrlTemplate.replaceAll("{id}", boardId)
        : "");
    if (!title || !pathOrUrl) continue;

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

    const locationText = jsonLocationText(row);
    if (!locationAllowed(locationText, company)) continue;

    const canonical = canonicalizeJobUrl(absolute);
    const id = await jobId(company.id, canonical);
    byUrl.set(canonical, { id, title, url: canonical });
  }

  return [...byUrl.values()];
}

function jsonJobRows(data: unknown, company: Company): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.jobs)) return obj.jobs;
  // Eightfold PCS: { positions: [...], count: N }
  if (Array.isArray(obj.positions)) return obj.positions;

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
    return rows;
  }

  // Oracle HCM: { items: [{ requisitionList: [...] }] }
  if (Array.isArray(obj.items)) {
    for (const item of obj.items) {
      if (!item || typeof item !== "object") continue;
      const list = (item as { requisitionList?: unknown }).requisitionList;
      if (Array.isArray(list)) return list;
    }
  }
  return null;
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
  return "";
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

/** Prefer stable board job ids when present in the path. */
function canonicalizeJobUrl(url: URL): string {
  const boardId =
    url.pathname.match(/\/(?:profile\/job_details|jobs(?:\/view)?|careers\/job)\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/careers\/listing\/[^/]+\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/careers\/positions\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/jobs\/results\/(\d{5,})/i)?.[1] ??
    url.pathname.match(/\/details\/([0-9-]+)/i)?.[1] ??
    url.pathname.match(/\/job\/([A-Za-z0-9_-]{6,})/i)?.[1] ??
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
