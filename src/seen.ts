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
