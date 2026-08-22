import Link from "next/link";

import { Tip } from "@/components/tooltip";
import { Col, ListHeader, Skeleton } from "@/components/ui";
import {
  formatCompleted,
  teamFor,
  type LedgerRow,
  type TeamMap,
} from "@/lib/punishments";

/**
 * The people on a team, each their own link.
 *
 * A CO-OWNED TEAM IS NAMED IN FULL — "Robbie & Thomas", not just the primary
 * owner the low is keyed to. Both of them lost that week and both owe the
 * punishment, so naming one is simply wrong.
 *
 * Each name is a separate link and carries its own `data-owner`, the same way
 * the finish timeline splits a shared label: the team is one thing, but the
 * people are two, and identity highlighting has to be able to pick one of them
 * out. A joined string would light up both for whoever is browsing.
 */
export function TeamNames({
  season,
  slugs,
  teams,
  names,
  full = false,
}: {
  season: number;
  slugs: string[];
  teams: TeamMap;
  names: Record<string, string>;
  /**
   * Keep the full name at every width.
   *
   * THE ABBREVIATION IS A COLUMN'S PROBLEM, NOT A PHONE'S. Dropping to a first
   * name buys width, which the ledger's 64px cell badly needs and a panel
   * running the width of the card does not — there it just loses a surname for
   * nothing. So the default stays put for the caller that needs it and anywhere
   * with room opts out.
   */
  full?: boolean;
}) {
  if (!slugs.length) return <span className="text-chalk-600">—</span>;
  const people = slugs.flatMap((slug) => teamFor(teams, names, season, slug));
  return (
    <>
      {people.map((p, i) => (
        <span key={`${p.slug}-${i}`}>
          {i > 0 ? <span className="text-chalk-600"> &amp; </span> : null}
          <Link
            href={`/owners/${p.slug}/`}
            data-owner={p.slug}
            className="font-medium transition-colors hover:text-accent"
          >
            {/* FIRST NAME ONLY ON A PHONE. "Josh Greene…" truncated tells you
                less than "Josh" complete, and the width it frees is what lets
                the media control sit on the row at all. */}
            {full ? (
              p.label
            ) : (
              <>
                <span className="sm:hidden">{p.first}</span>
                <span className="hidden sm:inline">{p.label}</span>
              </>
            )}
          </Link>
        </span>
      ))}
    </>
  );
}

/**
 * Which week drew which punishment, and whether it has been served.
 *
 * THE ONE RENDERER for a ledger row. It appears on `/punishments/` and on a
 * season's own page, and the site has been bitten before by two renderers for
 * the same thing drifting apart — which is why lineups live only on the matchup
 * page. Same rule here.
 *
 * ONE LINE PER ROW ON A DESKTOP. Fourteen rows is a table, and a table that
 * spends two lines a row reads as a feed of events rather than a season at a
 * glance.
 *
 * ON A PHONE THE PUNISHMENT WRAPS INSTEAD OF TRUNCATING. The text runs to a full
 * sentence and there is no width to spare, so a single line showed "Take a selfie
 * with the bar…" — the row would name a punishment nobody could read. Wrapping
 * costs height, which a phone has, rather than meaning, which it does not. The
 * columns align to the TOP once a cell can be several lines tall; centring them
 * against a three-line cell floats the week number into the middle of nowhere.
 *
 * The column widths live in `COL` because a `ListHeader` cell has to repeat the
 * width class of the row cell beneath it — these lists are flex rows, not
 * `<table>`s, so a header does not come for free. One definition each, or the
 * columns drift apart the first time one of them is tweaked.
 *
 * NO 🚽 GLYPH ON A ROW. Every row in this table is a weekly low by construction,
 * so marking each one says nothing and costs width the punishment needs.
 */
