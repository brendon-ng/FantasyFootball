"use client";

import { useEffect, useRef, useState } from "react";

import { useIdentity } from "@/components/identity";
import { Sheet } from "@/components/sheet";
import { addSuggestion } from "@/lib/punishments-live";
import type { PunishmentSuggestion } from "@/lib/punishments";

const MAX = 200;

/**
 * Put a punishment forward.
 *
 * DELIBERATELY ONE FIELD. The whole thing people are being asked for is a
 * sentence, and every extra control is another reason to close the tab instead —
 * so the textarea is focused on open, Enter submits, and attribution is handled
 * without asking a question.
 *
 * WHO IT IS FROM COMES FROM THE IDENTITY ALREADY IN LOCALSTORAGE, which the site
 * asks for once on the first visit. Nobody types their own name into a league of
 * thirteen people who all know each other. The line under the field states who it
 * will be credited to, so the auto-fill is visible rather than a surprise after
 * the fact, and the anonymous checkbox opts out.
 *
 * SOMEONE WHO NEVER PICKED A TEAM POSTS ANONYMOUSLY and is told so, rather than
 * being sent to the identity picker first. An unanswered prompt from three months
 * ago should not stand between a person and a one-line idea; the checkbox then
 * has nothing to opt out of, so it is not rendered.
 *
 * THE SERVER IS THE ONE THAT SAYS NO. Duplicate text, the wrong phase, an
 * over-long entry — all of it is rejected by the sheet with a message written to
 * be read, and that message is shown verbatim. Re-implementing those checks here
 * would mean two sets of rules to keep in step, and the client's set could be
 * skipped anyway.
 */
export function SuggestionModal({
  endpoint,
  league,
  season,
  names,
  onAdded,
  onClose,
}: {
  endpoint: string;
  league: string;
  season: number;
  names: Record<string, string>;
  onAdded: (created: PunishmentSuggestion) => void;
  onClose: () => void;
}) {
  const { identity, ready } = useIdentity();
  const me = ready && identity.kind === "owner" ? identity.slug : null;

  const [text, setText] = useState("");
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Escape and the scroll lock belong to `Sheet`; this is only the focus.
  useEffect(() => {
    field.current?.focus();
  }, []);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX && !busy;

  const submit = async (close: (after?: () => void) => void) => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const created = await addSuggestion(endpoint, {
        league,
        season,
        text: trimmed,
        suggestedBy: anon ? null : me,
      });
      close(() => {
        // Applied after the slide-down, so the new row does not appear behind a
        // sheet that is still on screen.
        onAdded(created);
        onClose();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const credited = anon || !me ? "Anonymous" : (names[me] ?? me);

  return (
    <Sheet
      label="Suggest a punishment"
      onClose={onClose}
      // `dvh`, not `vh`: on a phone `vh` is the viewport WITHOUT the browser
      // chrome, so a sheet capped in `vh` is taller than the space it has and
      // its last control sits under the address bar.
      panelClassName="max-h-[85dvh] max-w-[32rem] overflow-y-auto rounded-t-xl border border-ink-600 bg-ink-800 shadow-2xl sm:rounded-xl"
    >
      {({ close }) => (
        <>
          <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3 sm:px-5">
            <div>
              <div className="eyebrow text-[10px]">{season} suggestions</div>
              <div className="text-sm font-semibold">Suggest a punishment</div>
            </div>
            <button
              type="button"
              onClick={() => close()}
              aria-label="Close"
              className="rounded-md border border-ink-500 px-2 py-1 text-xs text-chalk-400 transition-colors hover:border-accent-dim hover:text-accent"
            >
              Close
            </button>
          </div>

          {/* The sheet runs to the bottom edge of a phone, where the home
            indicator sits over anything flush against it — so the submit button
            gets clearance on a device that has one, and nothing extra on a
            device that does not. */}
          <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-5 sm:pb-4">
            <div>
              <textarea
                ref={field}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  // Enter submits; Shift+Enter is a newline. One sentence is the
                  // expected input, so the common case should not need the mouse.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit(close);
                  }
                }}
                rows={3}
                maxLength={MAX}
                placeholder="Play a game in flip flops"
                /*
                 * 16px ON A PHONE, AND THAT IS NOT A STYLE CHOICE. iOS Safari zooms
                 * the page whenever a focused input, textarea or select computes to
                 * UNDER 16px, to make it readable — and this field is focused the
                 * moment the dialog opens, so at `text-sm` the zoom fired instantly
                 * and scaled the whole modal past the right edge of the screen. The
                 * dialog was never mis-sized; the viewport was.
                 *
                 * Fixed here rather than with `maximum-scale=1` on the viewport
                 * meta, which is the other common answer and disables pinch-zoom
                 * for the entire site.
                 *
                 * `sm:text-sm` puts it back at desktop, where nothing zooms and
                 * 16px in a dialog reads as oversized next to the page around it.
                 */
                className="w-full resize-none rounded-lg border border-ink-500 bg-ink-850 px-3 py-2.5 text-base text-chalk-100 outline-none transition-colors placeholder:text-chalk-600 focus:border-accent-dim sm:text-sm"
              />
              <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-chalk-600">
                  From <span className="text-chalk-400">{credited}</span>
                </span>
                {/* Only once it is close enough to matter — a counter from the
                  first keystroke reads as a limit being enforced on you. */}
                {trimmed.length > MAX - 40 ? (
                  <span className="tabular shrink-0 text-chalk-600">
                    {trimmed.length}/{MAX}
                  </span>
                ) : null}
              </div>
            </div>

            {me ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-chalk-400">
                <input
                  type="checkbox"
                  checked={anon}
                  onChange={(e) => setAnon(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                Submit anonymously
              </label>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-xs leading-relaxed text-loss">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void submit(close)}
              disabled={!canSubmit}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-ink-900 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add suggestion"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
