import {
  BrowserRateLimitError,
  fetchRenderedHtml,
} from "./browser";
import { COMPANIES, type Company } from "./companies";
import { notifyNewJobs, notifyScrapeFailure } from "./discord";
import { extractJobs, fetchCareerPage, type JobListing } from "./parse";
import {
  BROWSER_MIN_INTERVAL_MS,
  MAX_BROWSER_COMPANIES_PER_RUN,
  browserDueMs,
  getBrowserCooldownUntil,
  getBrowserLastAttempt,
  hasSeenJob,
  isBootstrapped,
  markBrowserAttempt,
  markJobSeen,
  seedJobs,
  setBrowserCooldown,
  shouldAlertFailure,
} from "./seen";
import { saveLastRun, saveRunStatus } from "./status";

export type CheckSummary = {
  companies: number;
  newJobs: number;
  seeded: number;
  failures: number;
  skipped: number;
  details: Array<{
    companyId: string;
    status: "ok" | "seeded" | "failed" | "skipped";
    matched: number;
    notified: number;
    error?: string;
  }>;
};

export async function checkAll(env: Env): Promise<CheckSummary> {
  const summary: CheckSummary = {
    companies: COMPANIES.length,
    newJobs: 0,
    seeded: 0,
    failures: 0,
    skipped: 0,
    details: [],
  };

  const browserPlan = await planBrowserCompanies(env.SEEN_JOBS);

  for (const company of COMPANIES) {
    const usesBrowser = (company.fetchMode ?? "html") === "browser";
    if (usesBrowser && !browserPlan.runIds.has(company.id)) {
      const reason =
        browserPlan.skipReasons.get(company.id) ??
        "Browser poll skipped (quota budget)";
      const detail = {
        companyId: company.id,
        status: "skipped" as const,
        matched: 0,
        notified: 0,
        error: reason,
      };
      summary.details.push(detail);
      summary.skipped += 1;
      await saveRunStatus(env.SEEN_JOBS, company, detail);
      console.log(
        JSON.stringify({
          event: "company_skipped",
          companyId: company.id,
          reason,
        }),
      );
      continue;
    }

    const detail = await checkCompany(env, company);
    summary.details.push(detail);
    if (detail.status === "failed") summary.failures += 1;
    if (detail.status === "seeded") summary.seeded += 1;
    if (detail.status === "skipped") summary.skipped += 1;
    summary.newJobs += detail.notified;
    await saveRunStatus(env.SEEN_JOBS, company, detail);

    if (
      usesBrowser &&
      detail.status === "failed" &&
      detail.error?.includes("429")
    ) {
      await setBrowserCooldown(env.SEEN_JOBS);
      // Drop any remaining planned browser companies this run.
      for (const id of [...browserPlan.runIds]) {
        if (id !== company.id) browserPlan.runIds.delete(id);
      }
    }
  }

  await saveLastRun(env.SEEN_JOBS, summary);
  console.log(JSON.stringify({ event: "check_complete", ...summary }));
  return summary;
}

async function planBrowserCompanies(kv: KVNamespace): Promise<{
  runIds: Set<string>;
  skipReasons: Map<string, string>;
}> {
  const skipReasons = new Map<string, string>();
  const runIds = new Set<string>();
  const now = Date.now();

  const cooldownUntil = await getBrowserCooldownUntil(kv);
  if (cooldownUntil && cooldownUntil > now) {
    const mins = Math.ceil((cooldownUntil - now) / 60_000);
    for (const company of COMPANIES) {
      if ((company.fetchMode ?? "html") === "browser") {
        skipReasons.set(
          company.id,
          `Browser Run cooldown (~${mins}m left after 429; free tier ~10 min/day)`,
        );
      }
    }
    return { runIds, skipReasons };
  }

  type Candidate = { id: string; last: number | null; dueIn: number };
  const due: Candidate[] = [];
  const notDue: Candidate[] = [];

  for (const company of COMPANIES) {
    if ((company.fetchMode ?? "html") !== "browser") continue;
    const last = await getBrowserLastAttempt(kv, company.id);
    const dueIn = browserDueMs(last, now);
    const row = { id: company.id, last, dueIn };
    if (dueIn === 0) due.push(row);
    else notDue.push(row);
  }

  // Oldest last-attempt first; never-run companies first among those.
  due.sort((a, b) => (a.last ?? 0) - (b.last ?? 0));

  for (const row of due.slice(0, MAX_BROWSER_COMPANIES_PER_RUN)) {
    runIds.add(row.id);
  }
  for (const row of due.slice(MAX_BROWSER_COMPANIES_PER_RUN)) {
    skipReasons.set(
      row.id,
      `Browser slot used by another company this run (max ${MAX_BROWSER_COMPANIES_PER_RUN}; interval ${BROWSER_MIN_INTERVAL_MS / 60_000}m)`,
    );
  }
  for (const row of notDue) {
    const mins = Math.ceil(row.dueIn / 60_000);
    skipReasons.set(
      row.id,
      `Next browser poll in ~${mins}m (free tier budget; every ${BROWSER_MIN_INTERVAL_MS / 60_000}m)`,
    );
  }

  return { runIds, skipReasons };
}

