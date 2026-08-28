"use client";

import { useState } from "react";

import {
  AllMediaSheet,
  Lightbox,
  MediaRow,
  useSeasonMedia,
  useUploader,
  type Viewing,
} from "@/components/punishment-media";
import { TeamNames } from "@/components/punishment-ledger";
import { Panel, PanelHeader } from "@/components/ui";
import {
  formatPunishmentDate,
  type SeasonPunishment,
} from "@/lib/season-punishment";
import type { TeamMap } from "@/lib/punishments";

/**
 * One season's last-place punishment, as a record of it happening.
 *
 * A MEMORIES LOG. There is no ballot, no wheel and no deadline here — the
 * punishment is written in config, who owes it is derived from the toilet bowl,
 * and the only things that move are the completion date and the photos.
 *
 * IT RENDERS ON A SEASON PAGE WITH NO TRACKER BEHIND IT. Most leagues here run
 * the yearly punishment and not the weekly one, so `/punishments/` does not
 * exist for them — which is why this is self-contained rather than a teaser
 * linking somewhere better. The same component is mounted on the tracker for the
 * one league that has both.
 *
 * ALL FOUR STATES, ALWAYS. A punishment can be decided before anyone knows who
 * will owe it, and written down years later beside the photos, so nothing here
 * assumes where in the year it is:
 *
 * | State | Header says | Body says |
 * | --- | --- | --- |
 * | `none` | — | nothing is rendered at all |
 * | `pending` | "last place still open" | the punishment alone, unattributed |
 * | `owed` | "not done yet" | who owes it |
 * | `done` | the date, ticked | who did it |
 */