const COL = {
  week: "w-7 shrink-0",
  owner: "w-16 shrink-0 sm:w-40",
  punishment: "min-w-0 flex-1",
  /**
   * ITS OWN COLUMN, which it could not afford before.
   *
   * A sixth fixed column once left the punishment 48px on a phone. Showing
   * first names instead of full ones, and tightening the gaps, gave back 48px
   * between them — so the control gets a real column and a real heading, and
   * the punishment still has more room than it started with.
   */
  media: "w-6 shrink-0 text-center sm:w-8",
  // Supporting detail, and the first thing to go when a phone runs out of room:
  // who owes what survives without it, and the punishment text does not.
  score: "hidden w-16 shrink-0 text-right sm:block",
  /**
   * NARROWER ON A PHONE, because the widest thing it ever holds is "✓ Nov 10"
   * at about 50px — the rest was slack sitting between this column and the one
   * before it, reading as a gap rather than as breathing room. Still wide
   * enough that nothing wraps, which matters: the contents are `whitespace-
   * nowrap`, so too narrow would overflow rather than reflow.
   */
  status: "w-[3.6rem] shrink-0 text-right sm:w-[4.25rem]",
};

/**
 * THE WHOLE ROW OPENS THE MEDIA, not just the chip.
 *
 * ONE GUARD RATHER THAN FIVE `stopPropagation`s. A row already contains an
 * owner link, a score link, and a button for the draw or the completion date,
 * and every one of them has to keep working — walking up from whatever was
 * clicked catches all of them, and catches the next one somebody adds without
 * anyone having to remember this rule.
 *
 * A DRAG THAT SELECTED TEXT IS NOT A CLICK. The punishment runs to a full
 * sentence and people highlight it; opening a dialog on top of the selection
 * they just made reads as the page misfiring.
 */
function openMedia(e: React.MouseEvent, open: () => void) {
  if ((e.target as HTMLElement).closest("a,button")) return;
  if (window.getSelection()?.toString()) return;
  open();
}

