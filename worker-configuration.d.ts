interface Env {
  SELF: Fetcher;
  SEEN_JOBS: KVNamespace;
  BROWSER: {
    quickAction(
      action: string,
      options: Record<string, unknown>,
    ): Promise<Response>;
  };
  DISCORD_WEBHOOK_URL: string;
  DISCORD_USER_ID: string;
  RUN_SECRET: string;
}
