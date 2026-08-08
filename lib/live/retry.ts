/**
 * Fetch with the retry policy the build used to have.
 *
 * `lib/data.ts` fetches live data during `next build`, and it used to do so
 * through `lib/sleeper.ts`, whose client retries 429s and 5xx with backoff.
 * Routing the build through the browser providers quietly dropped that: one
 * transient 502 on `/state/nfl` and the deploy shipped with no live panel,
 * every fifteen minutes through a game window.
 *
 * Cheap in a browser too — a rate-limited Sunday is exactly when a reader is
 * looking — so both ends share it rather than the build carrying a special
 * case.
 *
 * A NON-RETRYABLE STATUS RETURNS IMMEDIATELY. 401 and 404 are answers, not
 * failures: an ESPN season nobody made public will never become public within
 * four attempts, and retrying it just makes the page slower.
 */
const BACKOFF_MS = [500, 1000, 2000, 4000];

export async function fetchRetry(url: string, init?: RequestInit): Promise<Response | null> {
  let last: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      last = res;
      // Only a rate limit or a server fault is worth another go.
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      last = null;
    }
    if (attempt >= BACKOFF_MS.length) return last;
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
  }
}
