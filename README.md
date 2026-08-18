# Redeye — New Grad SWE Career Page Tracker

Self-hostable Cloudflare Worker that polls big-tech career pages, finds **new-grad SWE** roles, dedupes them in **KV**, and DMs/posts them to **your Discord webhook**.

This repo is meant to be forked. You run your own Worker, your own KV, and your own webhook. Nothing in this project needs the original author’s Cloudflare account or Discord server.

## What you get

- Polls ~47 company boards on a **5-minute** cadence (rotating batches so a full pass is about **15 minutes**)
- First successful poll of each company **seeds** current jobs into KV with **no Discord spam**
- Later polls notify only when a **new job id** appears
- HTML status dashboard (pause / resume / run one company)
- Works on **Workers Free** if you stay within the limits below

## Prerequisites

- A [Cloudflare](https://dash.cloudflare.com/sign-up) account (Free is enough)
- [Node.js](https://nodejs.org/) 18+ and npm
- A Discord server you can add a webhook to
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) comes in as a project dependency (`npx wrangler`)

## 1. Get the code

```bash
git clone https://github.com/<you>/redeye.git
cd redeye
npm install
npx wrangler login
```

## 2. Name the Worker (optional)

Default name is `redeye` in `wrangler.jsonc`. If you change `"name"`, you **must** change the self service binding to the same name:

```jsonc
"name": "redeye",
"services": [
  { "binding": "SELF", "service": "redeye" }
]
```

Cron is CPU-capped at 10ms on Free. The Worker calls itself over `SELF` so the scrape runs as a normal HTTP request. If the names do not match, cron will not poll.

## 3. Create KV

```bash
npx wrangler kv namespace create SEEN_JOBS
```

Copy the printed `id` into **both** `id` and `preview_id` in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "SEEN_JOBS",
    "id": "PASTE_YOUR_NAMESPACE_ID",
    "preview_id": "PASTE_YOUR_NAMESPACE_ID"
  }
]
```

Do not reuse someone else’s namespace id. Job history and the status dashboard live there.

## 4. Discord webhook

1. Open your Discord server → **Settings → Integrations → Webhooks → New Webhook**
2. Pick a channel, copy the webhook URL
3. Store it as a **Worker secret** (never commit it):

```bash
npx wrangler secret put DISCORD_WEBHOOK_URL
```

Paste the `https://discord.com/api/webhooks/...` URL when prompted.

### Optional: @mention you on every new job

1. Discord: **Settings → Advanced → Developer Mode**
2. Right-click your user → **Copy User ID**
3. Save it as a secret (keeps it out of git):

```bash
npx wrangler secret put DISCORD_USER_ID
```

Skip this if you only want channel posts with no ping.

## 5. Auth secret for the dashboard and `/run`

Pick a long random string. This is the password for `/status` and manual polls.

```bash
openssl rand -hex 24
npx wrangler secret put RUN_SECRET
```

Paste the same value when prompted.

## 6. Local secrets (dev only)

`.dev.vars` is gitignored. Create it in the repo root:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your/webhook
RUN_SECRET=the-same-value-you-put-in-wrangler
# optional
DISCORD_USER_ID=your-numeric-discord-id
```

## 7. Browser Rendering (Meta)

Meta’s board is JS-only and uses the `BROWSER` binding already in `wrangler.jsonc`.

On first deploy, Cloudflare may ask you to enable **Browser Rendering / Browser Run** for the account. Accept it.

Workers Free includes a small daily browser budget (~10 minutes). Redeye runs **at most one** `browser` company per tick, at most every **60 minutes**, and backs off after 429s.

Local dev must use remote bindings (already in `npm run dev`):

```bash
npm run dev
```

## 8. Deploy

```bash
npm run deploy
```

Wrangler prints a URL like:

```
https://redeye.<your-subdomain>.workers.dev
```

Cron triggers can take a few minutes to start after the first deploy.

## 9. Confirm it works

Replace `YOUR_HOST` and `YOUR_RUN_SECRET`.

```bash
# Worker is up
curl https://YOUR_HOST/health

