/**
 * A guard against a projection feed that has simply gone wrong.
 *
 * NOT A JUDGEMENT ON A PROJECTION, a check that it describes a football game.
 * Sleeper's 2026 week-15 line for Harrison Butker carried 17 field goals and
 * 24 extra points — 60 points under Masterbatters' scoring, against a 7 in
 * every other week. The trade tools then streamed him as a free agent, handed
 * the worst team a 190-point playoff week, and moved title odds on the back of
 * it. Nothing upstream will catch that, because the feed is undocumented and
 * nobody else here reads a week that far out.
 *
 * THE CEILINGS ARE ABOUT TWICE THE REAL MAXIMUM, measured across every
 * remaining 2026 week of Sleeper's feed: quarterbacks, backs and receivers top
 * out at about 27, tight ends 20, kickers 10.7 (Butker aside) and defences
 * 12.4. Generous on purpose, so heavier league scoring never trips one — the
 * line is "impossible", not "unusual".
 *
 * A TRIPPED VALUE BECOMES THE PLAYER'S MEDIAN over the weeks that did pass,
 * which is what the rest of his line says he is worth. With no such week he
 * has no believable projection at all and is dropped, which the lineup reads
 * as the zero a missing projection always is.
 *
 * Every correction is RETURNED rather than applied silently, so the page can
 * say which number it refused — a corrected board renders exactly like a raw
 * one, the reason `<MockBadge />` exists.
 */

const CEILING: Record<string, number> = { K: 20, DEF: 25 };
const DEFAULT_CEILING = 45;

export const projectionCeiling = (position: string | null): number =>
  (position ? CEILING[position] : undefined) ?? DEFAULT_CEILING;

export interface ProjectionCorrection {
  id: string;
  week: number;
  /** What the feed said. */
  was: number;
  /** What is used instead; null means dropped. */
  now: number | null;
}

export function sanitizeProjections(
  byWeek: Record<number, Record<string, number>>,
  positionOf: (id: string) => string | null,
): { byWeek: Record<number, Record<string, number>>; corrections: ProjectionCorrection[] } {
  const bad: Array<{ id: string; week: number; was: number }> = [];
  for (const [w, points] of Object.entries(byWeek)) {
    for (const [id, v] of Object.entries(points)) {
      if (v > projectionCeiling(positionOf(id))) bad.push({ id, week: Number(w), was: v });
    }
  }
  if (!bad.length) return { byWeek, corrections: [] };

  const medianOf = (id: string): number | null => {
    const cap = projectionCeiling(positionOf(id));
    const ok = Object.values(byWeek)
      .map((p) => p[id])
      .filter((v): v is number => typeof v === "number" && v <= cap)
      .sort((a, b) => a - b);
    if (!ok.length) return null;
    const mid = ok.length >> 1;
    return ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
  };

  const out: Record<number, Record<string, number>> = { ...byWeek };
  const corrections: ProjectionCorrection[] = [];
  for (const { id, week, was } of bad) {
    const now = medianOf(id);
    const copy = (out[week] = out[week] === byWeek[week] ? { ...byWeek[week] } : out[week]);
    if (now == null) delete copy[id];
    else copy[id] = Math.round(now * 100) / 100;
    corrections.push({ id, week, was, now: now == null ? null : Math.round(now * 100) / 100 });
  }
  corrections.sort((a, b) => a.week - b.week || b.was - a.was);
  return { byWeek: out, corrections };
}
