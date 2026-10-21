"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A passphrase lock for the trade pages, and signed links that open one trade
 * read-only for anyone.
 *
 * WHAT IT IS AND IS NOT. This is a static site built from a public repo, so no
 * check in the browser can stop somebody who edits the JavaScript or runs the
 * repo themselves. What it does stop is everybody else — and it does so without
 * shipping anything a coding agent can crack. A short PIN could not do that:
 * whatever the page checks against ships in its JavaScript, and ten thousand
 * PINs can be tried in minutes. A passphrase cannot be enumerated.
 *
 * ONE KEY PAIR, DERIVED FROM THE PASSPHRASE. PBKDF2-SHA256 at 600,000 rounds
 * turns the passphrase into a 32-byte seed, and the seed is an Ed25519 private
 * key. Only the PUBLIC key and the salt reach the page (build-time env, from
 * GitHub secrets, so they are not even in the repo). Unlocking re-derives the key
 * and compares public halves; nothing on the page can be used to unlock it.
 *
 * SHARE LINKS ARE SIGNED, not merely encoded. The link carries the trade and an
 * Ed25519 signature over it; the page verifies with the public key, so a link can
 * only be MADE by someone holding the passphrase, and editing any part of one —
 * a team, a player — breaks the signature and lands on the lock. The league is
 * signed too, so a Den Ops link cannot be replayed on Masterbatters.
 *
 * `scripts/trade-lock.ts` turns a passphrase into the two env values.
 */

const SALT = process.env.NEXT_PUBLIC_TRADE_LOCK_SALT?.trim() ?? "";
const PUBLIC_KEY = process.env.NEXT_PUBLIC_TRADE_LOCK_KEY?.trim() ?? "";
const LEAGUE = process.env.NEXT_PUBLIC_LEAGUE ?? "den-ops";

/** Shared with the setup script — change both or neither. */
export const KDF_ROUNDS = 600_000;
/** DER prefix that wraps a raw 32-byte Ed25519 seed as PKCS#8. */
const PKCS8_PREFIX = hex("302e020100300506032b657004220420");

/** Bytes over a plain ArrayBuffer — what WebCrypto's `BufferSource` accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Where an unlock is remembered: the derived SEED, not a flag. A flag could be
 * set from the console; the seed has to regenerate the configured public key or
 * it is ignored. Origin-wide rather than per league — one passphrase opens every
 * league's page.
 */
const STORAGE_KEY = "ff:trade-lock";

/** Lowercased and whitespace-collapsed, so a phone's autocapitalise does not lock you out. */
export const normalisePassphrase = (p: string): string =>
  p.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

export type LockStatus = "checking" | "locked" | "unlocked" | "unconfigured" | "unsupported";

export interface TradeLock {
  status: LockStatus;
  /** True when the passphrase was right. */
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  /** Sign a trade for a share link. Null unless unlocked. */
  sign: ((trade: SignedTrade) => Promise<string>) | null;
}

/** The parts of a trade a link pins down. The free-agent setting is a view, not part of it. */
export interface SignedTrade {
  a: string;
  b: string;
  give: readonly string[];
}

export function useTradeLock(): TradeLock {
  const [status, setStatus] = useState<LockStatus>("checking");
  const [seed, setSeed] = useState<Bytes | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!SALT || !PUBLIC_KEY) return setStatus("unconfigured");
      if (!(await supported())) return setStatus("unsupported");
      const stored = readStored();
      if (stored && (await publicKeyOf(stored)) === PUBLIC_KEY) {
        if (!cancelled) {
          setSeed(stored);
          setStatus("unlocked");
        }
        return;
      }
      if (!cancelled) setStatus("locked");
    })().catch(() => {
      if (!cancelled) setStatus("unsupported");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (passphrase: string) => {
    const s = await deriveSeed(passphrase);
    if ((await publicKeyOf(s)) !== PUBLIC_KEY) return false;
    try {
      window.localStorage.setItem(STORAGE_KEY, b64url(s));
    } catch {
      // Unpersisted still works for this visit.
    }
    setSeed(s);
    setStatus("unlocked");
    return true;
  }, []);

  const lock = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
    setSeed(null);
    setStatus("locked");
  }, []);

  const sign = useCallback(
    async (trade: SignedTrade) => {
      if (!seed) throw new Error("locked");
      const key = await crypto.subtle.importKey("pkcs8", pkcs8(seed), { name: "Ed25519" }, false, ["sign"]);
      const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, message(trade));
      return b64url(new Uint8Array(sig));
    },
    [seed],
  );

  return { status, unlock, lock, sign: status === "unlocked" ? sign : null };
}

/**
 * Whether `sig` is a valid signature over this trade in this league. Anyone can
 * check; only the passphrase can produce one.
 */
export async function verifyTrade(trade: SignedTrade, sig: string): Promise<boolean> {
  if (!PUBLIC_KEY || !sig) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64url(PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(sig), message(trade));
  } catch {
    return false;
  }
}

/** What gets signed. Players sorted, so the order they were ticked in does not matter. */
function message({ a, b, give }: SignedTrade): Bytes {
  return new Uint8Array(new TextEncoder().encode(`trade-v1|${LEAGUE}|${a}|${b}|${[...give].sort().join(",")}`));
}

async function deriveSeed(passphrase: string): Promise<Bytes> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalisePassphrase(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(SALT), iterations: KDF_ROUNDS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** The public half of the key a seed makes, base64url — what the page compares against. */
async function publicKeyOf(seed: Bytes): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(seed), { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return jwk.x ?? "";
}

/** Ed25519 in WebCrypto: every current browser, but not old ones. */
async function supported(): Promise<boolean> {
  try {
    await crypto.subtle.importKey("pkcs8", pkcs8(new Uint8Array(32)), { name: "Ed25519" }, false, ["sign"]);
    return true;
  } catch {
    return false;
  }
}

function readStored(): Bytes | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    const s = v ? fromB64url(v) : null;
    return s && s.length === 32 ? s : null;
  } catch {
    return null;
  }
}

const pkcs8 = (seed: Bytes): Bytes => {
  const out = new Uint8Array(PKCS8_PREFIX.length + seed.length);
  out.set(PKCS8_PREFIX);
  out.set(seed, PKCS8_PREFIX.length);
  return out;
};

function hex(s: string): Bytes {
  return new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
}

function b64url(bytes: Bytes): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
