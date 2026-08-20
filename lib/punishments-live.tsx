"use client";

import { useEffect, useState } from "react";

import { parseFeed, type PunishmentFeed } from "./punishments.ts";

/**
 * Fetches the punishment feed in the browser.
 *
 * CLIENT-SIDE, NOT BAKED, and deliberately. The rest of the site's slow-moving
 * data is committed to git and read at build time, which costs the reader
 * nothing — but this is the one surface the league will eventually WRITE to
 * (submitting a suggestion, casting a vote, logging a completion), and someone
 * who just voted has to see their vote. A baked copy would be stale for up to
 * six hours, which is the whole deploy interval.
 *
 * FAILS SOFT the way the rest of the live layer does, with one difference worth
 * knowing: there is no baked layer underneath this one, so an outage leaves the
 * page empty rather than merely un-annotated. It therefore says what happened
 * instead of rendering an empty table that looks like a league with no
 * punishments.
 */
export type FeedState =
  | { status: "loading"; feed: null; error: null }
  | { status: "ready"; feed: PunishmentFeed; error: null }
  | { status: "error"; feed: null; error: string };

export function usePunishments(src: string): FeedState {
  const [state, setState] = useState<FeedState>({ status: "loading", feed: null, error: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // no-store because an Apps Script /exec URL is a plain GET that browsers
        // will happily cache, and a vote cast a minute ago must not be missing.
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(`${res.status}`);
        const body: unknown = await res.json();
        // APPS SCRIPT CANNOT SET A STATUS CODE, so a rejected request still
        // arrives as HTTP 200 and announces itself with `ok: false`. Checking
        // only `res.ok` would parse the error object into an empty feed and
        // render "nothing recorded" — a missing league looking like a league
        // with no punishments.
        if (typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === false) {
          throw new Error(String((body as { error?: unknown }).error ?? "request rejected"));
        }
        const feed = parseFeed(body);
        if (!cancelled) setState({ status: "ready", feed, error: null });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: "error",
            feed: null,
            error: e instanceof Error ? e.message : "unknown error",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  return state;
}
