import { fetchRenderedHtml } from "./browser";
import { checkAll } from "./check";
import { COMPANIES } from "./companies";
import { notifyNewJobs } from "./discord";
import { extractJobs } from "./parse";
import { getTrackerStatus, renderStatusHtml } from "./status";

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await checkAll(env);
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
        return new Response(renderStatusHtml(status), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      return Response.json(status, {
        headers: { "Cache-Control": "no-store" },
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

function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}
