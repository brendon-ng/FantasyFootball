"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * The trade pages' form controls, in one place so they line up.
 *
 * ONE HEIGHT FOR EVERYTHING THAT SITS IN A ROW. Selects, inputs, segmented
 * controls and buttons are all `h-9` (`h-8` in the compact size), so any two
 * placed side by side share a top and a bottom. Before this each control set
 * its own padding and they drifted by a few pixels each — team pickers taller
 * than the count pickers, a sort button shorter than the select beside it.
 *
 * ONE LABEL STYLE, ALWAYS ABOVE. The eyebrow, `mb-1.5`. Labels beside a control
 * made a row's baseline depend on its label's length.
 *
 * A VISIBLE FOCUS RING ON KEYBOARD FOCUS ONLY (`focus-visible`), replacing the
 * browser's outline, which drew a white box around a tab after every click.
 *
 * Text stays `text-base` below `sm`: anything under 16px zooms iOS on focus.
 * See "A text field under 16px zooms iOS" in AGENTS.md.
 */

const FOCUS =
  "focus:outline-none focus-visible:border-accent-dim focus-visible:ring-1 focus-visible:ring-accent-dim";

/** Number inputs without the browser's spinner, which takes width and is unusable on a phone. */
const NO_SPIN =
  "tabular [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/**
 * A field's classes. The colour is chosen here rather than overridden by the
 * caller: two border colours on one element leave the winner to stylesheet
 * order, which is not something to depend on.
 */
export function fieldClass(
  size: "md" | "sm" = "md",
  tone: "default" | "caution" = "default",
  number = false,
): string {
  const color =
    tone === "caution"
      ? "border-caution/60 text-caution placeholder:text-caution/50"
      : "border-ink-500 text-chalk-100 placeholder:text-chalk-600 hover:border-ink-400";
  return `${size === "sm" ? "h-8 px-2" : "h-9 px-3"} w-full min-w-0 rounded-lg border bg-ink-850 text-base transition-colors sm:text-sm ${color} ${FOCUS} ${number ? NO_SPIN : ""}`;
}

export const FIELD = fieldClass("md");
export const FIELD_SM = fieldClass("sm");

export const BUTTON = {
  primary: `inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-accent-dim bg-accent/10 px-4 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`,
  secondary: `inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ink-500 bg-ink-850 px-3 text-[13px] text-chalk-300 transition-colors hover:border-ink-400 hover:text-chalk-100 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`,
  secondarySm: `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ink-500 bg-ink-850 px-2.5 text-xs text-chalk-400 transition-colors hover:border-ink-400 hover:text-chalk-100 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`,
  danger: `inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-ink-500 bg-ink-850 px-2.5 text-xs text-chalk-400 transition-colors hover:border-loss/60 hover:text-loss ${FOCUS}`,
};

const Label = ({ children }: { children: ReactNode }) => (
  <span className="eyebrow mb-1.5 block truncate text-[10px]">{children}</span>
);

/** A labelled control. A `<label>`, so clicking the label focuses the field. */
export function Field({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <Label>{label}</Label>
      {children}
    </label>
  );
}

/**
 * The same, for things that are not one field — a chip list, a segmented
 * control, a pair of selects — where wrapping a `<label>` would point it at
 * whichever control happened to come first.
 */
export function FieldGroup({
  label,
  children,
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="group" className={`min-w-0 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/**
 * A native select drawn to match the inputs. `appearance-none` drops the
 * platform's arrow, which sat hard against the border in Chrome and at a
 * different inset everywhere else, so one is drawn here instead — 12px in from
 * the edge, with the text padded clear of it.
 */
export function Select({
  className = "",
  size = "md",
  children,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: "md" | "sm" }) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <select {...rest} className={`${size === "sm" ? FIELD_SM : FIELD} cursor-pointer appearance-none pr-9`}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chalk-500"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function TextInput({
  className = "",
  size = "md",
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: "md" | "sm" }) {
  return (
    <input
      {...rest}
      className={`${fieldClass(size, "default", rest.type === "number")} ${className}`}
    />
  );
}

/**
 * A row of mutually exclusive buttons — tabs, or a radio group.
 *
 * `fill` stretches it to its container with equal segments, which is what lets
 * it sit in a grid cell beside a select of the same width.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  kind = "radio",
  fill = false,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: ReactNode; hint?: string }>;
  onChange: (v: T) => void;
  label: string;
  kind?: "radio" | "tab";
  fill?: boolean;
}) {
  return (
    <div
      role={kind === "tab" ? "tablist" : "radiogroup"}
      aria-label={label}
      className={`${fill ? "flex w-full" : "inline-flex"} h-9 max-w-full items-stretch gap-0.5 overflow-x-auto rounded-lg border border-ink-500 bg-ink-850 p-0.5`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role={kind === "tab" ? "tab" : "radio"}
            aria-checked={kind === "radio" ? on : undefined}
            aria-selected={kind === "tab" ? on : undefined}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`${fill ? "flex-1" : ""} shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-dim ${
              on ? "bg-ink-600 text-chalk-100" : "text-chalk-500 hover:text-chalk-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
