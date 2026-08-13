const GLOBAL_PAUSED_KEY = "control:global_paused";
const PAUSED_COMPANIES_KEY = "control:paused_companies";
const CRON_CURSOR_KEY = "control:cron_cursor";

/** Companies per cron/batch tick — keep Free-plan external subrequests under 50. */
export const COMPANIES_PER_BATCH = 20;

export type ControlState = {
  globalPaused: boolean;
  pausedCompanyIds: string[];
  cronCursor: number;
};

export async function getControlState(kv: KVNamespace): Promise<ControlState> {
  const [globalRaw, companiesRaw, cursorRaw] = await Promise.all([
    kv.get(GLOBAL_PAUSED_KEY),
    kv.get(PAUSED_COMPANIES_KEY),
    kv.get(CRON_CURSOR_KEY),
  ]);
  return {
    globalPaused: globalRaw === "1",
    pausedCompanyIds: parsePausedCompanies(companiesRaw),
    cronCursor: parseCursor(cursorRaw),
  };
}

export async function getCronCursor(kv: KVNamespace): Promise<number> {
  return parseCursor(await kv.get(CRON_CURSOR_KEY));
}

export async function setCronCursor(
  kv: KVNamespace,
  cursor: number,
): Promise<void> {
  await kv.put(CRON_CURSOR_KEY, String(Math.max(0, Math.floor(cursor))));
}

export async function isGlobalPaused(kv: KVNamespace): Promise<boolean> {
  return (await kv.get(GLOBAL_PAUSED_KEY)) === "1";
}

export async function getPausedCompanyIds(
  kv: KVNamespace,
): Promise<Set<string>> {
  const raw = await kv.get(PAUSED_COMPANIES_KEY);
  return new Set(parsePausedCompanies(raw));
}

export async function setGlobalPaused(
  kv: KVNamespace,
  paused: boolean,
): Promise<void> {
  if (paused) {
    await kv.put(GLOBAL_PAUSED_KEY, "1");
  } else {
    await kv.delete(GLOBAL_PAUSED_KEY);
  }
}

export async function setCompanyPaused(
  kv: KVNamespace,
  companyId: string,
  paused: boolean,
): Promise<void> {
  const ids = await getPausedCompanyIds(kv);
  if (paused) ids.add(companyId);
  else ids.delete(companyId);
  if (ids.size === 0) {
    await kv.delete(PAUSED_COMPANIES_KEY);
  } else {
    await kv.put(
      PAUSED_COMPANIES_KEY,
      JSON.stringify([...ids].sort()),
    );
  }
}

function parsePausedCompanies(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  } catch {
    return [];
  }
}

function parseCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
