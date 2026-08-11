/** Workers Free includes ~10 browser-minutes/day — keep sessions short. */
const GOTO_TIMEOUT_MS = 30_000;
const SELECTOR_TIMEOUT_MS = 25_000;

export class BrowserRateLimitError extends Error {
  constructor(detail: string) {
    super(`Browser Run failed with 429: ${detail}`);
    this.name = "BrowserRateLimitError";
  }
}

export type FetchRenderedOptions = {
  /** Prefer waitForSelector over networkidle — much cheaper on free tier. */
  waitForSelector?: string;
};

/**
 * Fetch fully rendered HTML via Cloudflare Browser Run (Browser Rendering).
 * Requires wrangler browser binding + remote mode for local dev.
 */
export async function fetchRenderedHtml(
  browser: BrowserBinding,
  url: string,
  options: FetchRenderedOptions = {},
): Promise<string> {
  const payload: Record<string, unknown> = {
    url,
    gotoOptions: {
      waitUntil: options.waitForSelector ? "domcontentloaded" : "networkidle2",
      timeout: GOTO_TIMEOUT_MS,
    },
  };

  if (options.waitForSelector) {
    payload.waitForSelector = {
      selector: options.waitForSelector,
      timeout: SELECTOR_TIMEOUT_MS,
    };
  }

  const response = await browser.quickAction("content", payload);

  if (response.status === 429) {
    const detail = (await response.text()).slice(0, 500);
    throw new BrowserRateLimitError(detail);
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

/** Minimal typing for env.BROWSER.quickAction (Browser Run). */
export type BrowserBinding = {
  quickAction(
    action: string,
    options: Record<string, unknown>,
  ): Promise<Response>;
};
