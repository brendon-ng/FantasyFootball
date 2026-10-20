"use client";

import { useMemo, useState } from "react";

import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import { normalise } from "@/lib/player-match";
import type { OverridesApi } from "@/lib/projection-overrides";

/**
 * Hand-set weekly projections for any player — on a roster or not, in the trade
 * or not.
 *
 * EACH CELL SHOWS SLEEPER'S NUMBER AS ITS PLACEHOLDER, so an empty cell reads as
 * "using the projection" and a filled one as "using mine", without a second
 * column to compare against. Clearing a cell returns it to Sleeper.
 *
 * CELLS COMMIT ON BLUR OR ENTER, not per keystroke: every edit re-runs twenty
 * thousand simulated seasons, and "1." on the way to "1.5" is not a number
 * anyone meant.
 */
export function ProjectionOverridesPanel({
  api,
  weeks,
  sleeper,
  candidates,
  nameOf,
  positionOf,
  nflTeamOf,
  holderOf,
}: {
  api: OverridesApi;
  weeks: readonly number[];
  /** Sleeper's own projections, before any override. */
  sleeper: Record<number, Record<string, number>>;
  /** Every player the search can find. */
  candidates: readonly string[];
  nameOf: (id: string) => string;
  positionOf: (id: string) => string | null;
  nflTeamOf: (id: string) => string | null;
  /** Who rosters him, or null for a free agent. */
  holderOf: (id: string) => string | null;
}) {
  const [query, setQuery] = useState("");
  const pinned = Object.keys(api.overrides);

  const average = (id: string) => {
    const known = weeks.filter((w) => sleeper[w]);
    return known.length ? known.reduce((s, w) => s + (sleeper[w][id] ?? 0), 0) / known.length : 0;
  };

  const results = useMemo(() => {
    const q = normalise(query);
    if (q.length < 2) return [];
    return candidates
      .filter((id) => !api.overrides[id] && normalise(nameOf(id)).includes(q))
      .map((id) => ({ id, avg: average(id) }))
      .sort((x, y) => y.avg - x.avg)
      .slice(0, 8);
    // `average` closes over `weeks` and `sleeper`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, candidates, api.overrides, nameOf, weeks, sleeper]);

  return (
    <Panel>
      <PanelHeader
        title="Projection overrides"
        meta={api.activeCount ? `${api.activeCount} active` : undefined}
        legend="Your own number for any player, any week. Saved in this browser and applied to every trade — a shared link does not carry them."
      />
      <div className="relative border-b border-ink-600 px-4 py-3 sm:px-5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a player to override…"
          aria-label="Find a player"
          className="w-full rounded-lg border border-ink-500 bg-ink-850 px-3 py-2 text-base text-chalk-100 placeholder:text-chalk-600 sm:text-sm"
        />
        {results.length ? (
          <ul className="mt-2 divide-y divide-ink-700 overflow-hidden rounded-lg border border-ink-600">
            {results.map(({ id, avg }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    api.pin(id);
                    setQuery("");
                  }}
                  className="flex w-full items-baseline gap-2 bg-ink-850 px-3 py-2 text-left text-[13px] text-chalk-300 transition-colors hover:bg-ink-700"
                >
                  <span className="w-8 shrink-0 text-[10px] font-bold uppercase text-chalk-600">{positionOf(id) ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                  <span className="shrink-0 text-[11px] text-chalk-600">
                    {nflTeamOf(id) ?? ""} · {holderOf(id) ?? "Free agent"}
                  </span>
                  <span className="w-10 shrink-0 text-right tabular text-[12px] text-chalk-500">{avg.toFixed(1)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {pinned.length ? (
        <ul className="divide-y divide-ink-600">
          {pinned.map((id) => (
            <OverrideRow
              key={id}
              id={id}
              weeks={weeks}
              sleeper={sleeper}
              mine={api.overrides[id] ?? {}}
              api={api}
              label={`${nameOf(id)}`}
              meta={`${positionOf(id) ?? "—"} · ${nflTeamOf(id) ?? "FA"} · ${holderOf(id) ?? "Free agent"}`}
            />
          ))}
        </ul>
      ) : (
        <EmptyState>No overrides. Every lineup uses Sleeper&rsquo;s projections.</EmptyState>
      )}

      {pinned.length ? (
        <div className="flex justify-end border-t border-ink-600 px-4 py-2 sm:px-5">
          <button
            type="button"
            onClick={api.clearAll}
            className="rounded-md border border-ink-500 px-2.5 py-1 text-xs text-chalk-400 transition-colors hover:border-loss/60 hover:text-loss"
          >
            Clear every override
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function OverrideRow({
  id,
  weeks,
  sleeper,
  mine,
  api,
  label,
  meta,
}: {
  id: string;
  weeks: readonly number[];
  sleeper: Record<number, Record<string, number>>;
  mine: Record<string, number>;
  api: OverridesApi;
  label: string;
  meta: string;
}) {
  const edited = Object.keys(mine).length;
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-chalk-200">{label}</div>
          <div className="text-[11px] text-chalk-600">{meta}</div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-chalk-500">
          All weeks
          <NumberCell
            value={null}
            placeholder="—"
            onCommit={(v) => api.setWeeks(id, weeks, v)}
            label={`${label}, every week`}
            clearOnCommit
          />
        </label>
        {edited ? (
          <button
            type="button"
            onClick={() => api.setWeeks(id, weeks, null)}
            className="rounded-md border border-ink-500 px-2 py-1 text-[11px] text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
          >
            Reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => api.remove(id)}
          aria-label={`Remove ${label}`}
          className="rounded-md border border-ink-500 px-2 py-1 text-[11px] text-chalk-400 transition-colors hover:border-loss/60 hover:text-loss"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-11">
        {weeks.map((w) => {
          const v = mine[String(w)];
          const base = sleeper[w]?.[id];
          return (
            <label key={w} className="min-w-0">
              <span className="block text-[10px] text-chalk-600">Wk {w}</span>
              <NumberCell
                value={typeof v === "number" ? v : null}
                placeholder={base != null ? base.toFixed(1) : "0.0"}
                onCommit={(next) => api.setWeek(id, w, next)}
                label={`${label}, week ${w}`}
                highlighted={typeof v === "number"}
              />
            </label>
          );
        })}
      </div>
    </li>
  );
}

/**
 * A number field that commits on blur or Enter.
 *
 * UNCONTROLLED, KEYED ON THE STORED VALUE: it remounts whenever the value
 * changes from outside ("All weeks", Reset), and otherwise leaves the reader's
 * half-typed text alone.
 */
function NumberCell({
  value,
  placeholder,
  onCommit,
  label,
  highlighted = false,
  clearOnCommit = false,
}: {
  value: number | null;
  placeholder: string;
  onCommit: (v: number | null) => void;
  label: string;
  highlighted?: boolean;
  /** A one-shot field — "All weeks" — that empties once applied. */
  clearOnCommit?: boolean;
}) {
  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      if (value != null) onCommit(null);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n) && n !== value) onCommit(Math.round(n * 100) / 100);
  };
  return (
    <input
      key={value ?? "none"}
      type="number"
      inputMode="decimal"
      step="0.1"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      aria-label={label}
      onBlur={(e) => {
        commit(e.target.value);
        if (clearOnCommit) e.target.value = "";
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`w-full min-w-0 appearance-none rounded-md border bg-ink-850 px-2 py-1 text-base tabular sm:w-16 sm:text-sm ${
        highlighted ? "border-caution/60 text-caution" : "border-ink-500 text-chalk-100 placeholder:text-chalk-600"
      }`}
    />
  );
}