export function PunishmentLedger({
  rows,
  teams,
  names,
  onDraw,
  onComplete,
  onMedia,
  media,
  loading = false,
}: {
  rows: LedgerRow[];
  /** Season-scoped team rosters, so a co-owned team is named in full. */
  teams: TeamMap;
  /** Owner slug -> display name. */
  names: Record<string, string>;
  /**
   * Open the draw for an undrawn week.
   *
   * Present on the tracker, which owns the dialog and only has to set the query
   * string. Absent everywhere else, where the cell becomes a link to the page
   * that does own it.
   */
  onDraw?: (row: LedgerRow) => void;
  /**
   * Log or amend when a punishment was served.
   *
   * Same shape as `onDraw`: present on the tracker, which owns the dialog.
   * Absent elsewhere, where the status stays plain text rather than pretending
   * to be a control that leads nowhere.
   */
  onComplete?: (row: LedgerRow) => void;
  /**
   * Open this week's photos and videos.
   *
   * The control sits INSIDE the punishment cell rather than in a column of its
   * own: a sixth fixed column left the punishment 48px on a phone, where the
   * chip inline costs nothing and reads as belonging to the thing it documents.
   */
  onMedia?: (row: LedgerRow) => void;
  /**
   * What is already posted for a week: a count, and a thumbnail of the first.
   *
   * THE PREVIEW IS THE INDICATOR. Fourteen identical outlined icons down a
   * column read as chrome and shout louder than the punishments they sit
   * beside. A row that HAS photos shows one, which says both that there is
   * something there and what it is; a row that has none shows a bare `+`,
   * which is almost invisible until you are looking for it.
   */
  media?: (week: number) => { count: number; thumb: string | null };
  /**
   * The sheet has not answered yet.
   *
   * HALF THIS TABLE IS ALREADY KNOWN at that point — the week, who lost it and
   * by how little all come from the build, and only the punishment and whether
   * it has been served are pending. So the same renderer draws the real columns
   * and shimmers the two it is waiting on, rather than the page showing a
   * spinner and then redrawing the rows it could have shown all along.
   */
  loading?: boolean;
}) {
  // A week with nothing drawn has nothing to document, so it stays inert —
  // the same test the chip already used, now shared with the row.
  const openable = (row: LedgerRow) =>
    Boolean(onMedia) && !loading && row.punishmentId != null;

  return (
    <>
      {/* THE HEADER REPEATS THE ROW'S SPACING, not just its widths: these are
          flex rows rather than a `<table>`, so a gap changed in one place and
          not the other walks every heading off its column. */}
      <ListHeader className="gap-1 px-4 sm:gap-3 sm:px-5">
        <Col className={COL.week}>Wk</Col>
        <Col className={COL.owner}>Loser</Col>
        <Col className={COL.punishment}>Punishment</Col>
        <Col className={COL.media} hint="Photos and video">
          <span aria-hidden>📷</span>
        </Col>
        <Col
          className={COL.score}
          hint="Their score that week — the lowest in the league"
        >
          Score
        </Col>
        <Col className={COL.status}>Status</Col>
      </ListHeader>

      <ol className="divide-y divide-ink-700">
        {rows.map((row) => (
          <li
            key={row.week}
            onClick={
              openable(row)
                ? (e) => openMedia(e, () => onMedia!(row))
                : undefined
            }
            className={`flex items-start gap-1 px-4 py-1.5 sm:items-center sm:gap-3 sm:px-5 ${
              openable(row)
                ? "cursor-pointer transition-colors hover:bg-ink-700/40"
                : ""
            }`}
          >
            <span
              className={`tabular text-[11px] font-bold text-chalk-600 ${COL.week}`}
            >
              {row.week}
            </span>

            {/* WRAPS ON A PHONE rather than truncating. "Robbie & Thomas" cut
                to "Robbie & Th…" in a 64px column says less than the same name
                over two lines, and the row is already top-aligned there for the
                punishment, so a taller cell costs nothing. */}
            <span className={`text-sm sm:truncate ${COL.owner}`}>
              <TeamNames
                season={row.season}
                slugs={row.losers}
                teams={teams}
                names={names}
              />
              {row.disagrees ? <Disagreement row={row} names={names} /> : null}
            </span>

            <span className={COL.punishment}>
              {loading ? (
                // Widths vary per row so the column reads as sentences of
                // different lengths rather than a stack of identical bars.
                <Skeleton
                  className={`h-3.5 ${["w-3/5", "w-4/5", "w-2/3", "w-11/12"][row.week % 4]}`}
                />
              ) : row.punishment ? (
                // Native title, not a Tip: a tooltip trigger on every row would
                // underline the whole column on hover and read as interactive.
                <span
                  className="block text-sm text-chalk-300 sm:truncate"
                  title={row.punishment.text}
                >
                  {row.punishment.text}
                </span>
              ) : row.punishmentId != null ? (
                // An id the suggestion table has no row for — always a sheet
                // error. Named, not numbered: the id is bookkeeping, and it is in
                // the tooltip for whoever has to go and fix it.
                <Tip
                  text={`The sheet assigned punishment #${row.punishmentId} for week ${row.week}, which is not in this season's suggestions.`}
                  className="text-sm text-gold"
                >
                  Unknown punishment
                </Tip>
              ) : !row.losers.length ? (
                // Nothing to draw for — the API needs somebody to draw against.
                <span className="text-sm text-chalk-600">Not drawn yet</span>
              ) : onDraw ? (
                // A FLEX BOX, NOT A BARE INLINE-BLOCK. Sitting on the cell's
                // text baseline, the button was lifted by the line-height's
                // descender space and rode a couple of pixels high against the
                // rest of the row. A flex container is exactly the control's
                // height, so the row's own `items-center` can do its job.
                <span className="flex">
                  <button
                    type="button"
                    onClick={() => onDraw(row)}
                    className="whitespace-nowrap rounded border border-accent-dim/60 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
                  >
                    Spin the wheel
                  </button>
                </span>
              ) : (
                // NO CALLBACK MEANS THIS IS NOT THE TRACKER — the season page,
                // where opening the dialog means going to the page that has it.
                // A real navigation, so the params are read on load: a `<Link>`
                // pushes state without firing `popstate`, which `useUrlState`
                // listens for, so linking to the SAME page would change the
                // address bar and open nothing.
                <span className="flex">
                  <Link
                    href={`/punishments/?season=${row.season}&draw=1&week=${row.week}&loser=${row.losers[0]}`}
                    className="whitespace-nowrap rounded border border-accent-dim/60 bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
                  >
                    Spin the wheel
                  </Link>
                </span>
              )}
            </span>

            <span className={`flex justify-center ${COL.media}`}>
              {openable(row) ? (
                <MediaChip
                  found={media?.(row.week) ?? { count: 0, thumb: null }}
                  onOpen={() => onMedia!(row)}
                />
              ) : null}
            </span>

            <span className={`tabular text-xs text-chalk-500 ${COL.score}`}>
              {row.points == null ? (
                "—"
              ) : row.matchupId ? (
                <Link
                  href={`/matchups/${row.matchupId}/`}
                  className="transition-colors hover:text-accent"
                >
                  {row.points.toFixed(2)}
                </Link>
              ) : (
                row.points.toFixed(2)
              )}
            </span>

            <span className={COL.status}>
              {loading ? (
                <Skeleton className="ml-auto h-3 w-10" />
              ) : onComplete && row.punishmentId != null ? (
                // THE STATUS IS THE CONTROL. Logging a completion is an edit to
                // exactly the thing this cell already shows, so a separate
                // button beside it would be a second way to say one thing.
                <button
                  type="button"
                  onClick={() => onComplete(row)}
                  title={
                    row.completed || row.planned
                      ? "Change or clear this date"
                      : "Plan a date, or log when it was completed"
                  }
                  className="rounded transition-opacity hover:opacity-70"
                >
                  <Status row={row} />
                </button>
              ) : (
                <Status row={row} />
              )}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * The sheet named someone other than the team that actually scored lowest.
 *
 * Sleeper's answer is the one rendered — it is measured from the scores — so
 * this marks a row that needs correcting in the sheet rather than changing what
 * the site says.
 */
function Disagreement({
  row,
  names,
}: {
  row: LedgerRow;
  names: Record<string, string>;
}) {
  const label = (slugs: string[]) =>
    slugs.map((s) => names[s] ?? s).join(" & ");
  return (
    <Tip
      text={`The sheet has ${label(row.sheetLosers)} for this week, but the scores say ${label(
        row.losers,
      )}. Showing the scores — the sheet needs correcting.`}
      className="ml-1 text-gold"
    >
      <span aria-label="Sheet disagrees with the scores">⚠</span>
    </Tip>
  );
}

/**
 * Three states, which is why the column says Status rather than Done: a planned
 * date IS a date, but it is still owed, so a tick beside it would claim
 * something that has not happened. Green and ticked for done, amber and
 * unticked for planned, the plain word for nothing arranged.
 */
function Status({ row }: { row: LedgerRow }) {
  if (row.completed) {
    return (
      <span className="tabular whitespace-nowrap text-[11px] font-semibold text-win">
        ✓ {formatCompleted(row.completed)}
      </span>
    );
  }
  if (row.planned) {
    return (
      <span
        title={`Planned for ${formatCompleted(row.planned)} — not done yet`}
        className="tabular whitespace-nowrap text-[11px] font-semibold text-gold"
      >
        {formatCompleted(row.planned)}
      </span>
    );
  }
  if (row.punishmentId == null) {
    return <span className="text-[11px] font-semibold text-chalk-600">—</span>;
  }
  return (
    <span className="whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-loss">
      Owed
    </span>
  );
}

/**
 * What a week has, and the way in to add more.
 *
 * NEGATIVE MARGIN AROUND A SMALL GLYPH. The `+` is deliberately tiny so a
 * column of them disappears, but a tiny tap target on a phone does not — the
 * padding gives it a 28px hit area while the mark itself stays quiet.
 *
 * STILL A REAL BUTTON even though the whole row now opens the same dialog. The
 * row's handler is a mouse convenience with no place in the tab order; this is
 * what a keyboard reaches and what a screen reader announces, so it cannot
 * become a decorative span.
 */
function MediaChip({
  found,
  onOpen,
}: {
  found: { count: number; thumb: string | null };
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        found.count
          ? `${found.count} photo${found.count === 1 ? "" : "s"} or video`
          : "Add photos or video"
      }
      className="group -m-1.5 flex shrink-0 items-center gap-1 p-1.5"
    >
      {found.thumb ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={found.thumb}
            alt=""
            loading="lazy"
            className="h-5 w-5 rounded object-cover ring-1 ring-ink-500 transition-shadow group-hover:ring-accent-dim"
          />
          {found.count > 1 ? (
            <span className="tabular text-[10px] font-semibold text-chalk-500 transition-colors group-hover:text-accent">
              {found.count}
            </span>
          ) : null}
        </>
      ) : (
        <span
          aria-hidden
          className="text-sm leading-none text-chalk-600 transition-colors group-hover:text-accent"
        >
          +
        </span>
      )}
    </button>
  );
}
