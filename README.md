# Slow Verb

A Markov chain derived from 39,020 lines of vocal trance lyrics.

A single song.

## Meta

- **State**: production

## Usage

```
yarn install
yarn dev
```

Open `http://localhost:5173` to view the default (multi-order Markov) mode.

## Parameters

### URL

| Param  | Description                             | Type                   | Default    |
| ------ | --------------------------------------- | ---------------------- | ---------- |
| `mode` | Generation model to use                 | `"markov" \| "legacy"` | `"markov"` |
| `temp` | Sampling temperature (markov mode only) | `number`               | `1`        |
| `r`    | Auto-reload interval                    | `number` (minutes)     | `30`       |

### Config

All tunable values live in `src/config.ts`.

| Param                            | Description                                 | Type     | Default |
| -------------------------------- | ------------------------------------------- | -------- | ------- |
| `animation.fadeInMsPerCharacter` | Fade-in duration per character of each word | `number` | `75`    |
| `animation.fadeOutMs`            | Whole-verse fade-out duration (ms)          | `number` | `100`   |
| `animation.pauseAfterVerseMs`    | Hold time after all words visible (ms)      | `number` | `4000`  |
| `animation.blackHoldMs`          | Black screen hold between verses (ms)       | `number` | `500`   |
| `text.maxFragmentWords`          | Max words per line before splitting         | `number` | `8`     |
| `generation.maxTokens`           | Maximum tokens per generated sentence       | `number` | `100`   |
| `generation.defaultTemperature`  | Default sampling temperature                | `number` | `1`     |
| `generation.temperatureMin`      | Minimum allowed temperature                 | `number` | `0.05`  |
| `generation.temperatureMax`      | Maximum allowed temperature                 | `number` | `2.5`   |
| `app.defaultReloadMinutes`       | Default page auto-reload interval (minutes) | `number` | `30`    |
| `app.bootRetryMs`                | Retry delay on boot failure (ms)            | `number` | `1000`  |

**Modes:**

- `markov` — multi-order chain (orders 2, 3, 4) with backoff and temperature control, built from a scraped lyrics corpus
- `legacy` — original bigram chain exported from the legacy application's binary dictionary

## Build

```
yarn build
```

Output goes to `dist/`.

## Project structure

```
src/
  main.ts       entry point, URL param routing
  config.ts     all tunable constants
  text.ts       shared pure functions (random selection, post-processing)
  types.ts      type definitions
  animator.ts   DOM creation + Web Animations API fade-in loop
  legacy.ts     bigram generation from legacy chain
  markov.ts     multi-order generation with backoff + temperature

public/
  chain.json          multi-order Markov chain (from corpus)
  chain-legacy.json   original bigram chain (from legacy binary)
  fonts/              Union typeface

scripts/
  export-chain.rb                       legacy binary (.mmd) → chain-legacy.json
  normalize-chain.py                    normalize chain-legacy.json tokens
  build-chain-from-clean.py             clean corpus → chain.json
  clean-lyrics-corpus.py                raw scraped lyrics → cleaned/categorized corpus
  review-lyrics.py                      interactive review of ambiguous files
  scrape-wayback-lyrics-playwright.mjs  Wayback Machine lyrics scraper (Playwright)
```

## Data pipeline

The lyrics corpus was scraped from an archived copy of lyrics.trancestation.nl via the Wayback Machine. The pipeline to rebuild the chain data from scratch:

```
yarn scrape:lyrics          # scrape raw lyrics into data/wayback-lyrics/lyrics/
yarn clean:lyrics           # normalize, deduplicate, categorize into data/wayback-lyrics/clean/
yarn review:lyrics          # interactively review ambiguous files
yarn build:chain            # build public/chain.json from clean corpus
```

The legacy chain is exported separately from the original Ruby application's binary dictionary:

```
yarn export:legacy-chain    # export + normalize legacy binary → public/chain-legacy.json
```
