/**
 * Turn a passphrase into the two values the trade-page lock is built with.
 *
 *   node scripts/trade-lock.ts
 *
 * Prompts for the passphrase without echoing it, then prints a fresh random
 * salt and the Ed25519 public key that passphrase derives. Store them as the
 * GitHub repo secrets TRADE_LOCK_SALT and TRADE_LOCK_KEY (and in .env.local as
 * NEXT_PUBLIC_TRADE_LOCK_SALT / NEXT_PUBLIC_TRADE_LOCK_KEY for a local build).
 *
 * NEITHER VALUE UNLOCKS ANYTHING. The passphrase is never written down; what the
 * page holds is a public key, and getting from it back to the passphrase means
 * guessing passphrases at 600,000 PBKDF2 rounds each. That is why a passphrase,
 * not a PIN: four random words cannot be enumerated, four digits can, in minutes.
 *
 * Re-running with the same passphrase gives a DIFFERENT salt and key, which
 * invalidates every share link and every remembered unlock. That is the way to
 * rotate it.
 *
 * Must match lib/trade-lock.ts: the normalisation, the round count, the PKCS#8
 * wrapping of the seed.
 */

import { createPrivateKey, createPublicKey, pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const KDF_ROUNDS = 600_000;
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const normalise = (p: string) => p.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const b64url = (b: Buffer) => b.toString("base64url");

/** Read a line without echoing it; falls back to TRADE_LOCK_PASSPHRASE for non-interactive use. */
function ask(prompt: string): Promise<string> {
  if (process.env.TRADE_LOCK_PASSPHRASE) return Promise.resolve(process.env.TRADE_LOCK_PASSPHRASE);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) out.output.write(s);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const first = normalise(await ask("Passphrase: "));
const again = normalise(await ask("Again: "));
if (first !== again) {
  console.error("The two did not match.");
  process.exit(1);
}
const words = first.split(" ").filter(Boolean).length;
if (first.length < 16 || words < 3) {
  console.error("Too short to be safe: use at least three random words and 16 characters.");
  process.exit(1);
}

const salt = randomBytes(16);
const seed = pbkdf2Sync(first, salt, KDF_ROUNDS, 32, "sha256");
const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const pub = createPublicKey(priv).export({ format: "jwk" }) as { x: string };

console.log("\nAdd these as GitHub repo secrets (Settings → Secrets and variables → Actions):\n");
console.log(`  TRADE_LOCK_SALT = ${b64url(salt)}`);
console.log(`  TRADE_LOCK_KEY  = ${pub.x}`);
console.log("\nAnd for a local build, in .env.local:\n");
console.log(`  NEXT_PUBLIC_TRADE_LOCK_SALT=${b64url(salt)}`);
console.log(`  NEXT_PUBLIC_TRADE_LOCK_KEY=${pub.x}\n`);
