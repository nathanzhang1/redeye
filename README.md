# Redeye — New Grad SWE Career Page Tracker

Cloudflare Worker that polls big-tech career pages every **10 minutes**, detects **new grad SWE** roles, dedupes them in **KV**, and notifies you on **Discord**.

## Setup

### 1. Install

```bash
npm install
```

### 2. Create KV namespace

```bash
npx wrangler kv namespace create SEEN_JOBS
```

Copy the returned `id` into [`wrangler.jsonc`](wrangler.jsonc) for both `id` and `preview_id` under the `SEEN_JOBS` binding.

### 3. Secrets

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
npx wrangler secret put RUN_SECRET
```

- **DISCORD_WEBHOOK_URL** — Discord channel webhook URL (Server Settings → Integrations → Webhooks).
- **RUN_SECRET** — random string used as `Bearer` token for manual `POST /run`.

For local / remote-dev, create `.dev.vars` (gitignored):

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
RUN_SECRET=local-dev-secret
```

### 4. Browser Run

Meta (and other JS-heavy boards) use the **BROWSER** binding in `wrangler.jsonc`. Enable Browser Run / Browser Rendering on your Cloudflare account if prompted on first use.

Local testing **must** use remote mode (already set in `npm run dev`):

```bash
npm run dev
```

### 5. Deploy

```bash
npm run deploy
```

Cron `*/10 * * * *` runs on UTC in production.

## Companies

Configured in [`src/companies.ts`](src/companies.ts).

**Wired so far:**

- **Amazon** — Jobs for Grads (US + Software Development + PMT); public `search.json` + `all_jobs` (`/en/jobs/<id>/…`)
- **Databricks** — University Recruiting / US page; Greenhouse JSON + `all_jobs` + title must include `New Grad`
- **Uber** — University / Engineering / US page; Oracle HCM JSON + `all_jobs` + title must include `Graduate`
- **Netflix** — University Recruiting + Engineering/PM + onsite + UCAN; Eightfold JSON + `all_jobs` (`/careers/job/<pid>`)
- **Stripe** — US + Full time careers index; `__NEXT_DATA__` + title must include `New Grad`
- **Coinbase** — Engineering depts + CA/NY/NC non-remote; Greenhouse departments JSON + title `New Grad` / `Early` / `Graduate`
- **Figma** — Early Career dept only; Greenhouse departments JSON + exclude title `PhD`
- **Notion** — Early Career + San Francisco; Ashby JSON + title `New Grad` / `Early Career`
- **Datadog** — Early Career job type + USA; Greenhouse JSON + title `Engineer`
- **Bloomberg** — Early Careers + NY/SF + Data/Eng/Product Avature search; `html` + `all_jobs`
- **Robinhood** — Early Talent and Internships bucket; Greenhouse JSON + new-grad/SWE keywords; exclude `Intern`/`Internship`
- **Shopify** — careers XML feed (Engineering & Data page); new-grad/SWE keywords; exclude `Intern`/`Internship`
- **Ramp** — Emerging Talent - SWE Ashby team; new-grad/SWE keywords; exclude `Intern`/`Internship`
- **Cloudflare** — title `Engineer` (mirrors careers search); Greenhouse JSON + new-grad/SWE keywords
- **Lyft** — Early Talent dept; Greenhouse departments JSON + new-grad/SWE keywords; exclude `Intern`/`Internship`
- **Adobe** — Phenom widgets `University Graduate`/`University Intern`; title `Software`; exclude `Intern`/`Internship`
- **Dropbox** — Engineering + Remote US (All locations); Greenhouse JSON + new-grad/SWE keywords
- **LinkedIn** — guest job search (Entry + Engineering + Full-time at LinkedIn cos); new-grad/SWE keywords; exclude `Intern`
- **Snap** — Engineering + Regular + US hubs via `/api/jobs`; new-grad/SWE keywords; exclude `Intern`
- **Meta** — newest-first FT search (MPK/NYC/Bellevue); `browser` + `all_jobs` + title must include `University Grad`
- **Apple** — Fresh Graduates (General) + US SWE/ML teams; `html` + `all_jobs` (`/details/<id>/<slug>`)
- **Google** — Early + US + Bachelor's + Campus query; `html` + `all_jobs` + title must include `Campus`
- **NVIDIA** — new college grad engineering (US); `browser` + `all_jobs` + title must include `New College Grad 2027`

Add more companies the same way, then redeploy / restart `npm run dev`.

| Field | Meaning |
|-------|---------|
| `fetchMode: "html"` | Plain `fetch` (default) |
| `fetchMode: "browser"` | Browser Run rendered HTML |
| `matchMode: "keywords"` | Require new-grad + SWE keywords (default) |
| `matchMode: "all_jobs"` | Any job detail link matching `jobPathPattern` |

**First successful poll** for a company seeds current matches into KV **without** Discord alerts. Later polls only notify on new job ids. Zero open roles is fine (bootstrap with an empty set).

**Browser Run budget:** Workers Free includes ~10 browser-minutes/day. Redeye runs at most **one** `browser` company per cron tick, at most every **2 hours**, and cools down after 429s. HTML/JSON companies still poll every 10 minutes. Prefer JSON APIs over `browser` when possible.

## Status monitor

Each poll writes per-company results to KV. View them at `/status`:

```bash
# JSON
curl "https://redeye.redeye-watch.workers.dev/status?token=redeye"

# HTML (also works if you open this URL in a browser)
open "https://redeye.redeye-watch.workers.dev/status?token=redeye&format=html"
```

Auth: `Authorization: Bearer <RUN_SECRET>` **or** `?token=<RUN_SECRET>`.

Shows last run time, cron schedule, and per company: status, last check, matched jobs, notified count, bootstrap flag, errors, and a link to the career page.

## Manual run / health

```bash
curl https://redeye.redeye-watch.workers.dev/health

curl -X POST https://redeye.redeye-watch.workers.dev/run \
  -H "Authorization: Bearer <RUN_SECRET>"
```

## KV keys

| Key | Meaning |
|-----|---------|
| `bootstrap:{companyId}` | `done` after first seed |
| `job:{companyId}:{jobId}` | Already seen / notified |
| `fail:{companyId}` | Last scrape-failure Discord alert (6h cooldown) |
| `status:company:{companyId}` | Last poll result for that company |
| `status:last_run` | Aggregate last poll summary |
