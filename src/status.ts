import { COMPANIES, type Company } from "./companies";
import { getControlState } from "./control";
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
  paused: boolean;
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
  globalPaused: boolean;
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
  const [lastRunRaw, control] = await Promise.all([
    kv.get(LAST_RUN_KEY),
    getControlState(kv),
  ]);
  const lastRun = lastRunRaw
    ? (JSON.parse(lastRunRaw) as LastRunRecord)
    : null;
  const pausedIds = new Set(control.pausedCompanyIds);

  const companies: CompanyRunStatus[] = await Promise.all(
    COMPANIES.map(async (company) => {
      const raw = await kv.get(companyStatusKey(company.id));
      const bootstrapped = await isBootstrapped(kv, company.id);
      const paused = pausedIds.has(company.id);
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
          paused,
        };
      }
      const saved = JSON.parse(raw) as Omit<
        CompanyRunStatus,
        "bootstrapped" | "paused"
      >;
      return { ...saved, bootstrapped, paused };
    }),
  );

  return {
    cron: "*/10 * * * *",
    globalPaused: control.globalPaused,
    lastRunAt: lastRun?.checkedAt ?? null,
    lastRun,
    companies,
  };
}

export function renderStatusHtml(
  status: TrackerStatus,
  options: { token: string },
): string {
  const token = options.token;
  const pauseAction = `/control/pause?token=${encodeURIComponent(token)}`;
  const statusHref = `/status?token=${encodeURIComponent(token)}&format=html`;

  const rows = status.companies
    .map((c) => {
      const checked = c.checkedAt
        ? escapeHtml(c.checkedAt)
        : "<em>never</em>";
      const err = c.error
        ? `<div class="err">${escapeHtml(c.error)}</div>`
        : "";
      const pauseBadge = c.paused
        ? `<span class="badge paused">paused</span> `
        : "";
      const pauseBtn = c.paused
        ? pauseForm(pauseAction, {
            scope: "company",
            companyId: c.companyId,
            paused: false,
            label: "Resume",
            className: "btn resume",
          })
        : pauseForm(pauseAction, {
            scope: "company",
            companyId: c.companyId,
            paused: true,
            label: "Pause",
            className: "btn pause",
          });
      return `<tr class="${c.paused ? "row-paused" : ""}">
        <td><strong>${escapeHtml(c.name)}</strong><br><code>${escapeHtml(c.companyId)}</code></td>
        <td>${pauseBadge}<span class="badge ${c.status}">${c.status}</span></td>
        <td>${checked}</td>
        <td>${c.matched}</td>
        <td>${c.notified}</td>
        <td>${c.bootstrapped ? "yes" : "no"}</td>
        <td>${escapeHtml(c.fetchMode)} / ${escapeHtml(c.matchMode)}${err}<br><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">open page</a></td>
        <td>${pauseBtn}</td>
      </tr>`;
    })
    .join("\n");

  const globalBtn = status.globalPaused
    ? pauseForm(pauseAction, {
        scope: "global",
        paused: false,
        label: "Resume all polling",
        className: "btn resume global",
      })
    : pauseForm(pauseAction, {
        scope: "global",
        paused: true,
        label: "Pause all polling",
        className: "btn pause global",
      });

  const pausedCount = status.companies.filter((c) => c.paused).length;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redeye status</title>
  <style>
    :root { color-scheme: light dark; --ok:#16a34a; --fail:#dc2626; --seed:#2563eb; --skip:#d97706; --never:#6b7280; --paused:#7c3aed; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 1.25rem; line-height: 1.4; }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    .meta { color: #6b7280; margin-bottom: 1rem; font-size: .9rem; }
    .controls { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
    .banner { padding: .65rem .8rem; border-radius: .5rem; margin-bottom: 1rem; font-size: .9rem; }
    .banner.paused { background: color-mix(in srgb, var(--paused) 18%, transparent); border: 1px solid color-mix(in srgb, var(--paused) 45%, transparent); }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; }
    th, td { text-align: left; padding: .55rem .4rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .badge { display: inline-block; padding: .1rem .45rem; border-radius: 999px; font-size: .75rem; font-weight: 600; color: #fff; }
    .badge.ok { background: var(--ok); }
    .badge.failed { background: var(--fail); }
    .badge.seeded { background: var(--seed); }
    .badge.skipped { background: var(--skip); }
    .badge.never { background: var(--never); }
    .badge.paused { background: var(--paused); }
    .err { margin-top: .35rem; color: var(--fail); font-size: .8rem; word-break: break-word; }
    .badge.skipped + .err, td:has(.badge.skipped) .err { color: var(--skip); }
    code { font-size: .8rem; }
    a { color: inherit; }
    .btn { appearance: none; border: 1px solid #d1d5db; background: #f9fafb; color: inherit; border-radius: .4rem; padding: .3rem .55rem; font-size: .8rem; font-weight: 600; cursor: pointer; }
    .btn.pause { border-color: color-mix(in srgb, var(--paused) 50%, #d1d5db); }
    .btn.resume { border-color: color-mix(in srgb, var(--ok) 50%, #d1d5db); }
    .btn.global { padding: .45rem .75rem; }
    tr.row-paused { opacity: .72; }
    form.inline { display: inline; margin: 0; }
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
    ${pausedCount ? ` · company pauses ${pausedCount}` : ""}
  </div>
  ${
    status.globalPaused
      ? `<div class="banner paused"><strong>Global pause is on</strong> — cron and <code>/run</code> skip all companies. Last-check rows are preserved.</div>`
      : ""
  }
  <div class="controls">
    ${globalBtn}
    <a class="btn" href="${escapeAttr(statusHref)}">Refresh</a>
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
        <th>Control</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="8">No companies configured</td></tr>`}
    </tbody>
  </table>
</body>
</html>`;
}

function pauseForm(
  action: string,
  opts: {
    scope: "global" | "company";
    companyId?: string;
    paused: boolean;
    label: string;
    className: string;
  },
): string {
  const companyField =
    opts.scope === "company" && opts.companyId
      ? `<input type="hidden" name="companyId" value="${escapeAttr(opts.companyId)}" />`
      : "";
  return `<form class="inline" method="post" action="${escapeAttr(action)}">
    <input type="hidden" name="scope" value="${escapeAttr(opts.scope)}" />
    <input type="hidden" name="paused" value="${opts.paused ? "true" : "false"}" />
    ${companyField}
    <button class="${escapeAttr(opts.className)}" type="submit">${escapeHtml(opts.label)}</button>
  </form>`;
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
