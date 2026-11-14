# Token Launch Radar — radar-2

A ranked board of 200 pre-token protocols, built to find the next token
launches early: 40 watchlist protocols plus the 160 strongest pre-token
protocols below the $50M watchlist floor, ranked by implied token value.
Tokenised protocols are kept apart in a separate live-token view, shown at
the market's own value.

## The model (radar-2)

Each protocol's implied value is its TVL times a peer-calibrated multiple:
the median market-cap/TVL ratio of the tokenised protocols in its own
category, computed from the same snapshot at runtime (categories with fewer
than 3 peers fall back to the global median), clamped to [0.05, 1.5]. That
base is then adjusted for 7-day growth (clamped −60%..+120%, half weight)
and for maturity (0.6 + up to 0.4 for age up to 3 years; unknown age counts
as 365 days). No protocol name is ever special-cased, and the peer table the
model computed is carried in `data.js` so the dashboard can show it.

## Run the local check

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 24, standard library only, no network. `main.ts` writes `board.json`,
`data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json`
last. It refuses to run if the board fails validation or if fewer than 3
screenshots are present.

## Screenshots

The three PNGs in `screenshots/` are real browser screenshots of the built
dashboard (Playwright Chromium, viewport 1440×900, full page), taken by
`scripts/screenshot.mjs` and quantized to a palette with PIL so each stays
under the 512 KiB gate cap (board: 32 colours; detail/filtered: 256).
Screenshot URLs (relative to the output dir): `dashboard/index.html`,
`dashboard/index.html#detail=steakhouse-financial`,
`dashboard/index.html#watchlist=1`.
