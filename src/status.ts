import { COMPANIES, type Company } from "./companies";
import { COMPANIES_PER_BATCH, getControlState } from "./control";
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

export type StatusFlash = {
  ran: "all" | "batch" | "company";
  companyId?: string;
  runStatus: string;
  matched: number;
  notified: number;
  failures: number;
  skipped: number;
  error?: string;
};

export function renderStatusHtml(
  status: TrackerStatus,
  options: { token: string; flash?: StatusFlash },
): string {
  const token = options.token;
  const pauseAction = `/control/pause?token=${encodeURIComponent(token)}`;
  const runAction = `/run?token=${encodeURIComponent(token)}`;
  const statusHref = `/status?token=${encodeURIComponent(token)}&format=html`;

  const counts = summarizeCompanies(status.companies);
  const sorted = [...status.companies].sort(compareCompaniesForStatus);

  const rows = sorted
    .map((c) => {
      const checked = c.checkedAt
        ? escapeHtml(formatPacificTime(c.checkedAt))
        : "<em>never</em>";
      const err = c.error
        ? `<div class="err" title="${escapeAttr(c.error)}">${escapeHtml(c.error)}</div>`
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
      const runBtn = runForm(runAction, {
        companyId: c.companyId,
        label: "Run",
        className: "btn run",
        title:
          "Poll this company now (bypasses pause + browser quota; may notify Discord)",
      });
      const attention = needsAttention(c) ? "1" : "0";
      const healthy = isHealthy(c) ? "1" : "0";
      return `<tr class="${c.paused ? "row-paused" : ""}"
        data-name="${escapeAttr(c.name.toLowerCase())}"
        data-id="${escapeAttr(c.companyId.toLowerCase())}"
        data-status="${escapeAttr(c.status)}"
        data-paused="${c.paused ? "1" : "0"}"
        data-attention="${attention}"
        data-healthy="${healthy}"
        data-rank="${statusSortRank(c)}"
        data-checked="${escapeAttr(c.checkedAt ?? "")}"
        data-matched="${c.matched}">
        <td class="col-company"><strong>${escapeHtml(c.name)}</strong><br><code>${escapeHtml(c.companyId)}</code></td>
        <td class="col-status">${pauseBadge}<span class="badge ${c.status}">${c.status}</span></td>
        <td class="col-checked">${checked}</td>
        <td class="col-num">${c.matched}</td>
        <td class="col-num">${c.notified}</td>
        <td class="col-num">${c.bootstrapped ? "yes" : "no"}</td>
        <td class="col-config"><span class="mode">${escapeHtml(c.fetchMode)} / ${escapeHtml(c.matchMode)}</span>${err}<br><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">open page</a></td>
        <td class="col-control actions">${runBtn}${pauseBtn}</td>
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

  const runAllBtn = runForm(runAction, {
    label: "Run batch",
    className: "btn run global",
    title:
      "Poll the next rotating batch now (same as cron; stays under Free subrequest limits)",
  });

  const flashBanner = renderFlashBanner(options.flash, status);

  const attentionList = sorted
    .filter(needsAttention)
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.name)}</strong> <span class="badge ${c.status}">${c.status}</span>${
          c.paused ? ` <span class="badge paused">paused</span>` : ""
        }${c.error ? ` — <span class="attn-err">${escapeHtml(truncate(c.error, 90))}</span>` : ""}</li>`,
    )
    .join("");

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
    .meta { color: #6b7280; margin-bottom: .75rem; font-size: .9rem; }
    .summary { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .85rem; }
    .chip { appearance: none; border: 1px solid #d1d5db; background: #f9fafb; color: inherit; border-radius: 999px; padding: .28rem .7rem; font-size: .8rem; font-weight: 600; cursor: pointer; }
    .chip.active { background: #111827; color: #fff; border-color: #111827; }
    .chip .n { font-variant-numeric: tabular-nums; margin-left: .2rem; opacity: .85; }
    .chip.ok .n { color: var(--ok); } .chip.active.ok .n { color: #86efac; }
    .chip.failed .n { color: var(--fail); } .chip.active.failed .n { color: #fca5a5; }
    .chip.skipped .n { color: var(--skip); } .chip.active.skipped .n { color: #fcd34d; }
    .chip.paused .n { color: var(--paused); } .chip.active.paused .n { color: #c4b5fd; }
    .chip.attention .n { color: var(--fail); } .chip.active.attention .n { color: #fca5a5; }
    .attention-box { margin-bottom: 1rem; padding: .65rem .8rem; border-radius: .5rem; border: 1px solid color-mix(in srgb, var(--fail) 35%, transparent); background: color-mix(in srgb, var(--fail) 8%, transparent); font-size: .85rem; }
    .attention-box h2 { font-size: .8rem; margin: 0 0 .4rem; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
    .attention-box ul { margin: 0; padding-left: 1.1rem; }
    .attention-box li { margin: .2rem 0; }
    .attn-err { color: #6b7280; }
    .controls { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: .75rem; }
    .toolbar { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-bottom: 1rem; }
    .toolbar label { font-size: .8rem; color: #6b7280; }
    .toolbar input[type="search"] { min-width: 12rem; flex: 1; max-width: 20rem; border: 1px solid #d1d5db; border-radius: .4rem; padding: .35rem .55rem; font: inherit; background: transparent; color: inherit; }
    .toolbar select { border: 1px solid #d1d5db; border-radius: .4rem; padding: .35rem .5rem; font: inherit; background: transparent; color: inherit; }
    .shown { font-size: .8rem; color: #6b7280; margin-left: auto; }
    .banner { padding: .65rem .8rem; border-radius: .5rem; margin-bottom: 1rem; font-size: .9rem; }
    .banner.paused { background: color-mix(in srgb, var(--paused) 18%, transparent); border: 1px solid color-mix(in srgb, var(--paused) 45%, transparent); }
    .banner.run-ok { background: color-mix(in srgb, var(--ok) 12%, transparent); border: 1px solid color-mix(in srgb, var(--ok) 40%, transparent); }
    .banner.run-fail { background: color-mix(in srgb, var(--fail) 12%, transparent); border: 1px solid color-mix(in srgb, var(--fail) 40%, transparent); }
    .banner.run-skip { background: color-mix(in srgb, var(--skip) 12%, transparent); border: 1px solid color-mix(in srgb, var(--skip) 40%, transparent); }
    .actions { display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch; gap: .3rem; height: 100%; box-sizing: border-box; }
    .table-wrap { width: 100%; overflow-x: auto; }
    /* height:1px lets row cells share full row height so Control can stretch with Config */
    table { width: 100%; height: 1px; border-collapse: collapse; table-layout: fixed; font-size: .9rem; }
    col.col-company { width: 12%; }
    col.col-status { width: 9%; }
    col.col-checked { width: 15%; }
    col.col-num { width: 6%; }
    col.col-config { width: 34%; }
    col.col-control { width: 12%; }
    th, td { text-align: left; padding: .55rem .45rem; border-bottom: 1px solid #e5e7eb; vertical-align: top; overflow: hidden; height: 100%; }
    th { font-size: .7rem; text-transform: uppercase; letter-spacing: .03em; color: #6b7280; line-height: 1.25; overflow-wrap: anywhere; height: auto; }
    td.col-checked { font-size: .8rem; overflow-wrap: anywhere; }
    td.col-config { overflow-wrap: anywhere; word-break: break-word; }
    td.col-control { overflow: hidden; vertical-align: top; }
    .badge { display: inline-block; padding: .1rem .45rem; border-radius: 999px; font-size: .75rem; font-weight: 600; color: #fff; max-width: 100%; }
    .badge.ok { background: var(--ok); }
    .badge.failed { background: var(--fail); }
    .badge.seeded { background: var(--seed); }
    .badge.skipped { background: var(--skip); }
    .badge.never { background: var(--never); }
    .badge.paused { background: var(--paused); }
    .err { margin-top: .35rem; color: var(--fail); font-size: .78rem; overflow-wrap: anywhere; word-break: break-word; max-height: 4.5em; overflow: auto; }
    .col-config .mode { display: block; overflow-wrap: anywhere; }
    .badge.skipped + .err, td:has(.badge.skipped) .err { color: var(--skip); }
    code { font-size: .8rem; overflow-wrap: anywhere; }
    a { color: inherit; }
    .btn { appearance: none; border: 1px solid #d1d5db; background: #f9fafb; color: inherit; border-radius: .4rem; padding: .3rem .55rem; font-size: .8rem; font-weight: 600; cursor: pointer; white-space: nowrap; box-sizing: border-box; }
    td.col-control .btn { width: 100%; }
    .btn.pause { border-color: color-mix(in srgb, var(--paused) 50%, #d1d5db); }
    .btn.resume { border-color: color-mix(in srgb, var(--ok) 50%, #d1d5db); }
    .btn.run { border-color: color-mix(in srgb, var(--seed) 55%, #d1d5db); }
    .btn.global { padding: .45rem .75rem; }
    tr.row-paused { opacity: .72; }
    tr.is-hidden { display: none; }
    form.inline { display: inline-flex; margin: 0; }
    @media (prefers-color-scheme: dark) {
      .chip { background: #1f2937; border-color: #374151; }
      .chip.active { background: #f3f4f6; color: #111827; border-color: #f3f4f6; }
      .btn { background: #1f2937; border-color: #374151; }
    }
  </style>
</head>
<body>
  <h1>Redeye status</h1>
  <div class="meta">
    Cron: <code>${escapeHtml(status.cron)}</code><br />
    Last run: <strong>${status.lastRunAt ? escapeHtml(formatPacificTime(status.lastRunAt)) : "never"}</strong>
    ${
      status.lastRun
        ? ` · batch ${status.lastRun.companies}/${status.companies.length} · new ${status.lastRun.newJobs} · failures ${status.lastRun.failures} · skipped ${status.lastRun.skipped ?? 0}`
        : ""
    }
    <br />Cron polls ${COMPANIES_PER_BATCH} companies per tick (rotation) so Free-plan subrequest limits don't abort runs.
  </div>
  ${
    status.globalPaused
      ? `<div class="banner paused"><strong>Global pause is on</strong> — cron and <strong>Run batch</strong> skip. Per-company <strong>Run</strong> still polls that board. Last-check rows are preserved.</div>`
      : ""
  }
  ${flashBanner}
  <div class="summary" id="summary-chips" role="group" aria-label="Status filters">
    <button type="button" class="chip active" data-filter="all">All <span class="n">${counts.total}</span></button>
    <button type="button" class="chip attention" data-filter="attention">Needs attention <span class="n">${counts.attention}</span></button>
    <button type="button" class="chip failed" data-filter="failed">Failed <span class="n">${counts.failed}</span></button>
    <button type="button" class="chip skipped" data-filter="skipped">Skipped <span class="n">${counts.skipped}</span></button>
    <button type="button" class="chip paused" data-filter="paused">Paused <span class="n">${counts.paused}</span></button>
    <button type="button" class="chip ok" data-filter="healthy">Healthy <span class="n">${counts.healthy}</span></button>
    <button type="button" class="chip" data-filter="seeded">Seeded <span class="n">${counts.seeded}</span></button>
    <button type="button" class="chip" data-filter="never">Never <span class="n">${counts.never}</span></button>
  </div>
  ${
    counts.attention
      ? `<div class="attention-box" id="attention-box">
    <h2>Needs attention (${counts.attention})</h2>
    <ul>${attentionList}</ul>
  </div>`
      : `<div class="attention-box" id="attention-box" hidden>
    <h2>Needs attention</h2>
    <ul></ul>
  </div>`
  }
  <div class="controls">
    ${runAllBtn}
    ${globalBtn}
    <a class="btn" href="${escapeAttr(statusHref)}">Refresh</a>
  </div>
  <div class="toolbar">
    <label for="q">Search</label>
    <input id="q" type="search" placeholder="Company name or id" autocomplete="off" />
    <label for="sort">Sort</label>
    <select id="sort">
      <option value="attention" selected>Attention first</option>
      <option value="name">Name A–Z</option>
      <option value="checked">Last check (newest)</option>
      <option value="matched">Matched (high→low)</option>
    </select>
    <span class="shown" id="shown-count"></span>
  </div>
  <div class="table-wrap">
  <table>
    <colgroup>
      <col class="col-company" />
      <col class="col-status" />
      <col class="col-checked" />
      <col class="col-num" />
      <col class="col-num" />
      <col class="col-num" />
      <col class="col-config" />
      <col class="col-control" />
    </colgroup>
    <thead>
      <tr>
        <th>Company</th>
        <th>Status</th>
        <th>Last check</th>
        <th title="Matched">Match</th>
        <th title="Notified">Notify</th>
        <th title="Bootstrapped">Boot</th>
        <th>Config</th>
        <th>Control</th>
      </tr>
    </thead>
    <tbody id="company-rows">
      ${rows || `<tr><td colspan="8">No companies configured</td></tr>`}
    </tbody>
  </table>
  </div>
  <script>
    (function () {
      const tbody = document.getElementById("company-rows");
      const q = document.getElementById("q");
      const sort = document.getElementById("sort");
      const shown = document.getElementById("shown-count");
      const chips = document.getElementById("summary-chips");
      const attentionBox = document.getElementById("attention-box");
      if (!tbody || !q || !sort || !chips) return;

      let filter = "all";
      const rows = Array.from(tbody.querySelectorAll("tr[data-id]"));

      function apply() {
        const query = (q.value || "").trim().toLowerCase();
        let visible = 0;
        for (const row of rows) {
          const status = row.dataset.status || "";
          const paused = row.dataset.paused === "1";
          const attention = row.dataset.attention === "1";
          const healthy = row.dataset.healthy === "1";
          const name = row.dataset.name || "";
          const id = row.dataset.id || "";
          let ok = true;
          if (filter === "attention") ok = attention;
          else if (filter === "failed") ok = status === "failed";
          else if (filter === "skipped") ok = status === "skipped";
          else if (filter === "paused") ok = paused;
          else if (filter === "healthy") ok = healthy;
          else if (filter === "seeded") ok = status === "seeded";
          else if (filter === "never") ok = status === "never";
          if (ok && query) ok = name.includes(query) || id.includes(query);
          row.classList.toggle("is-hidden", !ok);
          if (ok) visible += 1;
        }
        shown.textContent = "Showing " + visible + " / " + rows.length;
        if (attentionBox) {
          attentionBox.hidden = filter !== "all" && filter !== "attention";
        }
      }

      function resort() {
        const mode = sort.value;
        const ranked = rows.slice().sort(function (a, b) {
          if (mode === "name") {
            return (a.dataset.name || "").localeCompare(b.dataset.name || "");
          }
          if (mode === "matched") {
            const am = Number(a.dataset.matched || 0);
            const bm = Number(b.dataset.matched || 0);
            return bm - am || (a.dataset.name || "").localeCompare(b.dataset.name || "");
          }
          if (mode === "checked") {
            const ac = a.dataset.checked || "";
            const bc = b.dataset.checked || "";
            if (!ac && !bc) return (a.dataset.name || "").localeCompare(b.dataset.name || "");
            if (!ac) return 1;
            if (!bc) return -1;
            return bc.localeCompare(ac) || (a.dataset.name || "").localeCompare(b.dataset.name || "");
          }
          // attention first
          const ar = Number(a.dataset.rank || 99);
          const br = Number(b.dataset.rank || 99);
          return ar - br || (a.dataset.name || "").localeCompare(b.dataset.name || "");
        });
        for (const row of ranked) tbody.appendChild(row);
        apply();
      }

      chips.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-filter]");
        if (!btn) return;
        filter = btn.getAttribute("data-filter") || "all";
        for (const c of chips.querySelectorAll(".chip")) c.classList.remove("active");
        btn.classList.add("active");
        apply();
      });
      q.addEventListener("input", apply);
      sort.addEventListener("change", resort);
      apply();
    })();
  </script>
</body>
</html>`;
}

function needsAttention(c: CompanyRunStatus): boolean {
  return (
    c.status === "failed" ||
    c.status === "skipped" ||
    c.status === "never" ||
    !c.bootstrapped
  );
}

function isHealthy(c: CompanyRunStatus): boolean {
  return (
    !c.paused &&
    c.bootstrapped &&
    (c.status === "ok" || c.status === "seeded")
  );
}

function statusSortRank(c: CompanyRunStatus): number {
  // Lower = higher priority in "attention first"
  if (c.status === "failed") return 0;
  if (c.status === "skipped") return 1;
  if (c.status === "never") return 2;
  if (!c.bootstrapped) return 3;
  if (c.paused) return 4;
  if (c.status === "seeded") return 5;
  return 6;
}

function compareCompaniesForStatus(
  a: CompanyRunStatus,
  b: CompanyRunStatus,
): number {
  return (
    statusSortRank(a) - statusSortRank(b) ||
    a.name.localeCompare(b.name)
  );
}

function summarizeCompanies(companies: CompanyRunStatus[]): {
  total: number;
  ok: number;
  seeded: number;
  failed: number;
  skipped: number;
  never: number;
  paused: number;
  attention: number;
  healthy: number;
} {
  const counts = {
    total: companies.length,
    ok: 0,
    seeded: 0,
    failed: 0,
    skipped: 0,
    never: 0,
    paused: 0,
    attention: 0,
    healthy: 0,
  };
  for (const c of companies) {
    if (c.status === "ok") counts.ok += 1;
    else if (c.status === "seeded") counts.seeded += 1;
    else if (c.status === "failed") counts.failed += 1;
    else if (c.status === "skipped") counts.skipped += 1;
    else if (c.status === "never") counts.never += 1;
    if (c.paused) counts.paused += 1;
    if (needsAttention(c)) counts.attention += 1;
    if (isHealthy(c)) counts.healthy += 1;
  }
  return counts;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function renderFlashBanner(
  flash: StatusFlash | undefined,
  status: TrackerStatus,
): string {
  if (!flash) return "";
  const companyName = flash.companyId
    ? (status.companies.find((c) => c.companyId === flash.companyId)?.name ??
      flash.companyId)
    : undefined;
  const tone =
    flash.runStatus === "failed" || flash.failures > 0
      ? "run-fail"
      : flash.runStatus === "skipped"
        ? "run-skip"
        : "run-ok";
  const who =
    flash.ran === "company"
      ? `<strong>${escapeHtml(companyName ?? "company")}</strong>`
      : flash.ran === "batch"
        ? "<strong>Next batch</strong>"
        : "<strong>All companies</strong>";
  const err = flash.error
    ? `<br /><span class="attn-err">${escapeHtml(flash.error)}</span>`
    : "";
  return `<div class="banner ${tone}">
    Run finished — ${who}
    · status <span class="badge ${escapeAttr(flash.runStatus)}">${escapeHtml(flash.runStatus)}</span>
    · matched ${flash.matched}
    · notified ${flash.notified}
    ${flash.ran !== "company" ? `· failures ${flash.failures} · skipped ${flash.skipped}` : ""}
    ${err}
  </div>`;
}

function runForm(
  action: string,
  opts: {
    companyId?: string;
    label: string;
    className: string;
    title?: string;
  },
): string {
  const companyField = opts.companyId
    ? `<input type="hidden" name="companyId" value="${escapeAttr(opts.companyId)}" />`
    : "";
  const title = opts.title
    ? ` title="${escapeAttr(opts.title)}"`
    : "";
  return `<form class="inline" method="post" action="${escapeAttr(action)}">
    ${companyField}
    <button class="${escapeAttr(opts.className)}" type="submit"${title}>${escapeHtml(opts.label)}</button>
  </form>`;
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

/** Display ISO timestamps in America/Los_Angeles (HTML status page only). */
function formatPacificTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
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
