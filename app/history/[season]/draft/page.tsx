import Link from "next/link";
import { notFound } from "next/navigation";

import { DraftBoard, DraftList } from "@/components/draft-board";
import { Panel, PanelHeader } from "@/components/ui";
import { getDrafts, getOwnerMap, getPlayers, getSeasons, pageTitle } from "@/lib/data";

/**
 * A season's draft, as the board it was drafted on.
 *
 * A flat list of 170 picks answers "who went where" only by scanning; the grid
 * answers it by position, which is how anyone who was in the room remembers a
 * draft. Rounds are rows and draft slots are columns, so a team is a column and
 * the snake reads as pick numbers reversing direction each row.
 *
 * NO ADP HERE, deliberately. `getAdp()` returns the CURRENT market, which says
 * nothing about a draft two years ago — a "value vs ADP" column on the 2024
 * board would be comparing picks to a market that did not exist yet. Historical
 * ADP is not captured, so the honest move is to omit the column.
 *
 * Only seasons with draft data get a page: the 2020-23 ESPN seasons kept none,
 * so `generateStaticParams` filters rather than rendering four empty boards.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  const finalized = new Set(
    getSeasons()
      .filter((s) => s.finalized)
      .map((s) => s.season),
  );
  return [...new Set(getDrafts().map((p) => p.season))]
    .filter((s) => finalized.has(s))
    .sort()
    .map((season) => ({ season: String(season) }));
}

export async function generateMetadata({ params }: { params: Promise<{ season: string }> }) {
  const { season } = await params;
  return { title: pageTitle(`${season} Draft`) };
}

export default async function DraftPage({ params }: { params: Promise<{ season: string }> }) {
  const season = Number((await params).season);
  const picks = getDrafts().filter((p) => p.season === season);
  if (!picks.length) notFound();

  const owners = getOwnerMap();
  const players = getPlayers();
  const ownerNames = Object.fromEntries([...owners.values()].map((o) => [o.slug, o.name]));

  const rounds = Math.max(...picks.map((p) => p.round));
  const slots = Math.max(...picks.map((p) => p.draftSlot));
  const kept = picks.filter((p) => p.isKeeper).length;
  const traded = picks.filter(
    (p) => p.slotOwnerSlug && p.ownerSlug && p.ownerSlug !== p.slotOwnerSlug,
  ).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/history/${season}/`} className="text-xs text-chalk-600 hover:text-accent">
            ← {season} Season
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{season} Draft</h1>
        </div>
        <div className="text-right text-xs text-chalk-600">
          <div className="tabular">
            {picks.length} picks · {rounds} rounds · {slots} teams
          </div>
          {kept ? <div className="tabular font-medium text-accent">{kept} kept</div> : null}
          {traded ? <div className="tabular font-medium text-sky-300">{traded} traded</div> : null}
        </div>
      </div>

      <Panel>
        <PanelHeader
          title="Draft Board"
          meta={`${slots} slots · ${rounds} rounds`}
          legend={
            <>
              A column is a draft slot and a row is a round; the arrow in each cell
              points at where the draft went next, so the snake is visible.
              {kept ? (
                <>
                  {" "}
                  A <span className="text-accent">green</span> cell is a pick spent on
                  a keeper rather than a new player.
                </>
              ) : null}
              {traded ? (
                <>
                  {" "}
                  A <span className="text-sky-200">blue</span> banner names the team
                  that acquired that pick by trade — the column still shows whose slot
                  it originally was.
                </>
              ) : null}
            </>
          }
        />
        <DraftBoard
          picks={picks}
          rounds={rounds}
          slots={slots}
          players={players}
          ownerNames={ownerNames}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Every Pick"
          meta={`${picks.length} in order`}
          legend={
            traded
              ? "Overall pick number, then round and slot, in the order they were made. “via” marks a pick acquired by trade and names who it came from."
              : "Overall pick number, then round and slot, in the order they were made."
          }
        />
        <DraftList picks={picks} players={players} ownerNames={ownerNames} />
      </Panel>
    </div>
  );
}