async function checkCompany(
  env: Env,
  company: Company,
): Promise<CheckSummary["details"][number]> {
  const usesBrowser = (company.fetchMode ?? "html") === "browser";
  try {
    if (usesBrowser) {
      await markBrowserAttempt(env.SEEN_JOBS, company.id);
    }

    const html = await loadPage(env, company);
    const jobs = await extractJobs(company, html);
    const bootstrapped = await isBootstrapped(env.SEEN_JOBS, company.id);

    if (!bootstrapped) {
      await seedJobs(env.SEEN_JOBS, company.id, jobs);
      console.log(
        JSON.stringify({
          event: "bootstrap",
          companyId: company.id,
          seeded: jobs.length,
        }),
      );
      return {
        companyId: company.id,
        status: "seeded",
        matched: jobs.length,
        notified: 0,
      };
    }

    const fresh: JobListing[] = [];
    for (const job of jobs) {
      const seen = await hasSeenJob(env.SEEN_JOBS, company.id, job.id);
      if (!seen) fresh.push(job);
    }

    for (const job of fresh) {
      await markJobSeen(env.SEEN_JOBS, company.id, job);
    }

    if (fresh.length > 0) {
      if (!env.DISCORD_WEBHOOK_URL) {
        throw new Error("DISCORD_WEBHOOK_URL secret is not set");
      }
      await notifyNewJobs(
        env.DISCORD_WEBHOOK_URL,
        company.name,
        fresh,
        env.DISCORD_USER_ID,
      );
    }

    console.log(
      JSON.stringify({
        event: "company_ok",
        companyId: company.id,
        matched: jobs.length,
        notified: fresh.length,
      }),
    );

    return {
      companyId: company.id,
      status: "ok",
      matched: jobs.length,
      notified: fresh.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        event: "company_failed",
        companyId: company.id,
        error: message,
      }),
    );

    if (error instanceof BrowserRateLimitError) {
      await setBrowserCooldown(env.SEEN_JOBS);
    }

    const isRateLimit =
      error instanceof BrowserRateLimitError || message.includes("429");

    if (env.DISCORD_WEBHOOK_URL) {
      // Don't Discord-spam on expected free-tier / LinkedIn 429s.
      if (!isRateLimit) {
        const alert = await shouldAlertFailure(env.SEEN_JOBS, company.id);
        if (alert) {
          try {
            await notifyScrapeFailure(
              env.DISCORD_WEBHOOK_URL,
              company.name,
              message,
              env.DISCORD_USER_ID,
            );
          } catch (notifyError) {
            console.log(
              JSON.stringify({
                event: "failure_notify_failed",
                companyId: company.id,
                error:
                  notifyError instanceof Error
                    ? notifyError.message
                    : String(notifyError),
              }),
            );
          }
        }
      }
    }

    // Datacenter IPs often 429 LinkedIn guest search / Jina reader — treat as skip.
    if (
      isRateLimit &&
      (company.id === "linkedin" || company.url.includes("r.jina.ai/"))
    ) {
      return {
        companyId: company.id,
        status: "skipped",
        matched: 0,
        notified: 0,
        error: "Rate-limited (429); will retry next cron",
      };
    }

    return {
      companyId: company.id,
      status: "failed",
      matched: 0,
      notified: 0,
      error: message,
    };
  }
}

async function loadPage(env: Env, company: Company): Promise<string> {
  if ((company.fetchMode ?? "html") === "browser") {
    if (!env.BROWSER) {
      throw new Error(
        "BROWSER binding missing — add browser.binding in wrangler.jsonc",
      );
    }
    return fetchRenderedHtml(env.BROWSER, company.url, {
      waitForSelector: company.browserWaitForSelector,
    });
  }

  const html = company.fetchStartOffsets?.length
    ? await fetchPaginatedCareerPage(company)
    : await fetchCareerPage(company.url, company.fetchBody);
  if (!html || html.length < 50) {
    throw new Error("Page HTML empty or too short (possible block/JS shell)");
  }
  return html;
}

/**
 * Fetch several `start=` pages and combine them.
 * LinkedIn guest API returns HTML fragments (concat). Eightfold PCSX returns
 * JSON `{ data: { positions } }` / `{ positions }` — merge those arrays.
 */
async function fetchPaginatedCareerPage(company: Company): Promise<string> {
  const offsets = company.fetchStartOffsets ?? [0];
  const chunks: string[] = [];
  for (let i = 0; i < offsets.length; i++) {
    if (i > 0) await sleep(750);
    const pageUrl = new URL(company.url);
    pageUrl.searchParams.set("start", String(offsets[i]));
    const html = await fetchCareerPage(pageUrl.toString(), company.fetchBody);
    if (html && html.length >= 50) chunks.push(html);
  }
  return mergePaginatedChunks(chunks);
}

/** Merge JSON job pages when possible; otherwise concatenate as HTML. */
function mergePaginatedChunks(chunks: string[]): string {
  if (chunks.length <= 1) return chunks[0] ?? "";
  const parsed: unknown[] = [];
  for (const chunk of chunks) {
    try {
      parsed.push(JSON.parse(chunk));
    } catch {
      return chunks.join("\n");
    }
  }
  const merged: unknown[] = [];
  for (const data of parsed) {
    if (!data || typeof data !== "object") return chunks.join("\n");
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.positions)) {
      merged.push(...obj.positions);
      continue;
    }
    if (Array.isArray(obj.jobs)) {
      merged.push(...obj.jobs);
      continue;
    }
    const inner = obj.data;
    if (inner && typeof inner === "object") {
      const d = inner as Record<string, unknown>;
      if (Array.isArray(d.positions)) {
        merged.push(...d.positions);
        continue;
      }
      if (Array.isArray(d.jobs)) {
        merged.push(...d.jobs);
        continue;
      }
    }
    return chunks.join("\n");
  }
  return JSON.stringify({ positions: merged });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
