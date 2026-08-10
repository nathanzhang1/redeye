var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/browser.ts
async function fetchRenderedHtml(browser, url) {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: {
      waitUntil: "networkidle2",
      timeout: 45e3
    }
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Browser Run failed with ${response.status}: ${detail}`);
  }
  const data = await response.json();
  if (!data.success || typeof data.result !== "string") {
    throw new Error("Browser Run returned unsuccessful response");
  }
  if (data.result.length < 50) {
    throw new Error("Browser Run returned empty or too-short HTML");
  }
  return data.result;
}
__name(fetchRenderedHtml, "fetchRenderedHtml");

// src/companies.ts
var DEFAULT_KEYWORDS = [
  "new grad",
  "university",
  "early career",
  "grad",
  "campus",
  "university grad",
  "new graduate"
];
var DEFAULT_ROLE_KEYWORDS = [
  "software engineer",
  "swe",
  "software developer",
  "software engineering"
];
var DEFAULT_JOB_PATH_PATTERN = String.raw`/jobs/\d+`;
var COMPANIES = [
  {
    id: "meta",
    name: "Meta",
    url: "https://www.metacareers.com/jobsearch/?sort_by_new=true&teams[0]=Product%20Management&teams[1]=Data%20%26%20Analytics&teams[2]=Software%20Engineering&teams[3]=University%20Grad%20-%20Engineering%2C%20Tech%20%26%20Design&offices[0]=Menlo%20Park%2C%20CA&offices[1]=New%20York%2C%20NY&offices[2]=Bellevue%2C%20WA&roles[0]=Full%20time%20employment",
    fetchMode: "browser",
    matchMode: "all_jobs",
    // Meta detail pages: /profile/job_details/<id> (older: /jobs/<id>)
    jobPathPattern: String.raw`/(?:profile/job_details|jobs)/\d+`,
    titleIncludes: ["University Grad"]
  },
  {
    id: "apple",
    name: "Apple",
    // Pre-filtered: Fresh Graduates (General) + US + SWE/ML teams
    url: "https://jobs.apple.com/en-us/search?search=Full+Time+Opportunity+for+Fresh+Graduates+%28General%29&sort=relevance&location=united-states-USA&team=machine-learning-infrastructure-MLAI-MLI+deep-learning-and-reinforcement-learning-MLAI-DLRL+natural-language-processing-and-speech-technologies-MLAI-NLP+computer-vision-MLAI-CV+applied-research-MLAI-AR+apps-and-frameworks-SFTWR-AF+cloud-and-infrastructure-SFTWR-CLD+core-operating-systems-SFTWR-COS+devops-and-site-reliability-SFTWR-DSR+engineering-project-management-SFTWR-EPM+information-systems-and-technology-SFTWR-ISTECH+machine-learning-and-ai-SFTWR-MCHLN+security-and-privacy-SFTWR-SEC+software-quality-automation-and-tools-SFTWR-SQAT+wireless-software-SFTWR-WSFT",
    fetchMode: "html",
    matchMode: "all_jobs",
    // Real roles: /en-us/details/<id>/<slug>
    // Exclude .../locationPicker "Where we're hiring" links.
    jobPathPattern: String.raw`/details/[0-9-]+/[^/]+$`
  },
  {
    id: "google",
    name: "Google",
    url: "https://www.google.com/about/careers/applications/jobs/results?target_level=EARLY&location=United%20States&degree=BACHELORS&employment_type=FULL_TIME&sort_by=date&q=Campus",
    fetchMode: "html",
    matchMode: "all_jobs",
    // /jobs/results/<id>-software-engineer-early-career-campus
    jobPathPattern: String.raw`/jobs/results/\d+-`,
    titleIncludes: ["Campus"]
  },
  {
    id: "nvidia",
    name: "NVIDIA",
    url: "https://jobs.nvidia.com/careers?start=0&location=united+states&pid=893396905668&sort_by=timestamp&filter_include_remote=1&filter_include_relocation=0&filter_job_category=engineering&filter_work_location_option=office&filter_job_type=new+college+graduate&filter_time_type=full+time",
    fetchMode: "browser",
    matchMode: "all_jobs",
    // Eightfold: /careers/job/<pid>
    jobPathPattern: String.raw`/careers/job/\d+`,
    titleIncludes: ["New College Grad 2027"]
  }
];

// src/discord.ts
var MAX_EMBEDS = 10;
async function notifyNewJobs(webhookUrl, companyName, jobs, mentionUserId) {
  if (jobs.length === 0) return;
  if (mentionUserId) {
    await postWebhook(webhookUrl, {
      content: `<@${mentionUserId}> **New grad SWE \u2014 ${companyName}** (${jobs.length} new)`,
      allowed_mentions: { users: [mentionUserId] }
    });
  }
  for (let i = 0; i < jobs.length; i += MAX_EMBEDS) {
    const chunk = jobs.slice(i, i + MAX_EMBEDS);
    await postWebhook(webhookUrl, {
      content: mentionUserId ? void 0 : `**New grad SWE roles \u2014 ${companyName}**`,
      embeds: chunk.map((job) => ({
        title: truncate(job.title, 256),
        url: job.url,
        description: "New grad SWE",
        color: 14753096,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        footer: { text: companyName }
      })),
      allowed_mentions: { parse: [] }
    });
  }
}
__name(notifyNewJobs, "notifyNewJobs");
async function notifyScrapeFailure(webhookUrl, companyName, errorMessage, mentionUserId) {
  if (mentionUserId) {
    await postWebhook(webhookUrl, {
      content: `<@${mentionUserId}> scrape failed for **${companyName}**`,
      allowed_mentions: { users: [mentionUserId] }
    });
  }
  await postWebhook(webhookUrl, {
    embeds: [
      {
        title: `Scrape failed \u2014 ${companyName}`,
        description: truncate(errorMessage, 1e3),
        color: 16096779,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ],
    allowed_mentions: { parse: [] }
  });
}
__name(notifyScrapeFailure, "notifyScrapeFailure");
async function postWebhook(webhookUrl, body) {
  const cleaned = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== void 0) cleaned[key] = value;
  }
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cleaned)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discord webhook failed (${response.status}): ${detail}`);
  }
}
__name(postWebhook, "postWebhook");
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}\u2026`;
}
__name(truncate, "truncate");

// src/parse.ts
var USER_AGENT = "Mozilla/5.0 (compatible; RedeyeJobTracker/1.0; +https://github.com/redeye)";
var FETCH_TIMEOUT_MS = 2e4;
var MAX_HTML_BYTES = 2e6;
async function fetchCareerPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error(`Empty body from ${url}`);
  }
  const chunks = [];
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
    merged
  );
}
__name(fetchCareerPage, "fetchCareerPage");
async function extractJobs(company, html) {
  const base = new URL(company.url);
  const matchMode = company.matchMode ?? "keywords";
  const jobPathRe = new RegExp(
    company.jobPathPattern ?? DEFAULT_JOB_PATH_PATTERN,
    "i"
  );
  const keywords = (company.keywords ?? [...DEFAULT_KEYWORDS]).map(
    (k) => k.toLowerCase()
  );
  const roleKeywords = (company.roleKeywords ?? [
    ...DEFAULT_ROLE_KEYWORDS
  ]).map((k) => k.toLowerCase());
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const byUrl = /* @__PURE__ */ new Map();
  for (const match of anchors) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[2].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      continue;
    }
    let absolute;
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
      const ariaTitle = decodeHtmlEntities(aria).replace(/^learn more about\s+/i, "").replace(/\s+/g, " ").trim();
      if (ariaTitle && ariaTitle.length <= 300) {
        if (!title || /^learn more$/i.test(title) || title.length < ariaTitle.length) {
          title = ariaTitle;
        }
      }
    }
    if (!title || title.length > 300 || /^learn more$/i.test(title)) {
      const slugTitle = titleFromGoogleSlug(absolute.pathname);
      if (slugTitle) {
        title = slugTitle;
      } else {
        const idFromPath = absolute.pathname.match(
          /\/(?:profile\/job_details|jobs|careers\/job)\/(\d+)/i
        )?.[1] ?? absolute.pathname.match(/\/jobs\/results\/(\d+)/i)?.[1] ?? absolute.pathname.match(/\/details\/([0-9-]+)/i)?.[1];
        if (!idFromPath) continue;
        title = `Job ${idFromPath}`;
      }
    }
    if (matchMode === "all_jobs") {
      if (!jobPathRe.test(absolute.pathname)) continue;
    } else {
      const haystack = `${title} ${absolute.pathname} ${absolute.search}`.toLowerCase();
      if (!matchesAny(haystack, keywords) || !matchesAny(haystack, roleKeywords)) {
        continue;
      }
    }
    if (company.titleIncludes?.length) {
      const titleLower = title.toLowerCase();
      const ok = company.titleIncludes.some(
        (needle) => titleLower.includes(needle.toLowerCase())
      );
      if (!ok) continue;
    }
    const canonical = canonicalizeJobUrl(absolute);
    const id = await jobId(company.id, canonical);
    const existing = byUrl.get(canonical);
    if (!existing || existing.title.startsWith("Job ")) {
      byUrl.set(canonical, { id, title, url: canonical });
    }
  }
  return [...byUrl.values()];
}
__name(extractJobs, "extractJobs");
function matchesAny(haystack, needles) {
  return needles.some((n) => haystack.includes(n));
}
__name(matchesAny, "matchesAny");
function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ");
}
__name(stripTags, "stripTags");
function decodeHtmlEntities(text) {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(
    /&#(\d+);/g,
    (_, n) => String.fromCodePoint(Number.parseInt(n, 10))
  ).replace(
    /&#x([0-9a-f]+);/gi,
    (_, n) => String.fromCodePoint(Number.parseInt(n, 16))
  );
}
__name(decodeHtmlEntities, "decodeHtmlEntities");
function canonicalizeJobUrl(url) {
  const boardId = url.pathname.match(/\/(?:profile\/job_details|jobs(?:\/view)?|careers\/job)\/(\d{5,})/i)?.[1] ?? url.pathname.match(/\/jobs\/results\/(\d{5,})/i)?.[1] ?? url.pathname.match(/\/details\/([0-9-]+)/i)?.[1] ?? url.pathname.match(/\/job\/([A-Za-z0-9_-]{6,})/i)?.[1] ?? url.searchParams.get("gh_jid") ?? url.searchParams.get("jobId") ?? url.searchParams.get("job_id");
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
__name(canonicalizeJobUrl, "canonicalizeJobUrl");
async function jobId(companyId, canonicalUrl) {
  const data = new TextEncoder().encode(`${companyId}\0${canonicalUrl}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
