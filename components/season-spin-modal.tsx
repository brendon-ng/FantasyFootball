"use client";

import { useState } from "react";

import { Confetti } from "@/components/draw-modal";
import { Sheet } from "@/components/sheet";
import { Wheel } from "@/components/wheel";
import { spinSeasonPunishment } from "@/lib/punishments-live";

/**
 * The wheel that settles a tied last-place vote.
 *
 * THE SERVER DRAWS AND THIS ONLY REVEALS IT, exactly as the weekly draw does.
 * The pick is made uniformly inside the same lock that writes it, so spinning,
 * disliking the answer and closing the tab changes nothing; reloading to try
 * again is refused by the sheet rather than by a component; and two people
 * spinning at once cannot be handed different punishments.
 *
 * THE WRITE THEREFORE RUNS BEFORE THE ANIMATION. A rejected spin means the wheel
 * never turns and the sheet's own message is shown, instead of a result landing
 * and then being taken away.
 *
 * THE SLICES ARE FROZEN WHEN THE DIALOG OPENS — they come from a prop the feed
 * feeds, and the feed changes the moment a spin is recorded. A live list would
 * drop a slice out from under a turning wheel.
 */
export function SeasonSpinModal({
  endpoint,
  league,
  season,
  finalists,
  loserName,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  /** The tied punishments, frozen at open. */
  finalists: Array<{ id: number; text: string }>;
  loserName: string;
  onClose: () => void;
}) {
  const [spinning, setSpinning] = useState(false);
  const [landOn, setLandOn] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spin = async () => {
    setError(null);
    // FREE SPIN STARTS ON THE PRESS, covering the round trip — a motionless
    // wheel while the request is in flight reads as a tap that did not register.
    setSpinning(true);
    try {
      const { winnerId } = await spinSeasonPunishment(endpoint, {
        league,
        season,
      });
      const i = finalists.findIndex((f) => f.id === winnerId);
      if (i < 0) throw new Error("The wheel landed on something not on it.");
      setLandOn(i);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof Error ? e.message : "Could not spin.");
    }
  };

  const winner = revealed && landOn != null ? finalists[landOn] : null;

  return (
    <Sheet
      label="Wheel of Punishments"
      onClose={spinning && !revealed ? null : onClose}
      panelClassName="max-h-[92dvh] w-full max-w-[34rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <div className="relative px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-5">
          {winner ? <Confetti /> : null}

          <div className="text-center">
            <div className="eyebrow text-[10px]">{season} last place</div>
            <div className="mt-0.5 text-lg font-bold">{loserName}</div>
          </div>

          <div className="mx-auto mt-3 max-w-[20rem]">
            <Wheel
              slices={finalists}
              landOn={landOn}
              spinning={spinning}
              onRest={() => setRevealed(true)}
            />
          </div>

          {/* NOT SHOWN UNTIL THE WHEEL STOPS. Naming it while the thing is still
              turning gives the answer away and makes the spin decorative. */}
          <div className="mt-3 min-h-[3.5rem] text-center">
            {winner ? (
              <>
                <p className="text-base font-bold leading-snug text-accent">
                  {winner.text}
                </p>
                <p className="mt-1 text-[11px] text-chalk-600">
                  Recorded. This is what they owe.
                </p>
              </>
            ) : error ? (
              <p className="text-xs leading-relaxed text-loss">{error}</p>
            ) : (
              <p className="text-xs text-chalk-600">
                {finalists.length} punishments tied. One of them is theirs.
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={spinning && !revealed}
            onClick={
              winner
                ? // The feed still says the vote is unspun, and the panel behind
                  // this is a different shape once it is not.
                  () => close(() => window.location.reload())
                : () => void spin()
            }
            className="mt-2 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {winner ? "Done" : spinning ? "Spinning…" : "Spin"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
