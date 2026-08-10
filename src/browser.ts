const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 20_000;

/**
 * Fetch fully rendered HTML via Cloudflare Browser Run (Browser Rendering).
 * Requires wrangler browser binding + remote mode for local dev.
 */
export async function fetchRenderedHtml(
  browser: BrowserBinding,
  url: string,
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RATE_LIMIT_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    const response = await browser.quickAction("content", {
      url,
      gotoOptions: {
        waitUntil: "networkidle2",
        timeout: 45_000,
      },
    });

    if (response.status === 429) {
      const detail = (await response.text()).slice(0, 500);
      lastError = new Error(`Browser Run failed with 429: ${detail}`);
      continue;
    }

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

  throw lastError ?? new Error("Browser Run rate limited");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimal typing for env.BROWSER.quickAction (Browser Run). */
export type BrowserBinding = {
  quickAction(
    action: string,
    options: Record<string, unknown>,
  ): Promise<Response>;
};
