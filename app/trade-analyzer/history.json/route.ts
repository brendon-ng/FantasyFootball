import { getPlayerHistory } from "@/lib/data";

/**
 * Every player's transaction history in this league, as a static JSON file.
 *
 * FETCHED BY THE PLAYER CARD WHEN ONE OPENS, not baked into the page. The card
 * can open on any player — a free agent, a backup on a depth chart — so the
 * page would have to embed the whole history to cover it, ~1.3MB raw for Den
 * Ops, on every visit whether a card is opened or not. As a file it is ~70KB
 * gzipped, fetched once, and only by someone who clicks a name.
 *
 * Sleeper's own per-player transaction query would be the obvious source and
 * cannot be used: it requires a logged-in session. Moves not archived yet are
 * merged in from the live layer, as on a player page.
 *
 * A GET route handler with no Request is a static file under `output: "export"`.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(getPlayerHistory());
}