# Test Discord (sends a fake Meta listing — ignore it)
curl -X POST https://YOUR_HOST/test-notify \
  -H "Authorization: Bearer YOUR_RUN_SECRET"

# Status dashboard (HTML)
open "https://YOUR_HOST/status?token=YOUR_RUN_SECRET&format=html"

# One rotating batch now (same as a cron shard)
curl -X POST https://YOUR_HOST/run \
  -H "Authorization: Bearer YOUR_RUN_SECRET"
```

**First real polls do not Discord-notify.** They seed whatever is already on the board. You should see `seeded` then `ok` on `/status`. Alerts start on the **next** new job after that.

If Discord is silent after a seed, that is expected.

## Daily use

| URL | What it is |
|-----|------------|
| `GET /health` | Public liveness check |
| `GET /status?token=RUN_SECRET&format=html` | Dashboard: last tick, last polled, failures, pause/run |
| `POST /run` | Run the next rotating batch (Bearer or `?token=`) |
| `POST /run` + `companyId` | Poll one company |
| `POST /run?all=1` | Poll every company (can hit Free subrequest limits) |
| `POST /test-notify` | Fake Discord message |

Auth is `Authorization: Bearer RUN_SECRET` or `?token=RUN_SECRET`.

Do not share the dashboard URL. The token is a capability.

## How polling works (Free plan)

Cloudflare Free limits are tight. The schedule is built around them:

| Limit | Free | How Redeye stays under it |
|-------|------|---------------------------|
| Cron CPU | 10 ms | Cron only `POST`s `/run` via the `SELF` binding |
| External fetches | 50 / invocation | 20 companies per 5-minute window, split into **4 shards** |
| KV writes | 1000 / day (reset 00:00 UTC) | Quiet polls skip status rewrites; last-run only on new jobs |
| Browser time | ~10 min / day | One browser company / tick, 60-minute gap |

Four **independent** crons fire on `:00`, `:01`, `:02`, `:03` (and every 5 minutes after). Each cron polls ~5 companies. A hung career page cannot block the other shards.

If last-polled goes stale, check `/status` **Last tick** first. A fresh last-tick with old last-polled usually means a shard died mid-fetch, not that cron stopped.

## Customize companies

Edit [`src/companies.ts`](src/companies.ts), then `npm run deploy`.

| Field | Meaning |
|-------|---------|
| `id` | Stable KV key — **do not rename** after the first successful poll |
| `url` | Page or JSON API to fetch |
| `fetchMode: "html"` | Plain `fetch` (default) |
| `fetchMode: "browser"` | Browser Rendering (JS-heavy boards) |
| `matchMode: "keywords"` | Title/URL must look like new-grad + SWE (default) |
| `matchMode: "all_jobs"` | Every listing on an already-filtered URL |
| `titleIncludes` | Title must match **at least one** (OR) |
| `titleIncludesAll` | Title must match **every** entry (AND) |
| `titleExcludes` | Drop intern / PhD / etc. |

Prefer official JSON APIs over `browser` whenever you can.

### Wired so far

- **Amazon** — Jobs for Grads (US + Software Development + PMT); public `search.json` + `all_jobs`
- **Databricks** — University Recruiting / US; Greenhouse JSON + `all_jobs` + title `New Grad`
- **Uber** — University / Engineering / US; Oracle HCM JSON + `all_jobs` + title `Graduate`
- **Netflix** — University Recruiting + Engineering/PM + UCAN; Eightfold JSON + `all_jobs`
- **Stripe** — US + Full time; `__NEXT_DATA__` + title `New Grad`
- **Coinbase** — Engineering + CA/NY/NC; Greenhouse + `New Grad` / `Early` / `Graduate`
- **Figma** — Early Career; Greenhouse + exclude `PhD`
- **Notion** — Early Career + SF; Ashby + `New Grad` / `Early Career`
- **Datadog** — Early Career + USA; Greenhouse + title `Engineer`
- **Bloomberg** — Early Careers + NY/SF; Avature + `all_jobs`
- **Robinhood** — Early Talent; Greenhouse + new-grad/SWE keywords
- **Shopify** — careers XML; new-grad/SWE keywords
- **Ramp** — Emerging Talent SWE; Ashby
- **Cloudflare** — Greenhouse + title `Engineer`
- **Lyft** — Early Talent; Greenhouse
- **Adobe** — Phenom University Graduate; title `Software`
- **Dropbox** — Engineering + Remote US; Greenhouse
- **LinkedIn** — guest job search; new-grad/SWE keywords
- **Snap** — `/api/jobs`; new-grad/SWE keywords
- **Airbnb** — Engineering + US; Greenhouse
- **DoorDash** — Engineering; title `Entry-Level`
- **Spotify** — Early Career Program; `all_jobs`
- **Snowflake** — GenSWE landing page; `all_jobs`
- **GitHub** — Engineering + US; Jibe
- **Asana** — Early Career; title `Engineer`
- **DocuSign** — University / New Grad; title `Engineer`
- **Pinterest** — University Engineering; Greenhouse
- **OpenAI** — Ashby GraphQL; new-grad/SWE keywords
- **Box** — Engineering + North America; Greenhouse
- **Two Sigma** — Engineering + Early Careers; `all_jobs`
- **Twitch** — title must include `Software Engineer` and `I`
- **MongoDB** — Early Talent New Grad; Greenhouse
- **PayPal** — US + Software Engineering; Eightfold
- **Microsoft** — Entry + SWE + US; Eightfold + `all_jobs`
- **Affirm** — Engineering; title `Engineer` and `I`
- **AMD** — new grad + Engineering + US; Jibe
- **Intuit** — New College Grad; TalentBrew
- **Scale AI** — University; Greenhouse
- **Block** — SWE + US hubs; new-grad title semantics
- **Expedia** — Emerging Talent; Appcast
- **Susquehanna** — New Graduates + June 2027; Jibe
- **ServiceNow** — Eng + Early Career + US
- **Salesforce** — New Grads + SWE + US
- **Meta** — University Grad search; `browser` + `all_jobs`
- **Apple** — Fresh Graduates + US SWE/ML; `all_jobs`
- **Google** — Early + US + Campus; `all_jobs`
- **NVIDIA** — New College Grad engineering; Eightfold

## Secrets and what not to commit

| Keep out of git | Why |
|-----------------|-----|
| `.dev.vars` | Local copies of webhook + `RUN_SECRET` |
| Wrangler secrets | `DISCORD_WEBHOOK_URL`, `RUN_SECRET`, optional `DISCORD_USER_ID` |
| Webhook URL files | Discord will post to anyone who has the URL |

`.gitignore` already covers `.dev.vars`, `.wrangler/`, and `*webhook*.txt`.

If a webhook URL was ever committed, **delete that webhook in Discord and create a new one**, then `wrangler secret put DISCORD_WEBHOOK_URL` again. Rotating the secret is the only way to invalidate the old URL in git history.

`wrangler.jsonc` KV ids and the Worker name are not secrets. They are *your* account’s resources; forks must create their own.

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| `Unauthorized` on `/status` or `/run` | `RUN_SECRET` does not match the `token` / Bearer value |
| Deploy error about KV | You did not paste a namespace id you created |
| Cron never updates last tick | Wait a few minutes after first deploy; confirm `SELF.service` equals `"name"` |
| Discord never fires | Seed first (no notify). Then `POST /test-notify`. Confirm the secret is set: `npx wrangler secret list` |
| Last polled stale, last tick fresh | One shard failed; others should still rotate |
| Meta always skipped | Browser budget / 60-minute spacing; wait or click **Run** on that row |
| `Too many subrequests` | Do not use `?all=1` on Free; use the rotating batch |
| KV writes fail late in the day | Free cap is 1000 puts/day; resets 00:00 UTC |

```bash
npx wrangler tail
```

Live logs show `cron_dispatch_ok`, `company_ok`, `company_failed`, and `check_complete`.

## KV keys (reference)

| Key | Meaning |
|-----|---------|
| `bootstrap:{companyId}` | First seed finished |
| `job:{companyId}:{jobId}` | Already seen |
| `status:company:{companyId}` | Last outcome row |
| `status:poll_shard:{n}` | Last-polled times for that cron shard |
| `status:last_run` | Last tick that found new jobs |
