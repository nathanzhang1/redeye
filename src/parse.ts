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
      Accept: "text/html,application/xhtml+xml",
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
    if (!title || title.length > 300) {
      // Meta sometimes wraps icons; fall back to a generic title from the id
      const idFromPath = absolute.pathname.match(/\/jobs\/(\d+)/i)?.[1];
      if (!idFromPath) continue;
      title = `Job ${idFromPath}`;
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
    url.pathname.match(/\/jobs\/(?:view\/)?(\d{5,})/i)?.[1] ??
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
