/**
 * Talking to a Google Apps Script web app, reliably.
 *
 * Kept apart from the hook that uses it because none of this is about React —
 * it is about one specific server's failure modes, and it is the only part of
 * the punishments page worth testing on its own.
 */

/**
 * The feed GET, retried — the one request the whole page waits on.
 *
 * AN APPS SCRIPT /exec IS TWO REQUESTS, not one. It answers 302 and the body is
 * actually served from `script.googleusercontent.com`; the execution log can
 * show every run completing while the reader still gets nothing, because it is
 * the SECOND hop that failed. When it does, Google serves its own "unable to
 * open the file at this time" page — sometimes as a 404, sometimes as HTML
 * under a 200 — and one of those was enough to put this whole page into its
 * error state.
 *
 * SO 404 IS RETRIED HERE, which is the opposite of `lib/live/retry.ts`. There a
 * 404 is an answer: an ESPN league nobody made public will not become public on
 * the next attempt. Here it is a delivery fault on a URL that is definitely
 * real, and the next attempt usually works.
 *
 * EACH ATTEMPT USES A DIFFERENT DEPLOYMENT, when the league has more than one.
 * Several deployments of one Apps Script project share an owner, a quota and a
 * spreadsheet, so this does NOT divide the load — that was the hope, and it is
 * not what this buys. What it buys is REDUNDANCY, which turned out to be the
 * failure that actually happens: a deployment can stop serving entirely, 404ing
 * on the FIRST hop with no redirect at all, and stay that way. One dead
 * deployment out of five then costs a retry instead of a broken page.
 *
 * The starting point is random per reader, so a dead one is not always first
 * and the healthy ones are not all hit in the same order.
 *
 * TIMED OUT PER ATTEMPT, AND THE FIRST ONE IS IMPATIENT. This is the fix for
 * the symptom people actually report — not an error, just a page that shimmers
 * for half a minute until they give up and reload, which then works. A healthy
 * answer arrives in two to four seconds, so eight is already generous; a hop
 * that has not answered by then is not about to. Reloading by hand was always
 * the right move and this just does it for them, sooner.
 *
 * The limits ESCALATE. If the first attempt died of a genuinely slow cold start
 * rather than a bad hop, cutting the retry off at eight seconds too would fail
 * it for the same reason twice.
 *
 * WHAT IS NOT RETRIED: `ok: false`. That is the script answering, and asking it
 * again will get the same answer. Nor is any WRITE — a draw is committed inside
 * a server-side lock, so a blind retry risks reporting a failure for something
 * that already happened.
 */
const FEED_BACKOFF_MS = [400, 900, 2000];
/** One per attempt; see above. */
const FEED_TIMEOUT_MS = [8000, 8000, 10000, 12000];

export interface ScriptResponse {
  body: unknown;
  /** Which deployment answered, so a WRITE can go to one known to be alive. */
  index: number;
}

export async function fetchScriptJson(
  urls: string[],
  /** Which deployment to try first. Random per reader; see above. */
  start = 0,
): Promise<ScriptResponse> {
  if (!urls.length) throw new Error("no endpoint configured");
  let last = "unknown error";
  for (let attempt = 0; ; attempt++) {
    const index = (start + attempt) % urls.length;
    const control = new AbortController();
    const limit = FEED_TIMEOUT_MS[Math.min(attempt, FEED_TIMEOUT_MS.length - 1)];
    const timer = setTimeout(() => control.abort(), limit);
    try {
      // no-store because an Apps Script /exec URL is a plain GET that browsers
      // will happily cache, and a vote cast a minute ago must not be missing.
      const res = await fetch(urls[index], { cache: "no-store", signal: control.signal });
      const text = await res.text();
      try {
        const body: unknown = JSON.parse(text);
        // A PARSED BODY IS THE SCRIPT TALKING, even under a non-200, so it is
        // returned rather than retried — `ok: false` is handled by the caller.
        if (res.ok) return { body, index };
        last = `the sheet answered ${res.status}`;
        return { body, index };
      } catch {
        // Not JSON: Google's error page, whatever status it arrived under.
        last = `the sheet served an error page (${res.status})`;
      }
    } catch (e) {
      last =
        e instanceof Error && e.name === "AbortError"
          ? "the sheet timed out"
          : "could not reach the sheet";
    } finally {
      clearTimeout(timer);
    }
    if (attempt >= FEED_BACKOFF_MS.length) throw new Error(last);
    // Jittered, so two readers opening the page together do not retry in step.
    const wait = FEED_BACKOFF_MS[attempt] * (0.5 + Math.random());
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * The script's own verdict, separated from the transport above.
 *
 * APPS SCRIPT CANNOT SET A STATUS CODE, so a rejected request still arrives as
 * HTTP 200 and says so in the body. Anything that reads from the sheet has to
 * check, or an error object parses into an empty result and a missing league
 * renders as a league with nothing in it.
 */
export function assertScriptOk(payload: unknown): Record<string, unknown> {
  const data =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};
  if (data.ok === false) {
    throw new Error(String(data.error ?? "The sheet rejected the request."));
  }
  return data;
}
