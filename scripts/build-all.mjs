/**
 * Builds every configured league and assembles them into one `out/`.
 *
 * Each league builds into its own distDir (see next.config.ts, where a custom
 * distDir also becomes the static-export target) and is then copied to
 * `out/<slug>/`. A picker page is written at the root, which is what a visitor
 * hitting `/<repo>/` sees.
 *
 * Run with `npm run build`. `LEAGUE=<slug> npm run build:one` builds a single
 * league for quick iteration.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const LEAGUES_DIR = join(ROOT, "config", "leagues");
const STAGE = join(ROOT, ".assembled");

const leagues = readdirSync(LEAGUES_DIR)
  .filter((d) => existsSync(join(LEAGUES_DIR, d, "league.json")))
  .sort()
  .map((slug) => JSON.parse(readFileSync(join(LEAGUES_DIR, slug, "league.json"), "utf8")));

if (!leagues.length) throw new Error(`No leagues in ${LEAGUES_DIR}`);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

// SEQUENTIAL, and it has to be: Next takes a project-level build lock and refuses
// a second concurrent `next build` even with a separate distDir per league
// ("Another next build process is already running"). Parallelising would mean a
// separate checkout per league, which is not worth it — the cost is page
// generation, not the number of leagues.
for (const league of leagues) {
  const started = Date.now();
  console.log(`\n=== building ${league.name} (${league.slug}) ===`);
  execFileSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, LEAGUE: league.slug },
  });
  console.log(`=== ${league.slug} done in ${((Date.now() - started) / 1000).toFixed(1)}s ===`);
  const exported = join(ROOT, ".next", `export-${league.slug}`);
  if (!existsSync(join(exported, "index.html"))) {
    throw new Error(`${league.slug}: expected an exported site at ${exported}`);
  }
  cpSync(exported, join(STAGE, league.slug), { recursive: true });

  // `public/` is copied wholesale into every build, so each league's output would
  // otherwise carry the others' avatars. Harmless but wasteful, and it leaks one
  // league's asset into another's site.
  const avatars = join(STAGE, league.slug, "avatars");
  if (existsSync(avatars)) {
    for (const f of readdirSync(avatars)) {
      if (!f.startsWith(`${league.slug}.`)) rmSync(join(avatars, f));
    }
  }
}

mkdirSync(join(ROOT, "out"), { recursive: true });
for (const league of leagues) {
  cpSync(join(STAGE, league.slug), join(ROOT, "out", league.slug), { recursive: true });
}

// Pages skips Jekyll for Actions deploys, but this protects the `_next`
// directory if the source is ever flipped to a branch deploy.
writeFileSync(join(ROOT, "out", ".nojekyll"), "");

const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "DenOpsFF";
const base = `/${repo}`;
// Read from the assembled output rather than public/, so the picker can only
// reference an avatar that actually shipped. The extension varies by league —
// Sleeper stores whatever was uploaded.
const avatarFor = (slug) => {
  for (const ext of ["png", "jpg", "gif"]) {
    if (existsSync(join(ROOT, "out", slug, "avatars", `${slug}.${ext}`))) {
      return `${base}/${slug}/avatars/${slug}.${ext}`;
    }
  }
  return null;
};

const cards = leagues
  .map((l) => {
    const src = avatarFor(l.slug);
    // Falls back to initials so a league with no avatar set on Sleeper still gets
    // a card the same shape as the others.
    const badge = src
      ? `<img class="avatar" src="${src}" alt="" width="48" height="48" loading="lazy">`
      : `<span class="avatar fallback">${l.shortName.slice(0, 2).toUpperCase()}</span>`;
    return `      <a class="card" href="${base}/${l.slug}/">
        ${badge}
        <span class="text">
          <span class="name">${l.name}</span>
          <span class="meta">${l.features?.keepers ? "Keeper league" : "Redraft league"}</span>
        </span>
      </a>`;
  })
  .join("\n");

// Hand-written rather than a third Next build: it has no data behind it, and a
// build to render two links would double CI time for nothing.
writeFileSync(
  join(ROOT, "out", "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fantasy Football</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#08080a; color:#f4f4f6;
         font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { width:100%; max-width:34rem; padding:2rem 1.5rem; }
  h1 { margin:0 0 .25rem; font-size:1.5rem; letter-spacing:-.02em; }
  p { margin:0 0 1.75rem; color:#7a7a89; font-size:.875rem; }
  .card { display:flex; align-items:center; gap:.9rem; padding:.9rem 1.1rem;
          margin-bottom:.75rem; border:1px solid #1e1e25; border-radius:.75rem;
          background:#0e0e11; text-decoration:none; color:inherit;
          transition:border-color .15s, background .15s; }
  .avatar { width:48px; height:48px; flex:0 0 48px; border-radius:.6rem;
            object-fit:cover; background:#16161b; }
  .fallback { display:grid; place-items:center; font-size:.8rem; font-weight:700;
              letter-spacing:.04em; color:#7a7a89; }
  .text { display:flex; flex-direction:column; gap:.2rem; min-width:0; }
  .card:hover { border-color:#0b7a5a; background:#16161b; }
  .name { font-weight:600; }
  .meta { font-size:.6875rem; letter-spacing:.14em; text-transform:uppercase; color:#55555f; }
</style>
</head>
<body>
  <main>
    <h1>Fantasy Football</h1>
    <p>Pick a league.</p>
${cards}
  </main>
</body>
</html>
`,
);

console.log(`\nAssembled ${leagues.length} league(s) into out/ — ${leagues.map((l) => l.slug).join(", ")}`);
