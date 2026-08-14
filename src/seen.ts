import type { JobListing } from "./parse";

export type SeenJobRecord = {
  title: string;
  url: string;
  firstSeenAt: string;
};

function jobKey(companyId: string, jobId: string): string {
  return `job:${companyId}:${jobId}`;
}

function bootstrapKey(companyId: string): string {
  return `bootstrap:${companyId}`;
}

function failKey(companyId: string): string {
  return `fail:${companyId}`;
}

export async function isBootstrapped(
  kv: KVNamespace,
  companyId: string,
): Promise<boolean> {
  const value = await kv.get(bootstrapKey(companyId));
  return value === "done";
}

export async function markBootstrapped(
  kv: KVNamespace,
  companyId: string,
): Promise<void> {
  await kv.put(bootstrapKey(companyId), "done");
}

export async function hasSeenJob(
  kv: KVNamespace,
  companyId: string,
  jobId: string,
): Promise<boolean> {
  const value = await kv.get(jobKey(companyId, jobId));
  return value !== null;
}

export async function markJobSeen(
  kv: KVNamespace,
  companyId: string,
  job: JobListing,
): Promise<void> {
  const record: SeenJobRecord = {
    title: job.title,
    url: job.url,
    firstSeenAt: new Date().toISOString(),
  };
  await kv.put(jobKey(companyId, job.id), JSON.stringify(record));
}

export async function seedJobs(
  kv: KVNamespace,
  companyId: string,
  jobs: JobListing[],
): Promise<void> {
  await Promise.all(jobs.map((job) => markJobSeen(kv, companyId, job)));
  await markBootstrapped(kv, companyId);
}

const FAIL_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Workers Free ≈ 10 browser-minutes/day. Polling Meta+NVIDIA every 5 minutes
 * burns the budget immediately. Space browser companies out.
 */
export const BROWSER_MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const BROWSER_RATE_LIMIT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
export const MAX_BROWSER_COMPANIES_PER_RUN = 1;

function browserLastKey(companyId: string): string {
  return `browser:last:${companyId}`;
}

const BROWSER_COOLDOWN_KEY = "browser:cooldown_until";

/** Returns true if a failure alert should be sent (and records the send). */
export async function shouldAlertFailure(
  kv: KVNamespace,
  companyId: string,
): Promise<boolean> {
  const last = await kv.get(failKey(companyId));
  if (last) {
    const elapsed = Date.now() - Date.parse(last);
    if (!Number.isNaN(elapsed) && elapsed < FAIL_ALERT_COOLDOWN_MS) {
      return false;
    }
  }
  await kv.put(failKey(companyId), new Date().toISOString());
  return true;
}

export async function getBrowserLastAttempt(
  kv: KVNamespace,
  companyId: string,
): Promise<number | null> {
  const raw = await kv.get(browserLastKey(companyId));
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : ts;
}

export async function markBrowserAttempt(
  kv: KVNamespace,
  companyId: string,
): Promise<void> {
  await kv.put(browserLastKey(companyId), new Date().toISOString());
}

export async function getBrowserCooldownUntil(
  kv: KVNamespace,
): Promise<number | null> {
  const raw = await kv.get(BROWSER_COOLDOWN_KEY);
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : ts;
}

export async function setBrowserCooldown(
  kv: KVNamespace,
  durationMs: number = BROWSER_RATE_LIMIT_COOLDOWN_MS,
): Promise<void> {
  const until = new Date(Date.now() + durationMs).toISOString();
  await kv.put(BROWSER_COOLDOWN_KEY, until);
}

export function browserDueMs(
  lastAttemptAt: number | null,
  now: number = Date.now(),
): number {
  if (lastAttemptAt === null) return 0;
  return Math.max(0, lastAttemptAt + BROWSER_MIN_INTERVAL_MS - now);
}
