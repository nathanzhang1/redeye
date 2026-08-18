import type { JobListing } from "./parse";

const MAX_EMBEDS = 10;

/**
 * Discord often will not highlight/ping when <@user> shares a message with embeds.
 * Send a plain ping first, then the embed details.
 */
export async function notifyNewJobs(
  webhookUrl: string,
  companyName: string,
  jobs: JobListing[],
  mentionUserId?: string,
): Promise<void> {
  if (jobs.length === 0) return;

  if (mentionUserId) {
    await postWebhook(webhookUrl, {
      content: `<@${mentionUserId}> **New grad SWE — ${companyName}** (${jobs.length} new)`,
      allowed_mentions: { users: [mentionUserId] },
    });
  }

  for (let i = 0; i < jobs.length; i += MAX_EMBEDS) {
    const chunk = jobs.slice(i, i + MAX_EMBEDS);
    await postWebhook(webhookUrl, {
      content: mentionUserId
        ? undefined
        : `**New grad SWE roles — ${companyName}**`,
      embeds: chunk.map((job) => ({
        title: truncate(job.title, 256),
        url: job.url,
        description: "New grad SWE",
        color: 0xe11d48,
        timestamp: new Date().toISOString(),
        footer: { text: companyName },
      })),
      allowed_mentions: { parse: [] },
    });
  }
}

async function postWebhook(
  webhookUrl: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Drop undefined keys so Discord doesn't get `"content": null`
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) cleaned[key] = value;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cleaned),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discord webhook failed (${response.status}): ${detail}`);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
