import { checkAll } from "./check";
import { notifyNewJobs } from "./discord";
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
