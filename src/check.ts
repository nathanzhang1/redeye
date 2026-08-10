import { fetchRenderedHtml } from "./browser";
import { COMPANIES, type Company } from "./companies";
import { notifyNewJobs, notifyScrapeFailure } from "./discord";
import { extractJobs, fetchCareerPage, type JobListing } from "./parse";
import {
  hasSeenJob,
  isBootstrapped,
  markJobSeen,
  seedJobs,
  shouldAlertFailure,
} from "./seen";
import { saveLastRun, saveRunStatus } from "./status";

export type CheckSummary = {
  companies: number;
  newJobs: number;
  seeded: number;
  failures: number;
  details: Array<{
    companyId: string;
    status: "ok" | "seeded" | "failed";
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
    details: [],
  };

  for (const company of COMPANIES) {
    const detail = await checkCompany(env, company);
    summary.details.push(detail);
    if (detail.status === "failed") summary.failures += 1;
    if (detail.status === "seeded") summary.seeded += 1;
    summary.newJobs += detail.notified;
    await saveRunStatus(env.SEEN_JOBS, company, detail);
  }

  await saveLastRun(env.SEEN_JOBS, summary);
  console.log(JSON.stringify({ event: "check_complete", ...summary }));
  return summary;
}

async function checkCompany(
  env: Env,
  company: Company,
): Promise<CheckSummary["details"][number]> {
  try {
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

    if (env.DISCORD_WEBHOOK_URL) {
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
    return fetchRenderedHtml(env.BROWSER, company.url);
  }

  const html = await fetchCareerPage(company.url);
  if (!html || html.length < 50) {
    throw new Error("Page HTML empty or too short (possible block/JS shell)");
  }
  return html;
}
