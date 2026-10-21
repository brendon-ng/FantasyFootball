"use client";

import { useState } from "react";

import { BUTTON, Field, TextInput } from "@/components/form";
import { EmptyState, Panel, PanelHeader } from "@/components/ui";
import type { LockStatus, SignedTrade } from "@/lib/trade-lock";

/**
 * What a visitor without the passphrase sees instead of the trade tools.
 *
 * SAYS AS LITTLE AS POSSIBLE. No hint at what is behind it, no count of failed
 * attempts to aim at — and no limit on them either, since a limit in a browser
 * is a variable anyone can reset. The protection is the passphrase's length and
 * the 600,000 rounds each guess costs, not a lockout.
 */
export function LockScreen({
  status,
  badLink,
  onUnlock,
}: {
  status: LockStatus;
  /** Arrived with a signature that did not check out. */
  badLink: boolean;
  onUnlock: (passphrase: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  if (status === "unconfigured") {
    return (
      <Panel>
        <EmptyState>This page is not set up yet.</EmptyState>
      </Panel>
    );
  }
  if (status === "unsupported") {
    return (
      <Panel>
        <EmptyState>This browser cannot open this page. Try a current Chrome, Safari or Firefox.</EmptyState>
      </Panel>
    );
  }

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setWrong(false);
    // The key derivation takes the better part of a second on purpose; let the
    // "Checking" state paint before it starts.
    await new Promise((r) => setTimeout(r, 0));
    const ok = await onUnlock(value).catch(() => false);
    setBusy(false);
    if (!ok) setWrong(true);
  };

  return (
    <Panel className="mx-auto max-w-md">
      <PanelHeader title="Locked" />
      <form
        className="space-y-4 p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {badLink ? (
          <p className="text-[13px] text-caution">This link has been changed or is not valid.</p>
        ) : null}
        <Field label="Passphrase">
          <TextInput
            type="password"
            autoComplete="current-password"
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setWrong(false);
            }}
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-loss" aria-live="polite">
            {wrong ? "That is not it." : ""}
          </span>
          <button type="submit" disabled={busy || !value.trim()} className={BUTTON.primary}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

/**
 * Copies a signed link to this exact trade. The free-agent setting rides along
 * unsigned — it is a view the recipient may change, not part of the deal.
 */
export function ShareButton({
  sign,
  trade,
  fa,
}: {
  sign: (t: SignedTrade) => Promise<string>;
  trade: SignedTrade;
  fa: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "copied" | "failed">("idle");
  const share = async () => {
    setState("working");
    try {
      const sig = await sign(trade);
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("a", trade.a);
      url.searchParams.set("b", trade.b);
      url.searchParams.set("give", trade.give.join(","));
      if (fa) url.searchParams.set("fa", fa);
      url.searchParams.set("sig", sig);
      await navigator.clipboard.writeText(url.toString());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <button type="button" onClick={share} disabled={state === "working"} className={BUTTON.secondarySm}>
      {state === "copied" ? "Link copied" : state === "failed" ? "Could not copy" : "Copy share link"}
    </button>
  );
}
