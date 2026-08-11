import { COMPANIES, type Company } from "./companies";
import { isBootstrapped } from "./seen";

export type CompanyCheckDetail = {
  companyId: string;
  status: "ok" | "seeded" | "failed" | "skipped";
  matched: number;
  notified: number;
  error?: string;
};

export type CompanyRunStatus = {
  companyId: string;
  name: string;
  url: string;
  fetchMode: "html" | "browser";
  matchMode: "keywords" | "all_jobs";
  status: "ok" | "seeded" | "failed" | "skipped" | "never";
  matched: number;
  notified: number;
  error?: string;
  checkedAt: string | null;
  bootstrapped: boolean;
};

export type LastRunRecord = {
  checkedAt: string;
  companies: number;
  newJobs: number;
  seeded: number;
  failures: number;
  skipped?: number;
  details: CompanyCheckDetail[];
};

export type TrackerStatus = {
  cron: string;
  lastRunAt: string | null;
  lastRun: LastRunRecord | null;
  companies: CompanyRunStatus[];
};

function companyStatusKey(companyId: string): string {
  return `status:company:${companyId}`;
}

const LAST_RUN_KEY = "status:last_run";

export async function saveRunStatus(
  kv: KVNamespace,
  company: Company,
  detail: CompanyCheckDetail,
): Promise<void> {
  const record = {
    companyId: company.id,
    name: company.name,
    url: company.url,
    fetchMode: company.fetchMode ?? "html",
    matchMode: company.matchMode ?? "keywords",
    status: detail.status,
    matched: detail.matched,
    notified: detail.notified,
    error: detail.error,
    checkedAt: new Date().toISOString(),
  };
  await kv.put(companyStatusKey(company.id), JSON.stringify(record));
}

export async function saveLastRun(
  kv: KVNamespace,
  summary: {
    companies: number;
    newJobs: number;
    seeded: number;
    failures: number;
    skipped?: number;
    details: CompanyCheckDetail[];
  },
): Promise<void> {
  const record: LastRunRecord = {
    checkedAt: new Date().toISOString(),
    companies: summary.companies,
    newJobs: summary.newJobs,
    seeded: summary.seeded,
    failures: summary.failures,
    skipped: summary.skipped ?? 0,
    details: summary.details,
  };
  await kv.put(LAST_RUN_KEY, JSON.stringify(record));
}

export async function getTrackerStatus(kv: KVNamespace): Promise<TrackerStatus> {
  const lastRunRaw = await kv.get(LAST_RUN_KEY);
  const lastRun = lastRunRaw
    ? (JSON.parse(lastRunRaw) as LastRunRecord)
    : null;

  const companies: CompanyRunStatus[] = await Promise.all(
    COMPANIES.map(async (company) => {
      const raw = await kv.get(companyStatusKey(company.id));
      const bootstrapped = await isBootstrapped(kv, company.id);
      if (!raw) {
        return {
          companyId: company.id,
          name: company.name,
          url: company.url,
          fetchMode: company.fetchMode ?? "html",
          matchMode: company.matchMode ?? "keywords",
          status: "never",
          matched: 0,
          notified: 0,
          checkedAt: null,
          bootstrapped,
        };
      }
      const saved = JSON.parse(raw) as Omit<CompanyRunStatus, "bootstrapped">;
      return { ...saved, bootstrapped };
    }),
  );

  return {
    cron: "*/10 * * * *",
    lastRunAt: lastRun?.checkedAt ?? null,
    lastRun,
    companies,
  };
}

export function renderStatusHtml(status: TrackerStatus): string {
  const rows = status.companies
    .map((c) => {
      const checked = c.checkedAt
        ? escapeHtml(c.checkedAt)
        : "<em>never</em>";
      const err = c.error
        ? `<div class="err">${escapeHtml(c.error)}</div>`
        : "";
      return `<tr>
        <td><strong>${escapeHtml(c.name)}</strong><br><code>${escapeHtml(c.companyId)}</code></td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>${checked}</td>
        <td>${c.matched}</td>
        <td>${c.notified}</td>
        <td>${c.bootstrapped ? "yes" : "no"}</td>
        <td>${escapeHtml(c.fetchMode)} / ${escapeHtml(c.matchMode)}${err}<br><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">open page</a></td>
      </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redeye status</title>
  <style>
    :root { color-scheme: light dark; --ok:#16a34a; --fail:#dc2626; --seed:#2563eb; --skip:#d97706; --never:#6b7280; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 1.25rem; line-height: 1.4; }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    .meta { color: #6b7280; margin-bottom: 1rem; font-size: .9rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { text-align: left; padding: .55rem .4rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .badge { display: inline-block; padding: .1rem .45rem; border-radius: 999px; font-size: .75rem; font-weight: 600; color: #fff; }
    .badge.ok { background: var(--ok); }
    .badge.failed { background: var(--fail); }
    .badge.seeded { background: var(--seed); }
    .badge.skipped { background: var(--skip); }
    .badge.never { background: var(--never); }
    .err { margin-top: .35rem; color: var(--fail); font-size: .8rem; word-break: break-word; }
    .badge.skipped + .err, td:has(.badge.skipped) .err { color: var(--skip); }
    code { font-size: .8rem; }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>Redeye status</h1>
  <div class="meta">
    Cron: <code>${escapeHtml(status.cron)}</code><br />
    Last run: <strong>${status.lastRunAt ? escapeHtml(status.lastRunAt) : "never"}</strong>
    ${
      status.lastRun
        ? ` · companies ${status.lastRun.companies} · new ${status.lastRun.newJobs} · failures ${status.lastRun.failures} · skipped ${status.lastRun.skipped ?? 0}`
        : ""
    }
  </div>
  <table>
    <thead>
      <tr>
        <th>Company</th>
        <th>Status</th>
        <th>Last check</th>
        <th>Matched</th>
        <th>Notified</th>
        <th>Bootstrapped</th>
        <th>Config</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="7">No companies configured</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