__name(jobId, "jobId");
function titleFromGoogleSlug(pathname) {
  const m = pathname.match(/\/jobs\/results\/\d+-([a-z0-9-]+)/i);
  if (!m?.[1]) return null;
  const titled = m[1].split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return titled || null;
}
__name(titleFromGoogleSlug, "titleFromGoogleSlug");

// src/seen.ts
function jobKey(companyId, jobId2) {
  return `job:${companyId}:${jobId2}`;
}
__name(jobKey, "jobKey");
function bootstrapKey(companyId) {
  return `bootstrap:${companyId}`;
}
__name(bootstrapKey, "bootstrapKey");
function failKey(companyId) {
  return `fail:${companyId}`;
}
__name(failKey, "failKey");
async function isBootstrapped(kv, companyId) {
  const value = await kv.get(bootstrapKey(companyId));
  return value === "done";
}
__name(isBootstrapped, "isBootstrapped");
async function markBootstrapped(kv, companyId) {
  await kv.put(bootstrapKey(companyId), "done");
}
__name(markBootstrapped, "markBootstrapped");
async function hasSeenJob(kv, companyId, jobId2) {
  const value = await kv.get(jobKey(companyId, jobId2));
  return value !== null;
}
__name(hasSeenJob, "hasSeenJob");
async function markJobSeen(kv, companyId, job) {
  const record = {
    title: job.title,
    url: job.url,
    firstSeenAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kv.put(jobKey(companyId, job.id), JSON.stringify(record));
}
__name(markJobSeen, "markJobSeen");
async function seedJobs(kv, companyId, jobs) {
  await Promise.all(jobs.map((job) => markJobSeen(kv, companyId, job)));
  await markBootstrapped(kv, companyId);
}
__name(seedJobs, "seedJobs");
var FAIL_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1e3;
async function shouldAlertFailure(kv, companyId) {
  const last = await kv.get(failKey(companyId));
  if (last) {
    const elapsed = Date.now() - Date.parse(last);
    if (!Number.isNaN(elapsed) && elapsed < FAIL_ALERT_COOLDOWN_MS) {
      return false;
    }
  }
  await kv.put(failKey(companyId), (/* @__PURE__ */ new Date()).toISOString());
  return true;
}
__name(shouldAlertFailure, "shouldAlertFailure");

// src/status.ts
function companyStatusKey(companyId) {
  return `status:company:${companyId}`;
}
__name(companyStatusKey, "companyStatusKey");
var LAST_RUN_KEY = "status:last_run";
async function saveRunStatus(kv, company, detail) {
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
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await kv.put(companyStatusKey(company.id), JSON.stringify(record));
}
__name(saveRunStatus, "saveRunStatus");
async function saveLastRun(kv, summary) {
  const record = {
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    companies: summary.companies,
    newJobs: summary.newJobs,
    seeded: summary.seeded,
    failures: summary.failures,
    details: summary.details
  };
  await kv.put(LAST_RUN_KEY, JSON.stringify(record));
}
__name(saveLastRun, "saveLastRun");
async function getTrackerStatus(kv) {
  const lastRunRaw = await kv.get(LAST_RUN_KEY);
  const lastRun = lastRunRaw ? JSON.parse(lastRunRaw) : null;
  const companies = await Promise.all(
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
          bootstrapped
        };
      }
      const saved = JSON.parse(raw);
      return { ...saved, bootstrapped };
    })
  );
  return {
    cron: "*/10 * * * *",
    lastRunAt: lastRun?.checkedAt ?? null,
    lastRun,
    companies
  };
}
__name(getTrackerStatus, "getTrackerStatus");
function renderStatusHtml(status) {
  const rows = status.companies.map((c) => {
    const checked = c.checkedAt ? escapeHtml(c.checkedAt) : "<em>never</em>";
    const err = c.error ? `<div class="err">${escapeHtml(c.error)}</div>` : "";
    return `<tr>
        <td><strong>${escapeHtml(c.name)}</strong><br><code>${escapeHtml(c.companyId)}</code></td>
        <td><span class="badge ${c.status}">${c.status}</span></td>
        <td>${checked}</td>
        <td>${c.matched}</td>
        <td>${c.notified}</td>
        <td>${c.bootstrapped ? "yes" : "no"}</td>
        <td>${escapeHtml(c.fetchMode)} / ${escapeHtml(c.matchMode)}${err}<br><a href="${escapeAttr(c.url)}" target="_blank" rel="noopener">open page</a></td>
      </tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redeye status</title>
  <style>
    :root { color-scheme: light dark; --ok:#16a34a; --fail:#dc2626; --seed:#2563eb; --never:#6b7280; }
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
    .badge.never { background: var(--never); }
    .err { margin-top: .35rem; color: var(--fail); font-size: .8rem; word-break: break-word; }
    code { font-size: .8rem; }
    a { color: inherit; }
  </style>
</head>
<body>
  <h1>Redeye status</h1>
  <div class="meta">
    Cron: <code>${escapeHtml(status.cron)}</code><br />
    Last run: <strong>${status.lastRunAt ? escapeHtml(status.lastRunAt) : "never"}</strong>
    ${status.lastRun ? ` \xB7 companies ${status.lastRun.companies} \xB7 new ${status.lastRun.newJobs} \xB7 failures ${status.lastRun.failures}` : ""}
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
__name(renderStatusHtml, "renderStatusHtml");
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escapeHtml, "escapeHtml");
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
__name(escapeAttr, "escapeAttr");

// src/check.ts
async function checkAll(env) {
  const summary = {
    companies: COMPANIES.length,
    newJobs: 0,
    seeded: 0,
    failures: 0,
    details: []
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
__name(checkAll, "checkAll");
async function checkCompany(env, company) {
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
          seeded: jobs.length
        })
      );
      return {
        companyId: company.id,
        status: "seeded",
        matched: jobs.length,
        notified: 0
      };
    }
    const fresh = [];
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
        env.DISCORD_USER_ID
      );
    }
    console.log(
      JSON.stringify({
        event: "company_ok",
        companyId: company.id,
        matched: jobs.length,
        notified: fresh.length
      })
    );
    return {
      companyId: company.id,
      status: "ok",
      matched: jobs.length,
      notified: fresh.length
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        event: "company_failed",
        companyId: company.id,
        error: message
      })
    );
    if (env.DISCORD_WEBHOOK_URL) {
      const alert = await shouldAlertFailure(env.SEEN_JOBS, company.id);
      if (alert) {
        try {
          await notifyScrapeFailure(
            env.DISCORD_WEBHOOK_URL,
            company.name,
            message,
            env.DISCORD_USER_ID
          );
        } catch (notifyError) {
          console.log(
            JSON.stringify({
              event: "failure_notify_failed",
              companyId: company.id,
              error: notifyError instanceof Error ? notifyError.message : String(notifyError)
            })
          );
        }
      }
    }
    return {
      companyId: company.id,
      status: "failed",
      matched: 0,
      notified: 0,
      error: message
    };
  }
}
__name(checkCompany, "checkCompany");
async function loadPage(env, company) {
  if ((company.fetchMode ?? "html") === "browser") {
    if (!env.BROWSER) {
      throw new Error(
        "BROWSER binding missing \u2014 add browser.binding in wrangler.jsonc"
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
__name(loadPage, "loadPage");

// src/index.ts
var index_default = {
  async scheduled(_controller, env, _ctx) {
    await checkAll(env);
  },
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const status = await getTrackerStatus(env.SEEN_JOBS);
      const wantsHtml = url.searchParams.get("format") === "html" || (request.headers.get("Accept") ?? "").includes("text/html");
      if (wantsHtml) {
        return new Response(renderStatusHtml(status), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }
      return Response.json(status, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    if (request.method === "GET" && url.pathname === "/debug/meta-count") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const meta = COMPANIES.find((c) => c.id === "meta");
      if (!meta) {
        return Response.json({ error: "meta not configured" }, { status: 404 });
      }
      const pagesToFetch = Number(url.searchParams.get("pages") ?? "2");
      const pageCount = Number.isFinite(pagesToFetch) ? Math.min(Math.max(pagesToFetch, 1), 3) : 2;
      const pages = [];
      const allIds = /* @__PURE__ */ new Set();
      const ugIds = /* @__PURE__ */ new Set();
      for (let page = 1; page <= pageCount; page++) {
        const pageUrl = new URL(meta.url);
        if (page > 1) pageUrl.searchParams.set("page", String(page));
        const html = await fetchRenderedHtml(env.BROWSER, pageUrl.toString());
        const allOnPage = await extractJobs(
          { ...meta, titleIncludes: void 0 },
          html
        );
        const ugOnPage = await extractJobs(meta, html);
        for (const job of allOnPage) allIds.add(job.id);
        for (const job of ugOnPage) ugIds.add(job.id);
        const jobPathHits = [
          ...html.matchAll(/\/(?:profile\/job_details|jobs)\/(\d+)/gi)
        ].map((m) => m[1]);
        const hrefSamples = [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]).filter((h) => /job_details|\/jobs\//i.test(h)).slice(0, 20);
        pages.push({
          page,
          url: pageUrl.toString(),
          htmlLength: html.length,
          jobsPathIdsInHtml: new Set(jobPathHits).size,
          hasNoResultsCopy: /no results|0 jobs|didn't find/i.test(html),
          mentionsUniversityGrad: /university grad/i.test(html),
          hrefSamples,
          allJobs: allOnPage.length,
          universityGrad: ugOnPage.length,
          sampleTitles: allOnPage.map((j) => j.title).slice(0, 15),
          ugTitles: ugOnPage.map((j) => j.title).slice(0, 15)
        });
      }
      return Response.json({
        note: "Counts what Browser Run sees per page (same path as the tracker). Meta may paginate beyond this.",
        pagesFetched: pageCount,
        uniqueAllJobsAcrossPages: allIds.size,
        uniqueUniversityGradAcrossPages: ugIds.size,
        pages
      });
    }
    if (request.method === "POST" && url.pathname === "/run") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const summary = await checkAll(env);
      return Response.json(summary);
    }
    if (request.method === "POST" && url.pathname === "/test-notify") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env.DISCORD_WEBHOOK_URL) {
        return new Response("DISCORD_WEBHOOK_URL is not set", { status: 500 });
      }
      const mentionUserId = env.DISCORD_USER_ID;
      await notifyNewJobs(
        env.DISCORD_WEBHOOK_URL,
        "Meta (test \u2014 ignore)",
        [
          {
            id: "test",
            title: "Software Engineer, University Grad (TEST)",
            url: "https://www.metacareers.com/jobs/000000000000000"
          }
        ],
        mentionUserId
      );
      return Response.json({
        ok: true,
        sent: "test notification",
        mentionUserId: mentionUserId || null,
        expectedContent: mentionUserId ? `<@${mentionUserId}> **New grad SWE \u2014 Meta (test \u2014 ignore)** (1 new)` : null
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
function authorize(request, secret, url) {
  if (!secret) return false;
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    if (timingSafeEqualString(token, secret)) return true;
  }
  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeEqualString(queryToken, secret)) return true;
  return false;
}
__name(authorize, "authorize");
function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}
__name(timingSafeEqualString, "timingSafeEqualString");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
