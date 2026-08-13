import { fetchRenderedHtml } from "./browser";
import { checkAll, checkOne } from "./check";
import { COMPANIES } from "./companies";
import { setCompanyPaused, setGlobalPaused } from "./control";
import { notifyNewJobs } from "./discord";
import { extractJobs } from "./parse";
import { getTrackerStatus, renderStatusHtml } from "./status";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Rotate a small batch each tick — full 47-company polls exceed Free
    // subrequest limits and abort before lastRun is saved.
    await checkAll(env, { rotate: true });
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const status = await getTrackerStatus(env.SEEN_JOBS);
      const wantsHtml =
        url.searchParams.get("format") === "html" ||
        (request.headers.get("Accept") ?? "").includes("text/html");
      if (wantsHtml) {
        const token = statusPageToken(request, url) ?? env.RUN_SECRET;
        return new Response(
          renderStatusHtml(status, {
            token,
            flash: parseRunFlash(url),
          }),
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        );
      }
      return Response.json(status, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (request.method === "POST" && url.pathname === "/control/pause") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const body = await readPauseBody(request);
      if (!body) {
        return Response.json(
          { error: "Expected scope=global|company and paused=true|false" },
          { status: 400 },
        );
      }

      if (body.scope === "global") {
        await setGlobalPaused(env.SEEN_JOBS, body.paused);
      } else {
        if (!body.companyId || !COMPANIES.some((c) => c.id === body.companyId)) {
          return Response.json(
            { error: "Unknown or missing companyId" },
            { status: 400 },
          );
        }
        await setCompanyPaused(env.SEEN_JOBS, body.companyId, body.paused);
      }

      const wantsHtml =
        (request.headers.get("Accept") ?? "").includes("text/html") ||
        (request.headers.get("Content-Type") ?? "").includes(
          "application/x-www-form-urlencoded",
        );
      if (wantsHtml) {
        const token = statusPageToken(request, url) ?? env.RUN_SECRET;
        return Response.redirect(
          new URL(
            `/status?token=${encodeURIComponent(token)}&format=html`,
            url,
          ).toString(),
          303,
        );
      }

      return Response.json({
        ok: true,
        scope: body.scope,
        companyId: body.companyId ?? null,
        paused: body.paused,
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
      const pageCount = Number.isFinite(pagesToFetch)
        ? Math.min(Math.max(pagesToFetch, 1), 3)
        : 2;

      const pages: Array<{
        page: number;
        url: string;
        htmlLength: number;
        jobsPathIdsInHtml: number;
        hasNoResultsCopy: boolean;
        mentionsUniversityGrad: boolean;
        hrefSamples: string[];
        allJobs: number;
        universityGrad: number;
        sampleTitles: string[];
        ugTitles: string[];
      }> = [];

      const allIds = new Set<string>();
      const ugIds = new Set<string>();

      for (let page = 1; page <= pageCount; page++) {
        const pageUrl = new URL(meta.url);
        if (page > 1) pageUrl.searchParams.set("page", String(page));
        const html = await fetchRenderedHtml(env.BROWSER, pageUrl.toString());

        const allOnPage = await extractJobs(
          { ...meta, titleIncludes: undefined },
          html,
        );
        const ugOnPage = await extractJobs(meta, html);

        for (const job of allOnPage) allIds.add(job.id);
        for (const job of ugOnPage) ugIds.add(job.id);

        const jobPathHits = [
          ...html.matchAll(/\/(?:profile\/job_details|jobs)\/(\d+)/gi),
        ].map((m) => m[1]);
        const hrefSamples = [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)]
          .map((m) => m[2])
          .filter((h) => /job_details|\/jobs\//i.test(h))
          .slice(0, 20);

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
          ugTitles: ugOnPage.map((j) => j.title).slice(0, 15),
        });
      }

      return Response.json({
        note: "Counts what Browser Run sees per page (same path as the tracker). Meta may paginate beyond this.",
        pagesFetched: pageCount,
        uniqueAllJobsAcrossPages: allIds.size,
        uniqueUniversityGradAcrossPages: ugIds.size,
        pages,
      });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      if (!authorize(request, env.RUN_SECRET, url)) {
        return new Response("Unauthorized", { status: 401 });
      }

      let companyId: string | undefined;
      let runAll = false;
      try {
        const opts = await readRunOptions(request, url);
        companyId = opts.companyId;
        runAll = opts.all;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ error: message }, { status: 400 });
      }
      // Default (and dashboard button): same rotating batch as cron so Free
      // subrequest limits don't abort the run. Pass all=1 / {"all":true} for every company.
      const summary = companyId
        ? await checkOne(env, companyId)
        : await checkAll(env, { rotate: !runAll });

      const wantsHtml =
        (request.headers.get("Accept") ?? "").includes("text/html") ||
        (request.headers.get("Content-Type") ?? "").includes(
          "application/x-www-form-urlencoded",
        );
      if (wantsHtml) {
        const token = statusPageToken(request, url) ?? env.RUN_SECRET;
        const detail = summary.details[0];
        const runStatus = companyId
          ? (detail?.status ?? "ok")
          : summary.failures > 0
            ? "failed"
            : summary.skipped === summary.companies
              ? "skipped"
              : "ok";
        const flash = new URLSearchParams({
          format: "html",
          token,
          ran: companyId ? "company" : runAll ? "all" : "batch",
          runStatus,
          matched: String(
            companyId
              ? (detail?.matched ?? 0)
              : summary.details.reduce((n, d) => n + d.matched, 0),
          ),
          notified: String(summary.newJobs),
          failures: String(summary.failures),
          skipped: String(summary.skipped),
        });
        if (companyId) flash.set("companyId", companyId);
        if (companyId && detail?.error) {
          flash.set("error", detail.error.slice(0, 200));
        }
        return Response.redirect(
          new URL(`/status?${flash.toString()}`, url).toString(),
          303,
        );
      }

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
        "Meta (test — ignore)",
        [
          {
            id: "test",
            title: "Software Engineer, University Grad (TEST)",
            url: "https://www.metacareers.com/jobs/000000000000000",
          },
        ],
        mentionUserId,
      );
      return Response.json({
        ok: true,
        sent: "test notification",
        mentionUserId: mentionUserId || null,
        expectedContent: mentionUserId
          ? `<@${mentionUserId}> **New grad SWE — Meta (test — ignore)** (1 new)`
          : null,
      });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function authorize(
  request: Request,
  secret: string,
  url: URL,
): boolean {
  if (!secret) return false;

  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length);
    if (timingSafeEqualString(token, secret)) return true;
  }

  // Convenience for opening /status in a browser on your phone
  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeEqualString(queryToken, secret)) return true;

  return false;
}

