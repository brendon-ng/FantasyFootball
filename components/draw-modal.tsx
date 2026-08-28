"use client";

import { useEffect, useMemo, useState } from "react";

import { useIdentity } from "@/components/identity";
import { Sheet } from "@/components/sheet";
import { TeamNames } from "@/components/punishment-ledger";
import { Wheel } from "@/components/wheel";
import { useWeekScore } from "@/lib/live";
import type { LeagueRef } from "@/lib/league-ref";
import { drawPunishment } from "@/lib/punishments-live";
import {
  primaryOwner,
  type PunishmentSuggestion,
  type TeamMap,
} from "@/lib/punishments";

/** The dataviz palette again, so the confetti is the wheel's own colours. */
const HUES = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
];

/**
 * Spin for a week's punishment.
 *
 * THE DRAW IS THE SERVER'S, and it happens the moment the button is pressed —
 * before a single frame of animation. The wheel then spins to the answer that
 * is already written down. Spinning, disliking the result and closing the tab
 * therefore changes nothing, and reloading to try again is refused by the sheet
 * rather than by this component.
 *
 * It also means a failed write costs nothing: the wheel simply never spins and
 * the sheet's own message is shown, instead of a result landing and then being
 * taken away.
 *
 * ADDRESSED BY URL — `?draw=1&week=5&loser=<slug>` — so it can be linked to
 * before there is any navigation to it, and so a half-finished draw survives a
 * reload.
 */
