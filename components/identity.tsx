"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { NavOwner } from "@/components/nav";

/**
 * "Who are you?" — remembered in localStorage, used to emphasise your own team
 * everywhere on the site.
 *
 * THREE STATES, and they are genuinely different:
 *
 *   unset    never answered. Show the prompt.
 *   neutral  explicitly chose to just browse. Never prompt again, no emphasis.
 *   owner    an owner slug. Emphasise them, and show "My Team" in the nav.
 *
 * Collapsing unset and neutral into one falsy value would re-prompt a browser
 * on every visit, which is exactly what they opted out of.
 *
 * HOW THE EMPHASIS WORKS. Converting every table on the site into a client
 * component to compare a slug would be a huge change for a cosmetic feature.
 * Instead this injects ONE css rule at runtime. Nearly every owner mention is
 * already a link to `/owners/<slug>/`, so an attribute selector catches them all
 * for free; `[data-owner]` covers the few places that render a name as plain
 * text, like bracket cards.
 *
 * OPT-OUTS:
 *   [data-me-exempt]  keep your own text colour — a bracket winner, a gold
 *                     champion tile.
 *   [data-me-ignore]  do not touch at all. Chrome that represents you rather
 *                     than mentioning you, like the nav's My Team link.
 *   [data-owner-tint] opt IN to a background tint instead of a recolour. Only
 *                     the bracket uses it, because there text colour is
 *                     already carrying the result.
 *
 * `[data-me-exempt]` opts an element out. Some colours already carry meaning —
 * gold for a champion, the winner tint in a bracket — and those must win. The
 * identity rule is injected after the stylesheet, so without the exclusion it
 * would silently repaint every one of them.
 */

const STORAGE_KEY = "denops:identity";

/**
 * Literal, not `var(--color-me)`.
 *
 * The injected rule is written at runtime and cannot rely on Tailwind having
 * emitted that custom property — theme tokens are tree-shaken to the utilities
 * actually used, so a refactor that drops the last `text-me` class would
 * silently resolve this to nothing and fall back to inherited white. Keep this
 * in step with `--color-me` in globals.css.
 */
const ME_COLOR = "#a78bfa";

export type Identity =
  | { kind: "unset" }
  | { kind: "neutral" }
  | { kind: "owner"; slug: string };

interface IdentityContext {
  identity: Identity;
  /** False until localStorage has been read; nothing should render on a guess. */
  ready: boolean;
  setIdentity: (next: Identity) => void;
  openPicker: () => void;
}

const Ctx = createContext<IdentityContext>({
  identity: { kind: "unset" },
  ready: false,
  setIdentity: () => {},
  openPicker: () => {},
});

export const useIdentity = () => useContext(Ctx);

/**
 * localStorage as an external store.
 *
 * `useSyncExternalStore` rather than reading in an effect: an effect that calls
 * setState on mount is a cascading render, and it also flashes the default state
 * for a frame. This returns the server snapshot during hydration and the real
 * value immediately after, and picks up changes from other tabs for free.
 */
const IDENTITY_EVENT = "denops:identity-changed";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(IDENTITY_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(IDENTITY_EVENT, onChange);
  };
}

function getRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Private mode or storage disabled — behave like a first visit, minus the
    // ability to remember the answer.
    return "";
  }
}

/** Static during the build; there is no storage to read. */
const getServerRaw = () => "";

function parse(raw: string, valid: Set<string>): Identity {
  if (raw === "neutral") return { kind: "neutral" };
  // An owner who left the league would otherwise leave a dangling identity.
  if (raw && valid.has(raw)) return { kind: "owner", slug: raw };
  return { kind: "unset" };
}

