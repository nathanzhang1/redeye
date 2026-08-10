/**
 * Fetch fully rendered HTML via Cloudflare Browser Run (Browser Rendering).
 * Requires wrangler browser binding + remote mode for local dev.
 */
export async function fetchRenderedHtml(
  browser: BrowserBinding,
  url: string,
): Promise<string> {
  const response = await browser.quickAction("content", {
    url,
    gotoOptions: {
      waitUntil: "networkidle2",
      timeout: 45_000,
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Browser Run failed with ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    success?: boolean;
    result?: string;
  };

  if (!data.success || typeof data.result !== "string") {
    throw new Error("Browser Run returned unsuccessful response");
  }

  if (data.result.length < 50) {
    throw new Error("Browser Run returned empty or too-short HTML");
  }

  return data.result;
}

/** Minimal typing for env.BROWSER.quickAction (Browser Run). */
export type BrowserBinding = {
  quickAction(
    action: string,
    options: Record<string, unknown>,
  ): Promise<Response>;
};