export function DrawModal({
  endpoint,
  league,
  season,
  week,
  losers,
  pool,
  teams,
  names,
  loading,
  unavailable,
  leagueRef,
  userIdToSlug,
  documentTitle,
  alreadyDrawn,
  onDrawn,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  week: number;
  /** Resolved by the caller: derived where known, the URL's value otherwise. */
  losers: string[];
  pool: PunishmentSuggestion[];
  teams: TeamMap;
  names: Record<string, string>;
  /** The feed has not arrived yet; the dialog opens anyway. */
  loading: boolean;
  /** Loaded, but this week cannot be drawn for. Rendered instead of the wheel. */
  unavailable: string | null;
  /** For looking the scoreline up live. */
  leagueRef: LeagueRef | null;
  userIdToSlug: Record<string, string>;
  /** Already composed with the league's short name by the page. */
  documentTitle: string;
  /** Set when this week was drawn before the dialog was opened. */
  alreadyDrawn: PunishmentSuggestion | null;
  onDrawn: (punishmentId: number) => void;
  onClose: () => void;
}) {
  /**
   * LOCKED AT SPIN TIME, NOT AT MOUNT.
   *
   * Both of these have to stop tracking the feed, because this dialog CHANGES
   * the feed the moment the server answers: the drawn punishment leaves the
   * pool, which would pull a slice out from under a turning wheel, and
   * `alreadyDrawn` fills in, which revealed the text mid-spin and suppressed
   * the confetti.
   *
   * But freezing at mount is wrong now that the dialog opens before the feed
   * has arrived — it would freeze an empty pool. Spinning is the moment the
   * data must stop moving, and it is also the moment there is definitely data.
   */
  const [locked, setLocked] = useState<PunishmentSuggestion[] | null>(null);
  const [spun, setSpun] = useState(false);

  const wasDrawn = spun ? null : alreadyDrawn;
  const slices =
    locked ??
    (alreadyDrawn ? [...pool, alreadyDrawn] : pool)
      .filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i)
      .sort((a, b) => a.id - b.id);
  const settledAt = wasDrawn
    ? slices.findIndex((p) => p.id === wasDrawn.id)
    : null;

  /**
   * The scoreline, live from the provider and BOTH SIDES OF IT.
   *
   * A draw happens in the days after a week and before the archive run, so the
   * derived score is usually missing exactly when this screen wants it.
   *
   * IT IS DELIBERATELY NOT THE DERIVED ONE EVEN WHERE THAT EXISTS. The derived
   * figure is the week's LEAGUE LOW, keyed to whoever the archive says lost —
   * so if the URL names somebody else, it would print a number that is not
   * theirs beside their name. Looked up here by the same slug the heading
   * renders, so the name and the score cannot disagree.
   */
  const live = useWeekScore(leagueRef, week, losers[0] ?? null, userIdToSlug);
  const score = live?.points ?? null;

  /**
   * THE TAB SAYS WHAT IS ON SCREEN.
   *
   * The route's own title is baked at build time and cannot know about a query
   * parameter, and this dialog is a different thing from the page underneath
   * it — worth naming when the draw is what got shared or bookmarked. Restored
   * on close, so dismissing the wheel puts the page's own title back.
   */
  useEffect(() => {
    const previous = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previous;
    };
  }, [documentTitle]);

  const [spinning, setSpinning] = useState(false);
  const [landOn, setLandOn] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<PunishmentSuggestion | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Who the viewer is, when that is somebody other than the loser. */
  const [confirm, setConfirm] = useState<string | null>(null);

  const { identity, ready: identityReady, openPicker } = useIdentity();

  /**
   * IS THIS THE PERSON WHOSE WHEEL THIS IS?
   *
   * COMPARED AS TEAMS, NOT PEOPLE. Thomas spinning a wheel keyed to Robbie is
   * not a mistake — it is one team with two people on it — so both sides go
   * through `primaryOwner` first. Season-scoped, because they share a team in
   * one year and not the next.
   *
   * Null when there is nothing to object to: no stored identity, somebody who
   * has chosen not to say, or a match.
   */
  const mismatch = (who: typeof identity): string | null => {
    if (who.kind !== "owner" || !losers.length) return null;
    const mine = primaryOwner(teams, season, who.slug);
    const theirs = primaryOwner(teams, season, losers[0]);
    return mine === theirs ? null : (names[who.slug] ?? who.slug);
  };

  /**
   * THE WHEEL STARTS BEFORE THE SERVER ANSWERS.
   *
   * `setSpinning` first, then the write: the free spin covers the round trip,
   * so there is no second of a motionless wheel wondering whether the tap
   * registered. When the answer lands the wheel decelerates onto it.
   *
   * Setting it first is also the guard against a double press — the previous
   * version only became busy once the request resolved, so two taps sent two
   * draws and the second came back "already drawn", painting an error over a
   * result that had in fact succeeded.
   */
  /**
   * The identity check in front of the spin.
   *
   * A WARNING, NEVER A BLOCK. Someone else genuinely may be running the draw —
   * the loser is not always at a keyboard — so this only catches a mis-click.
   * Anyone who has not said who they are is asked first, since the answer is
   * what makes the check possible; declining is a fine answer and simply spins,
   * because there is then nothing to compare.
   */
  const requestSpin = () => {
    if (spinning || !slices.length) return;
    if (
      !identityReady ||
      identity.kind === "unset" ||
      identity.kind === "neutral"
    ) {
      openPicker((chosen) => {
        const other = mismatch(chosen);
        if (other) setConfirm(other);
        else void spin();
      });
      return;
    }
    const other = mismatch(identity);
    if (other) setConfirm(other);
    else void spin();
  };

  const spin = async () => {
    if (spinning || !slices.length) return;
    setConfirm(null);
    setError(null);
    // Both before the await: from here the feed may move and must be ignored.
    setLocked(slices);
    setSpun(true);
    setSpinning(true);
    try {
      const drawn = await drawPunishment(endpoint, {
        league,
        season,
        week,
        loser: losers.join(","),
      });
      onDrawn(drawn.punishmentId);
      const index = slices.findIndex((p) => p.id === drawn.punishmentId);
      // The wheel can only point at a slice it has. If the pool moved under us —
      // somebody else drew while this sat open — the result still stands, so it
      // is shown outright rather than pretended away.
      if (index < 0) {
        setSpinning(false);
        setFallback(drawn.text ?? `Punishment #${drawn.punishmentId}`);
        return;
      }
      setLandOn(index);
    } catch (e) {
      // Nothing was drawn, so the wheel stops where it is and resets.
      setSpinning(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  const result = wasDrawn?.text ?? revealed?.text ?? fallback;

  return (
    <Sheet
      label="Draw a punishment"
      // Not dismissible mid-spin: the result is already saved, so leaving now
      // would hide something that has happened.
      onClose={(spinning && !result) || confirm ? null : onClose}
      panelClassName="max-h-[92dvh] max-w-[46rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          {result && !wasDrawn ? <Confetti /> : null}

          {/* LAYERED, NOT INLINE. Swapped in where the button was, the warning
              is two lines taller than the control it replaced, so the panel
              resized and the wheel jumped up the screen the moment it appeared.
              A dialog of its own leaves everything underneath exactly where it
              was. Above this one in the stack, and the outer sheet stops
              answering Escape while it is up, or one key would dismiss both. */}
          {confirm ? (
            <Sheet
              label="This is not your draw"
              onClose={() => setConfirm(null)}
              zClassName="z-[60]"
              panelClassName="max-w-[24rem] rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
            >
              {({ close: closeConfirm }) => (
                <div className="space-y-4 px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5">
                  <p className="text-sm leading-relaxed text-chalk-300">
                    You are browsing as{" "}
                    <strong className="text-gold">{confirm}</strong>, but this
                    draw is for{" "}
                    <strong className="text-chalk-100">
                      <TeamNames
                        season={season}
                        slugs={losers}
                        teams={teams}
                        names={names}
                      />
                    </strong>
                    .
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => closeConfirm()}
                      className="rounded-lg border border-ink-500 px-4 py-2 text-sm font-medium text-chalk-400 transition-colors hover:border-ink-400 hover:text-chalk-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => closeConfirm(() => void spin())}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-ink-900 transition-opacity hover:opacity-90"
                    >
                      Spin anyway
                    </button>
                  </div>
                </div>
              )}
            </Sheet>
          ) : null}

          <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3 sm:px-5">
            <div className="text-sm font-semibold">Wheel of Punishments</div>
            <button
              type="button"
              onClick={() => close()}
              disabled={spinning && !result}
              aria-label="Close"
              className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent disabled:opacity-40"
            >
              Close
            </button>
          </div>

          <div className="space-y-5 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6">
            {/* WHO AND WHEN LEAD THE CONTENT rather than sitting in the header
                strip. This is the one screen where the person matters more than
                the page they are on, and a name at chip size beside a Close
                button reads as breadcrumb. */}
            <div className="text-center">
              <div className="eyebrow">
                {season} · Week {week}
              </div>
              <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                <TeamNames
                  season={season}
                  slugs={losers}
                  teams={teams}
                  names={names}
                />
              </h2>
              {/* THE LOSING SCORE LEADS, and the opponent trails it at a
                  smaller size. This screen is about one team's bad week — the
                  other side is context for how bad, not a result being
                  reported. Nothing at all while the lookup is in flight or if
                  it fails; an absent line beats a hedge about why there is no
                  number. */}
              {score != null ? (
                <p className="mt-1.5 flex flex-wrap items-baseline justify-center gap-x-2">
                  <span className="tabular text-lg font-bold text-loss">
                    {score.toFixed(2)} <span aria-hidden>🚽</span>
                  </span>
                  {live?.opponentPoints != null ? (
                    <span className="text-xs text-chalk-500">
                      vs{" "}
                      {live.opponentSlug ? (
                        <TeamNames
                          season={season}
                          slugs={[live.opponentSlug]}
                          teams={teams}
                          names={names}
                        />
                      ) : null}{" "}
                      <span className="tabular font-semibold text-chalk-400">
                        {live.opponentPoints.toFixed(2)}
                      </span>
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>

            {loading ? (
              /* OPENED STRAIGHT FROM A URL, so the wheel is drawn as a disc
                 before there is a pool to divide it into. The heading above is
                 already real — the week and the loser come from the address
                 bar — so only the wheel and the button are actually waiting.

                 STRUCTURALLY IDENTICAL TO THE LOADED STATE, down to the
                 `min-h-[5.5rem]` under the wheel: a fragment so the parent's
                 own spacing applies between the two, and the same reserved
                 block for the button. Wrapping the pill in a plain centred row
                 instead left the dialog 40px short, so it grew as the feed
                 landed — which is the jump a skeleton is for avoiding. */
              <>
                <div className="skeleton mx-auto aspect-square w-full max-w-[20rem] rounded-full" />
                <div className="min-h-[5.5rem] text-center">
                  <div className="skeleton mx-auto h-12 w-[13.75rem] rounded-full" />
                </div>
              </>
            ) : unavailable ? (
              <p className="py-8 text-center text-sm text-chalk-500">
                {unavailable}
              </p>
            ) : !slices.length ? (
              <p className="py-8 text-center text-sm text-chalk-500">
                Every punishment in the pool has been handed out.
              </p>
            ) : (
              <>
                <Wheel
                  slices={slices}
                  landOn={landOn}
                  spinning={spinning}
                  settledAt={settledAt}
                  onRest={() =>
                    setRevealed(
                      landOn == null ? null : (slices[landOn] ?? null),
                    )
                  }
                />

                <div className="min-h-[5.5rem] text-center">
                  {result ? (
                    <>
                      {/* JUST THE PUNISHMENT, however it got there. The wheel
                          is sitting on the answer and the confetti already says
                          whether this just happened — a label above and a
                          caption below only crowd the one line anyone is
                          reading, and made a fresh draw and a revisited one
                          look like different screens when they are the same
                          screen at different times. */}
                      <p className="mx-auto max-w-lg text-xl font-bold leading-snug text-chalk-100 sm:text-2xl">
                        {result}
                      </p>
                    </>
                  ) : error ? (
                    <div className="mx-auto max-w-lg rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                      {error}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={requestSpin}
                      disabled={spinning}
                      className="rounded-full bg-accent px-8 py-3 text-base font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {spinning ? "Spinning…" : "Spin the wheel"}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * A scatter that looks random and is not.
 *
 * `Math.random()` during render is impure — React may re-run a render, and the
 * confetti would then re-scatter and restart its fall halfway down. A hash of
 * the piece's index gives the same visual disorder from a pure function, and
 * has the same side benefit as the draft board's seeded shuffle: a screenshot
 * is reproducible.
 */
const scatter = (i: number, salt: number) => {
  const x = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Forty pieces, each with its own drift, spin, delay and duration. */
export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        i,
        left: scatter(i, 1) * 100,
        drift: `${(scatter(i, 2) - 0.5) * 240}px`,
        spin: `${scatter(i, 3) * 1080 - 360}deg`,
        fall: `${2200 + scatter(i, 4) * 1600}ms`,
        delay: `${scatter(i, 5) * 400}ms`,
        hue: HUES[i % HUES.length],
      })),
    [],
  );

  return (
    <div
      aria-hidden
      // Fixed, not absolute: the panel is a scroll container, and confetti
      // confined to it would fall two inches and stop.
      className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
    >
      {pieces.map((p) => (
        <span
          key={p.i}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              background: p.hue,
              animationDelay: p.delay,
              "--drift": p.drift,
              "--spin": p.spin,
              "--fall": p.fall,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