export function IdentityProvider({
  owners,
  children,
}: {
  owners: NavOwner[];
  children: React.ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const validSlugs = useMemo(() => new Set(owners.map((o) => o.slug)), [owners]);

  const raw = useSyncExternalStore(subscribe, getRaw, getServerRaw);
  const identity = useMemo(() => parse(raw, validSlugs), [raw, validSlugs]);

  // False during hydration, true on every render after. Nothing that depends on
  // stored state may render before this, or a returning visitor sees a flash of
  // the first-visit prompt.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const setIdentity = useCallback((next: Identity) => {
    setPicking(false);
    try {
      if (next.kind === "unset") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next.kind === "neutral" ? "neutral" : next.slug);
    } catch {
      // Non-fatal, but then there is nothing to notify about either.
    }
    // `storage` only fires in OTHER tabs, so this one needs an explicit nudge.
    window.dispatchEvent(new Event(IDENTITY_EVENT));
  }, []);

  const openPicker = useCallback(() => setPicking(true), []);

  const value = useMemo(
    () => ({ identity, ready, setIdentity, openPicker }),
    [identity, ready, setIdentity, openPicker],
  );

  const mySlug = identity.kind === "owner" ? identity.slug : null;

  return (
    <Ctx.Provider value={value}>
      {mySlug ? (
        <style
          // A PLAIN style element, deliberately. Giving it href + precedence
          // makes React 19 hoist and dedupe it by href — after which switching
          // identity never updates the rule, because React sees the same href
          // and skips it. The highlight then only changed on a page load.
          //
          // Keyed on the slug so the element is replaced outright rather than
          // patched, and priority comes from !important rather than placement.
          key={mySlug}
          dangerouslySetInnerHTML={{
            __html: `
/*
 * Colour is the default marker.
 *
 * The one place it cannot be used is the bracket, where text colour already
 * means won or lost, so a bracket row opts into a tint instead via
 * data-owner-tint. Everywhere else, plain violet text.
 */
[data-owner-tint="${mySlug}"] {
  background-color: color-mix(in srgb, ${ME_COLOR} 15%, transparent);
  box-shadow: inset 2px 0 0 0 ${ME_COLOR};
}
a[href$="/owners/${mySlug}/"]:not([data-me-exempt]):not([data-me-ignore]),
[data-owner="${mySlug}"]:not([data-me-exempt]):not([data-me-ignore]) {
  color: ${ME_COLOR} !important;
  font-weight: 600 !important;
}
`,
          }}
        />
      ) : null}

      {children}

      {/* Only prompt once localStorage has actually been read, so a returning
          visitor never sees a flash of the modal. */}
      {ready && (picking || identity.kind === "unset") ? (
        <IdentityPicker
          owners={owners}
          current={identity}
          onChoose={setIdentity}
          onDismiss={picking ? () => setPicking(false) : null}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function IdentityPicker({
  owners,
  current,
  onChoose,
  onDismiss,
}: {
  owners: NavOwner[];
  current: Identity;
  onChoose: (next: Identity) => void;
  /** Null on the first-visit prompt, which must be answered rather than escaped. */
  onDismiss: (() => void) | null;
}) {
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Who are you?"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink-900/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={onDismiss ?? undefined}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink-500 bg-ink-850 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-600 px-5 py-4">
          <h2 className="text-lg font-bold tracking-tight">Who are you?</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-chalk-500">
            Pick your team and we&apos;ll highlight you everywhere on the site. Saved in this
            browser only — change it any time from the nav.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px bg-ink-600">
          {owners.map((o) => {
            const active = current.kind === "owner" && current.slug === o.slug;
            return (
              <button
                key={o.slug}
                type="button"
                onClick={() => onChoose({ kind: "owner", slug: o.slug })}
                className={`px-3 py-2.5 text-left text-sm transition-colors ${
                  active
                    ? "bg-me/10 font-semibold text-me"
                    : "bg-ink-850 text-chalk-300 hover:bg-ink-700/70 hover:text-chalk-100"
                }`}
              >
                {o.name}
              </button>
            );
          })}
        </div>

        <div className="border-t border-ink-600 p-3">
          <button
            type="button"
            onClick={() => onChoose({ kind: "neutral" })}
            className={`w-full rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              current.kind === "neutral"
                ? "border-me-dim bg-me/10 text-me"
                : "border-ink-500 text-chalk-400 hover:border-ink-400 hover:text-chalk-200"
            }`}
          >
            I&apos;m just browsing
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Circular identity control for the nav.
 *
 * Marked `data-me-exempt` and excluded from the tint by carrying no
 * `data-owner`: it is chrome representing you, not a mention of you in the
 * content, and tinting it would double up with its own styling.
 */
export function IdentityBadge({ owners }: { owners: NavOwner[] }) {
  const { identity, ready, openPicker } = useIdentity();
  if (!ready) return null;

  const me = identity.kind === "owner" ? owners.find((o) => o.slug === identity.slug) : null;

  // First and last word, so "Reagan Schmidt" reads RS rather than RE.
  const initials = me
    ? (() => {
        const parts = me.name.trim().split(/\s+/);
        return (
          (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
        ).toUpperCase();
      })()
    : null;

  return (
    <button
      type="button"
      onClick={openPicker}
      title={
        me
          ? `You are ${me.name} — click to change`
          : identity.kind === "neutral"
            ? "Browsing anonymously — click to pick your team"
            : "Tell us which team is yours"
      }
      aria-label={me ? `Viewing as ${me.name}. Change.` : "Choose which team is yours"}
      data-me-ignore=""
      // A solid fill, not a tint. At 15% opacity over a near-black surface the
      // circle was effectively invisible and the initials read as loose text
      // floating in the nav.
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full transition-all ${
        me
          ? "bg-me text-ink-900 ring-2 ring-me/25 hover:ring-me/50"
          : "bg-ink-600 text-chalk-400 ring-1 ring-ink-500 hover:bg-ink-500 hover:text-chalk-100"
      }`}
    >
      {initials ? (
        // tracking adds space AFTER the last letter too, which pushes the pair
        // visibly left of centre; the indent gives that half back. The nudge
        // down accounts for uppercase sitting high in its line box.
        <span className="block translate-y-[0.5px] indent-[0.06em] text-[11px] font-bold leading-none tracking-[0.06em]">
          {initials}
        </span>
      ) : (
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="block h-[17px] w-[17px] translate-y-[0.5px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="5.6" r="2.7" />
          <path d="M2.8 13.6a5.2 5.2 0 0 1 10.4 0" />
        </svg>
      )}
    </button>
  );
}

/** Footer control for changing the answer later. */
export function IdentityControl({ owners }: { owners: NavOwner[] }) {
  const { identity, ready, openPicker } = useIdentity();
  if (!ready) return null;

  const label =
    identity.kind === "owner"
      ? (owners.find((o) => o.slug === identity.slug)?.name ?? "Unknown")
      : identity.kind === "neutral"
        ? "Just browsing"
        : "Not set";

  return (
    <button
      type="button"
      onClick={openPicker}
      className="text-[11px] text-chalk-600 transition-colors hover:text-me"
    >
      Viewing as <span className="text-me">{label}</span> · change
    </button>
  );
}
