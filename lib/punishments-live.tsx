"use client";

import { useCallback, useEffect, useState } from "react";

import {
  parseFeed,
  parseSuggestion,
  type PunishmentFeed,
  type PunishmentSuggestion,
} from "./punishments.ts";

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

/**
 * Splices a just-created suggestion into the feed already on screen.
 *
 * MERGED LOCALLY RATHER THAN REFETCHED. The endpoint echoes the row it wrote, so
 * everything needed to render it is already in hand, and a second round trip to
 * Apps Script is another second of staring at a spinner having already waited
 * one. Parsed through the same `parseSuggestion` as the feed, so a row added a
 * moment ago and the same row on the next load are indistinguishable.
 */
const withSuggestion = (
  feed: PunishmentFeed,
  season: number,
  created: PunishmentSuggestion,
): PunishmentFeed => ({
  ...feed,
  seasons: feed.seasons.map((s) =>
    s.season === season
      ? { ...s, suggestions: [...s.suggestions.filter((x) => x.id !== created.id), created] }
      : s,
  ),
});

/**
 * Adds a suggestion, and returns the row the sheet created.
 *
 * THE CONTENT TYPE IS LOAD-BEARING. `text/plain` keeps this a CORS "simple
 * request", which is the only kind that reaches an Apps Script web app from
 * another origin: Apps Script cannot answer a preflight, so sending the obvious
 * `application/json` means the browser fires an OPTIONS, gets nothing usable
 * back, and the POST never happens. The body is JSON either way — only the
 * header is a lie, and it is the lie that makes it work.
 *
 * THE ID COMES BACK FROM THE SERVER, never from here. Two people submitting at
 * the same moment must not compute the same next row.
 *
 * Errors arrive as `ok: false` with HTTP 200, same as the read side, and the
 * message is written to be shown to a person — so it is thrown verbatim rather
 * than replaced with something of our own.
 */
export async function addSuggestion(
  endpoint: string,
  body: { league: string; season: number; text: string; suggestedBy?: string | null },
): Promise<PunishmentSuggestion> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ func: "addSuggestion", ...body }),
  });
  if (!res.ok) throw new Error(`The sheet rejected the request (${res.status}).`);

  const payload: unknown = await res.json();
  const data = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  if (data.ok === false) throw new Error(String(data.error ?? "The sheet rejected the request."));

  const created = parseSuggestion(data.suggestion);
  if (!created) throw new Error("The sheet saved it but did not say what it saved.");
  return created;
}

export function usePunishments(src: string): FeedState & {
  /** Show a row this browser just created, without waiting for a refetch. */
  insertSuggestion: (season: number, created: PunishmentSuggestion) => void;
} {
  const [state, setState] = useState<FeedState>({ status: "loading", feed: null, error: null });

  const insertSuggestion = useCallback((season: number, created: PunishmentSuggestion) => {
    setState((prev) =>
      prev.status === "ready"
        ? { ...prev, feed: withSuggestion(prev.feed, season, created) }
        : prev,
    );
  }, []);

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

  return { ...state, insertSuggestion };
}
