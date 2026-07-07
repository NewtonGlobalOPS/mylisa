// src/lib/oakClient.ts
// Zero-dependency Oak API client (Node 18+ fetch). Rate-limited to respect Oak RPH.

type OakClientOptions = {
  baseUrl: string;
  apiKey: string;
  rph: number; // requests per hour
  timeoutMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;

function retryDelayMs(res: Response) {
  const raw =
    res.headers.get("retry-after") ??
    res.headers.get("x-retry-after") ??
    res.headers.get("x-ratelimit-reset");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 3000;
  if (parsed > 1_000_000_000_000) {
    return Math.max(1000, parsed - Date.now());
  }
  return Math.max(1000, parsed * 1000);
}

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getOakOptions(): OakClientOptions {
  const baseUrl =
    process.env.OAK_BASE_URL ?? "https://open-api.thenational.academy/api/v0";
  const apiKey = requiredEnv("OAK_API_KEY");
  const rph = Number(process.env.OAK_RPH ?? "950");
  const timeoutMs = Number(process.env.OAK_TIMEOUT_MS ?? "20000");
  if (!Number.isFinite(rph) || rph <= 0)
    throw new Error("OAK_RPH must be a positive number");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("OAK_TIMEOUT_MS must be a positive number");
  return { baseUrl, apiKey, rph, timeoutMs };
}

// Very simple token-bucket-ish spacing: one request every intervalMs.
class OakRateLimiter {
  private nextAt = 0;
  constructor(private intervalMs: number) {}
  async waitTurn() {
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.intervalMs;
    const wait = at - now;
    if (wait > 0) await sleep(wait);
  }
}

const opts = getOakOptions();
const intervalMs = Math.ceil((60 * 60 * 1000) / opts.rph); // e.g. 1000 rph => ~3600ms
const limiter = new OakRateLimiter(intervalMs);

export type OakFetchInit = {
  method?: "GET";
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  // If set, expect text response even if content-type is json.
  forceText?: boolean;
};

export async function oakGet<T = unknown>(
  path: string,
  init: OakFetchInit = {},
): Promise<T> {
  return oakGetAttempt<T>(path, init, 0);
}

async function oakGetAttempt<T = unknown>(
  path: string,
  init: OakFetchInit = {},
  attempt: number,
): Promise<T> {
  if (!path.startsWith("/")) path = "/" + path;

  const url = new URL(opts.baseUrl.replace(/\/+$/, "") + path);

  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  // Wait for our local rate limiter
  await limiter.waitTurn();

  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  try {
    const request = (async () => {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });

      // Handle rate limiting politely
      if (res.status === 429) {
        await sleep(retryDelayMs(res));
        return oakGetAttempt<T>(path, init, attempt + 1);
      }

      if (!res.ok) {
        const body = await safeReadText(res);
        throw new Error(
          `Oak API error ${res.status} ${res.statusText} on ${path}: ${body}`,
        );
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (init.forceText || !contentType.includes("application/json")) {
        return (await res.text()) as unknown as T;
      }
      return (await res.json()) as T;
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`Oak API timeout after ${opts.timeoutMs}ms on ${path}`));
      }, opts.timeoutMs);
    });

    return await Promise.race([request, timeoutPromise]);
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      await sleep(1000 * (attempt + 1));
      return oakGetAttempt<T>(path, init, attempt + 1);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
