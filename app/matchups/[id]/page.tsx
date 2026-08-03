import Link from "next/link";
import { notFound } from "next/navigation";

import { PositionPill } from "@/components/keeper-table";
import { Col, ListHeader, Panel, PanelHeader, Stat, fmt } from "@/components/ui";
import {
  getAllMeetings,
  getMeetings,
  getOwnerMap,
  getPlayers,
  getSeasons,
  type Meeting,
  type MeetingSide,
} from "@/lib/data";

export const dynamicParams = false;

/**
 * One page per game ever played.
 *
 * This is where lineups live. The head-to-head page lists a series and links
 * here; duplicating the per-player breakdown in both would mean two renderers
 * for the same thing, drifting apart.
 *
 * Imported ESPN games get a page too, even though they kept no lineups — the
 * score, the round it decided, and the series context are all still real. A
 * missing page would leave dead links from the record book.
 */
export function generateStaticParams() {
  return getAllMeetings().map((m) => ({ id: m.id }));
}

const KIND_LABEL: Record<Meeting["kind"], string> = {
  regular: "Regular season",
  playoff: "Playoffs",
  consolation: "Consolation",
};

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = getAllMeetings().find((m) => m.id === id);
  if (!game) notFound();

  const owners = getOwnerMap();
  const players = getPlayers();
  const season = getSeasons().find((s) => s.season === game.season);
  const name = (slug: string) => owners.get(slug)?.name ?? slug;

  const winner = game.a.points === game.b.points ? null : game.a.points > game.b.points ? game.a : game.b;
  const margin = Math.abs(game.a.points - game.b.points);

  // Series context: every other meeting between these two, so this game can be
  // placed in the rivalry rather than shown in isolation.
  const series = getMeetings(game.a.ownerSlug, game.b.ownerSlug);
  const tally = (subset: Meeting[]) => {
    let w = 0, l = 0, t = 0;
    for (const g of subset) {
      if (g.a.points === g.b.points) t++;
      else if (g.a.points > g.b.points) w++;
      else l++;
    }
    return { w, l, t };
  };
  const overall = tally(series);
  const prior = tally(series.filter((g) => g.season < game.season || (g.season === game.season && (g.week ?? 0) < (game.week ?? 0))));
  const pairHref = `/h2h/${[game.a.ownerSlug, game.b.ownerSlug].sort().join("-vs-")}/`;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <Link href={pairHref} className="text-xs text-chalk-600 hover:text-accent">
          ← {name(game.a.ownerSlug)} vs {name(game.b.ownerSlug)}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {game.season} · Week {game.week ?? "—"}
        </h1>
        <p className="mt-1 text-sm text-chalk-500">
          {KIND_LABEL[game.kind]}
          {game.label ? ` · ${game.label}` : ""}
          {" · "}
          <Link href={`/history/${game.season}/`} className="hover:text-accent">
            {game.season} season
          </Link>
        </p>
      </div>

      {/* Scoreboard */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {[game.a, game.b].map((side) => {
          const won = winner?.ownerSlug === side.ownerSlug;
          return (
            <div
              key={side.ownerSlug}
              className={`rounded-xl border px-4 py-4 ${
                won ? "border-accent-dim bg-accent/[0.06]" : "border-ink-600 bg-ink-850"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/owners/${side.ownerSlug}/`}
                  className="truncate text-base font-semibold transition-colors hover:text-accent sm:text-lg"
                >
                  {name(side.ownerSlug)}
                </Link>
                <span
                  className={`tabular shrink-0 text-2xl font-bold ${won ? "text-accent" : "text-chalk-300"}`}
                >
                  {fmt.pts(side.points)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-chalk-600">
                {won ? "Winner" : winner ? `Lost by ${fmt.pts(margin)}` : "Tie"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Margin" value={fmt.pts(margin)} tone={margin < 5 ? "accent" : "default"} />
        <Stat label="Combined" value={fmt.pts1(game.a.points + game.b.points)} />
        <Stat
          label="Series before this"
          value={prior.w + prior.l + prior.t === 0 ? "First meeting" : `${prior.w}-${prior.l}`}
          sub={prior.w + prior.l + prior.t ? `${name(game.a.ownerSlug)} perspective` : undefined}
        />
        <Stat
          label="Series all-time"
          value={`${overall.w}-${overall.l}${overall.t ? `-${overall.t}` : ""}`}
          sub={`${series.length} meetings`}
        />
      </div>

      {game.hasLineups ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {[game.a, game.b].map((side) => (
            <Lineup
              key={side.ownerSlug}
              side={side}
              slots={season?.rosterPositions ?? []}
              name={name(side.ownerSlug)}
              players={players}
              won={winner?.ownerSlug === side.ownerSlug}
            />
          ))}
        </div>
      ) : (
        <Panel>
          <PanelHeader title="Lineups" />
          <div className="px-4 py-8 text-center text-sm text-chalk-600 sm:px-5">
            This game predates the league&apos;s move to Sleeper. The archived ESPN pages
            recorded the score but no lineups, so there is nothing to break down.
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Rest of the Series"
          meta={`${series.length - 1} other meeting${series.length === 2 ? "" : "s"}`}
          href={pairHref}
          hrefLabel="Head to head"
        />
        <div className="divide-y divide-ink-700">
          {series
            .filter((g) => g.id !== game.id)
            .map((g) => {
              const gw = g.a.points === g.b.points ? null : g.a.points > g.b.points ? g.a : g.b;
              return (
                <Link
                  key={g.id}
                  href={`/matchups/${g.id}/`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40 sm:px-5"
                >
                  <span className="tabular w-20 shrink-0 text-[11px] text-chalk-600">
                    {g.season}
                    {g.week ? ` wk${g.week}` : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    {[g.a, g.b].map((s) => (
                      <div
                        key={s.ownerSlug}
                        className={`truncate text-sm ${
                          gw?.ownerSlug === s.ownerSlug
                            ? "font-semibold text-chalk-100"
                            : "text-chalk-500"
                        }`}
                      >
                        <span data-owner={s.ownerSlug}>{name(s.ownerSlug)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Badge left of the numbers, in a slot that is always there. */}
                  <span className="hidden w-[92px] shrink-0 text-right sm:block">
                    {g.kind !== "regular" ? (
                      <span className="rounded border border-ink-500 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-chalk-500">
                        {g.label ?? g.kind}
                      </span>
                    ) : null}
                  </span>
                  <div className="w-20 shrink-0 text-right">
                    {[g.a, g.b].map((s) => (
                      <div
                        key={s.ownerSlug}
                        className={`tabular text-sm ${
                          gw?.ownerSlug === s.ownerSlug
                            ? "font-semibold text-chalk-100"
                            : "text-chalk-500"
                        }`}
                      >
                        {fmt.pts(s.points)}
                      </div>
                    ))}
                  </div>
                  <span aria-hidden className="shrink-0 text-[10px] text-chalk-600">
                    →
                  </span>
                </Link>
              );
            })}
        </div>
      </Panel>
    </div>
  );
}

/**
 * One team's lineup.
 *
 * `starters` is positionally aligned to the league's `roster_positions`, which
 * is the only way to know a given player filled the FLEX rather than RB2 — the
 * player object itself just says "RB".
 */
function Lineup({
  side,
  slots,
  name,
  players,
  won,
}: {
  side: MeetingSide;
  slots: string[];
  name: string;
  players: Record<string, { full_name: string; position: string | null; team: string | null }>;
  won: boolean;
}) {
  const startersTotal = side.starters.reduce((t, pid) => t + (side.playerPoints[pid] ?? 0), 0);
  const bench = Object.keys(side.playerPoints).filter((pid) => !side.starters.includes(pid));
  const benchTotal = bench.reduce((t, pid) => t + (side.playerPoints[pid] ?? 0), 0);
  const best = Math.max(0, ...side.starters.map((pid) => side.playerPoints[pid] ?? 0));

  const row = (pid: string, slot: string | null) => {
    const p = players[pid];
    const pts = side.playerPoints[pid] ?? 0;
    return (
      <div key={pid} className="flex items-center gap-2.5 px-3 py-1.5 sm:px-4">
        {slot ? (
          <span className="w-10 shrink-0 text-[10px] font-bold uppercase tracking-wide text-chalk-600">
            {slot}
          </span>
        ) : (
          <span className="w-10 shrink-0" />
        )}
        <PositionPill position={p?.position ?? null} />
        <Link
          href={`/players/${pid}/`}
          className="min-w-0 flex-1 truncate text-sm transition-colors hover:text-accent"
        >
          {p?.full_name ?? pid}
          {p?.team ? (
            <span className="ml-1.5 text-[11px] text-chalk-600">{p.team}</span>
          ) : null}
        </Link>
        <span
          className={`tabular w-14 shrink-0 text-right text-sm ${
            slot && pts === best && best > 0 ? "font-bold text-accent" : "text-chalk-300"
          }`}
        >
          {fmt.pts(pts)}
        </span>
      </div>
    );
  };

  return (
    <Panel>
      <PanelHeader
        title={name}
        meta={`${fmt.pts(startersTotal)} from starters`}
        legend={won ? undefined : undefined}
      />
      <ListHeader>
        <Col className="w-10 shrink-0">Slot</Col>
        <Col className="w-8 shrink-0 text-center">Pos</Col>
        <Col className="flex-1">Player</Col>
        <Col className="w-14 shrink-0 text-right" hint="Fantasy points scored in this game">
          Pts
        </Col>
      </ListHeader>
      <div className="divide-y divide-ink-700">
        {side.starters.map((pid, i) => row(pid, slots[i] ?? "FLEX"))}
      </div>

      {bench.length ? (
        <details className="group border-t border-ink-600">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-[11px] text-chalk-600 transition-colors hover:bg-ink-700/40 sm:px-5">
            <span>
              Bench · {bench.length} players · {fmt.pts(benchTotal)} left on it
            </span>
            <span className="transition-transform group-open:rotate-90">▸</span>
          </summary>
          <div className="divide-y divide-ink-700 bg-ink-850/60 opacity-70">
            {bench
              .sort((a, b) => (side.playerPoints[b] ?? 0) - (side.playerPoints[a] ?? 0))
              .map((pid) => row(pid, null))}
          </div>
        </details>
      ) : null}
    </Panel>
  );
}