function statusPageToken(request: Request, url: URL): string | null {
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;
  const header = request.headers.get("Authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
}

async function readRunOptions(
  request: Request,
  url: URL,
): Promise<{ companyId?: string; all: boolean }> {
  const allFromQuery = url.searchParams.get("all") === "1";
  const fromQuery = url.searchParams.get("companyId")?.trim();
  if (fromQuery) {
    if (!COMPANIES.some((c) => c.id === fromQuery)) {
      throw new Error(`Unknown companyId: ${fromQuery}`);
    }
    return { companyId: fromQuery, all: false };
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const data = (await request.json()) as {
        companyId?: unknown;
        all?: unknown;
      };
      const all =
        allFromQuery ||
        data.all === true ||
        data.all === 1 ||
        data.all === "1";
      if (typeof data.companyId === "string" && data.companyId.trim()) {
        const id = data.companyId.trim();
        if (!COMPANIES.some((c) => c.id === id)) {
          throw new Error(`Unknown companyId: ${id}`);
        }
        return { companyId: id, all: false };
      }
      return { all };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown")) {
        throw error;
      }
      return { all: allFromQuery };
    }
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const id = String(form.get("companyId") ?? "").trim();
    const all =
      allFromQuery ||
      String(form.get("all") ?? "") === "1" ||
      String(form.get("all") ?? "") === "true";
    if (!id) return { all };
    if (!COMPANIES.some((c) => c.id === id)) {
      throw new Error(`Unknown companyId: ${id}`);
    }
    return { companyId: id, all: false };
  }

  return { all: allFromQuery };
}

function parseRunFlash(
  url: URL,
):
  | {
      ran: "all" | "batch" | "company";
      companyId?: string;
      runStatus: string;
      matched: number;
      notified: number;
      failures: number;
      skipped: number;
      error?: string;
    }
  | undefined {
  const ran = url.searchParams.get("ran");
  if (ran !== "all" && ran !== "batch" && ran !== "company") return undefined;
  return {
    ran,
    companyId: url.searchParams.get("companyId") ?? undefined,
    runStatus: url.searchParams.get("runStatus") ?? "ok",
    matched: Number(url.searchParams.get("matched") ?? "0") || 0,
    notified: Number(url.searchParams.get("notified") ?? "0") || 0,
    failures: Number(url.searchParams.get("failures") ?? "0") || 0,
    skipped: Number(url.searchParams.get("skipped") ?? "0") || 0,
    error: url.searchParams.get("error") ?? undefined,
  };
}

type PauseBody = {
  scope: "global" | "company";
  companyId?: string;
  paused: boolean;
};

async function readPauseBody(request: Request): Promise<PauseBody | null> {
  const contentType = request.headers.get("Content-Type") ?? "";
  let scope = "";
  let companyId = "";
  let pausedRaw = "";

  if (contentType.includes("application/json")) {
    let data: unknown;
    try {
      data = await request.json();
    } catch {
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    scope = typeof obj.scope === "string" ? obj.scope : "";
    companyId = typeof obj.companyId === "string" ? obj.companyId : "";
    if (typeof obj.paused === "boolean") pausedRaw = obj.paused ? "true" : "false";
    else if (typeof obj.paused === "string") pausedRaw = obj.paused;
  } else {
    const form = await request.formData();
    scope = String(form.get("scope") ?? "");
    companyId = String(form.get("companyId") ?? "");
    pausedRaw = String(form.get("paused") ?? "");
  }

  if (scope !== "global" && scope !== "company") return null;
  if (!["true", "false", "1", "0", "on"].includes(pausedRaw)) return null;
  const paused =
    pausedRaw === "true" || pausedRaw === "1" || pausedRaw === "on";

  return {
    scope,
    companyId: companyId || undefined,
    paused,
  };
}

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}