export function SeasonPunishmentPanel({
  league,
  punishment,
  teams,
  names,
  cloud,
  preset,
  onSpin,
}: {
  league: string;
  punishment: SeasonPunishment;
  /** Season-scoped rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  names: Record<string, string>;
  /** Both null when the league has no Cloudinary configured — then no media. */
  cloud: string | null;
  preset: string | null;
  /**
   * Opens the wheel for a tied vote. Absent unless there is something to spin
   * for AND somebody to spin it — the season has to have produced a last place.
   */
  onSpin?: () => void;
}) {
  const { season, state, loser } = punishment;
  const done = formatPunishmentDate(punishment.completed);

  return (
    <Panel>
      <PanelHeader
        title="Last Place Punishment"
        meta={
          state === "done" ? (
            <span className="whitespace-nowrap font-semibold text-win">
              {/* No date is a legal way to be done — see the entry type. */}
              {done ? `✓ ${done}` : "✓ Done"}
            </span>
          ) : state === "shortlist" ? (
            <span className="whitespace-nowrap font-semibold text-gold">
              Wheel of Punishments ({punishment.shortlist.length}-way tie)
            </span>
          ) : state === "owed" ? (
            <span className="whitespace-nowrap font-semibold text-loss">
              Not done yet
            </span>
          ) : (
            <span className="whitespace-nowrap text-chalk-500">
              last place still open
            </span>
          )
        }
      />

      <div className="space-y-3 px-4 py-4 sm:px-5">
        {/* ONE SENTENCE, NOT TWO STACKED LINES: who owed it and what they owed
            read as a single fact, and the panel holds exactly one of them, so
            there is no column to keep aligned. Written as inline prose rather
            than flex cells so it WRAPS on a phone the way a sentence does,
            instead of a short name column squeezing the text beside it. */}
        {/* TIED AND UNSPUN: every one of them is still possible, so they are
            listed rather than summarised. Two to five, by the league's own
            expectation, so a list costs almost nothing and picking one to show
            would be a lie. */}
        {state === "shortlist" ? (
          <>
            <p className="text-sm leading-relaxed text-chalk-300">
              Spin the wheel for one of:
            </p>
            <ul className="space-y-1">
              {punishment.shortlist.map((t) => (
                <li key={t} className="flex gap-2 text-sm text-chalk-300">
                  <span aria-hidden className="shrink-0 text-chalk-600">
                    ·
                  </span>
                  <span className="min-w-0 flex-1">{t}</span>
                </li>
              ))}
            </ul>
            {loser ? (
              <div className="flex items-baseline gap-2 pt-1">
                <span aria-hidden className="shrink-0">
                  🚽
                </span>
                <span className="text-sm font-semibold">
                  <TeamNames
                    season={season}
                    slugs={[loser]}
                    teams={teams}
                    names={names}
                    full
                  />
                </span>
                {onSpin ? (
                  <button
                    type="button"
                    onClick={onSpin}
                    className="ml-auto shrink-0 rounded border border-accent-dim/60 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
                  >
                    Spin the wheel
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
        <p className="text-sm leading-relaxed">
          <span aria-hidden className="mr-1.5">
            🚽
          </span>
          {/* NOBODY IS NAMED UNTIL THERE IS SOMEBODY TO NAME. A panel headed
              "Last Place Punishment", above a header already reading "last
              place still open", does not also need a sentence explaining that
              last place is open — it just leaves the name out, and the
              separator with it. */}
          {loser ? (
            <>
              <span className="font-semibold">
                <TeamNames
                  season={season}
                  slugs={[loser]}
                  teams={teams}
                  names={names}
                  full
                />
              </span>
              <span className="text-chalk-600"> · </span>
            </>
          ) : null}
          <span className="text-chalk-300">{punishment.punishment}</span>
        </p>
        )}

        {/* WHAT IT COULD HAVE BEEN. Smaller and quieter than the punishment
            itself — the spin already happened and these are trivia, but they are
            the trivia that makes the result feel earned. */}
        {state !== "shortlist" && punishment.shortlist.length ? (
          <p className="text-[11px] leading-relaxed text-chalk-600">
            Also in the wheel: {punishment.shortlist.join(" · ")}
          </p>
        ) : null}

        {punishment.notes ? (
          <p className="text-xs leading-relaxed text-chalk-600">
            {punishment.notes}
          </p>
        ) : null}

        {cloud && preset && state !== "pending" && state !== "shortlist" ? (
          <SeasonMedia
            cloud={cloud}
            preset={preset}
            league={league}
            season={season}
          />
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * The photos, inline rather than behind a dialog.
 *
 * THE WEEKLY LEDGER NEEDS A DIALOG because fourteen rows cannot each carry a
 * grid, and a row has to say which punishment the photos belong to. Here the
 * panel IS the punishment — there is nothing to disambiguate and nothing to
 * make room for — so a click to reach them would be a click to see the only
 * thing on the page below what is already visible.
 */
function SeasonMedia({
  cloud,
  preset,
  league,
  season,
}: {
  cloud: string;
  preset: string;
  league: string;
  season: number;
}) {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [overflow, setOverflow] = useState(false);
  const { items, seasonItems, add } = useSeasonMedia(cloud, league, season);
  const { busy, error, me, input, open } = useUploader({
    cloud,
    preset,
    league,
    season,
    // Null is what marks this as the season's own punishment rather than a
    // week's — see the context encoding in lib/cloudinary.
    week: null,
    onAdded: add,
  });

  return (
    <div className="space-y-2 border-t border-ink-700 pt-3">
      {seasonItems.length ? (
        <MediaRow
          cloud={cloud}
          items={seasonItems}
          onOpen={(index) => setViewing({ items: seasonItems, index })}
          onMore={() => setOverflow(true)}
        />
      ) : null}

      {input}

      {error ? (
        <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {/* THE FEED HAS TO HAVE LANDED before "nothing here yet" is true. Until
            then the line says nothing rather than saying something wrong. */}
        <span className="text-xs text-chalk-600">
          {items == null
            ? ""
            : seasonItems.length
              ? `${seasonItems.length} uploaded`
              : "No photos or videos yet."}
        </span>
        <button
          type="button"
          onClick={open}
          disabled={Boolean(busy)}
          className="shrink-0 rounded-md border border-ink-500 px-3 py-1.5 text-xs font-semibold text-chalk-300 transition-colors hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ?? (me ? "Add media" : "Add media (anonymous)")}
        </button>
      </div>

      {overflow ? (
        <AllMediaSheet
          cloud={cloud}
          title={`${season} last place punishment`}
          items={seasonItems}
          onOpen={(index) => setViewing({ items: seasonItems, index })}
          onClose={() => setOverflow(false)}
        />
      ) : null}

      {viewing ? (
        <Lightbox
          cloud={cloud}
          viewing={viewing}
          onIndex={(index) => setViewing((v) => v && { ...v, index })}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
