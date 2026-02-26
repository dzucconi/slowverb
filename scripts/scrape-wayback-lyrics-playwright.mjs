#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const WAYBACK_BASE = "https://web.archive.org/web";
const DEFAULT_SNAPSHOT = "20160319041902";
const DEFAULT_INDEX_URL = `${WAYBACK_BASE}/${DEFAULT_SNAPSHOT}/http://lyrics.trancestation.nl/full_lyrics.php`;
const DEFAULT_OUTPUT_DIR = "data/wayback-lyrics";
const SEED_URLS_CACHE_FILE = "seed-urls.json";
const ATTEMPTS_FILE = "attempts.json";

const log = (msg) => console.log(msg);

const decodeHtmlEntities = (value) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const cfg = {
    snapshot: DEFAULT_SNAPSHOT,
    indexUrl: DEFAULT_INDEX_URL,
    outputDir: DEFAULT_OUTPUT_DIR,
    seedMode: "cdx",
    seedHtmlFile: "",
    refreshSeed: false,
    offset: 0,
    max: 0,
    workers: 2,
    retryFailures: false,
    maxAttempts: 5,
    requestDelay: 1.5,
    timeout: 30000,
    retries: 4,
    saveEvery: 10,
    logEvery: 5,
    headed: false,
    failuresOnly: false,
    debugTries: true,
    altSnapshots: ["20070617170625", "20070629050349", "20090210043238"]
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    const takesValue = (name) => arg === name && next !== undefined;

    if (takesValue("--snapshot")) {
      cfg.snapshot = next;
      i += 1;
    } else if (takesValue("--index-url")) {
      cfg.indexUrl = next;
      i += 1;
    } else if (takesValue("--output-dir")) {
      cfg.outputDir = next;
      i += 1;
    } else if (takesValue("--seed-mode")) {
      cfg.seedMode = next;
      i += 1;
    } else if (takesValue("--seed-html-file")) {
      cfg.seedHtmlFile = next;
      i += 1;
    } else if (takesValue("--offset")) {
      cfg.offset = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (takesValue("--max")) {
      cfg.max = Number.parseInt(next, 10) || 0;
      i += 1;
    } else if (takesValue("--workers")) {
      cfg.workers = Math.max(1, Number.parseInt(next, 10) || 1);
      i += 1;
    } else if (takesValue("--max-attempts")) {
      cfg.maxAttempts = Math.max(1, Number.parseInt(next, 10) || 5);
      i += 1;
    } else if (takesValue("--request-delay")) {
      cfg.requestDelay = Math.max(0, Number.parseFloat(next) || 0);
      i += 1;
    } else if (takesValue("--timeout")) {
      cfg.timeout = Math.max(1000, Number.parseInt(next, 10) || 30000);
      i += 1;
    } else if (takesValue("--retries")) {
      cfg.retries = Math.max(1, Number.parseInt(next, 10) || 1);
      i += 1;
    } else if (takesValue("--alt-snapshots")) {
      cfg.altSnapshots = next
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      i += 1;
    } else if (takesValue("--save-every")) {
      cfg.saveEvery = Math.max(1, Number.parseInt(next, 10) || 10);
      i += 1;
    } else if (takesValue("--log-every")) {
      cfg.logEvery = Math.max(1, Number.parseInt(next, 10) || 5);
      i += 1;
    } else if (arg === "--retry-failures") {
      cfg.retryFailures = true;
    } else if (arg === "--refresh-seed") {
      cfg.refreshSeed = true;
    } else if (arg === "--headed") {
      cfg.headed = true;
    } else if (arg === "--failures-only") {
      cfg.failuresOnly = true;
    } else if (arg === "--debug-tries") {
      cfg.debugTries = true;
    }
  }

  return cfg;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class GlobalRateLimiter {
  #nextAllowed = 0;
  #chain = Promise.resolve();
  constructor(minIntervalMs) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
  }
  waitTurn() {
    this.#chain = this.#chain.then(async () => {
      const now = Date.now();
      if (now < this.#nextAllowed) {
        await sleep(this.#nextAllowed - now);
      }
      this.#nextAllowed = Date.now() + this.minIntervalMs;
    });
    return this.#chain;
  }
}

const readJson = async (filePath, fallback) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
};

const normalizeLyricUrl = (rawLink) => {
  const unescaped = decodeHtmlEntities(rawLink).trim();
  if (!unescaped) return null;
  const wrapped = unescaped.match(/\/web\/\d+[a-z_]*\/(https?:\/\/lyrics\.trancestation\.nl\/[^\s"'<>]+)/i);
  const link = wrapped ? wrapped[1] : unescaped;

  let full;
  if (link.startsWith("http://lyrics.trancestation.nl/") || link.startsWith("https://lyrics.trancestation.nl/")) {
    full = link;
  } else if (link.startsWith("/")) {
    full = `http://lyrics.trancestation.nl${link}`;
  } else {
    full = `http://lyrics.trancestation.nl/${link}`;
  }

  try {
    const parsed = new URL(full);
    if (parsed.hostname !== "lyrics.trancestation.nl") return null;
    if (!parsed.pathname.toLowerCase().endsWith(".php")) return null;
    if (
      new Set([
        "/full_lyrics.php",
        "/index.php",
        "/search_lyrics.php",
        "/vocal_trance_radio_tuner.php",
        "/dj_aliases.php",
        "/add_lyric.php",
        "/main.php"
      ]).has(parsed.pathname.toLowerCase())
    ) {
      return null;
    }
    return `http://lyrics.trancestation.nl${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

const extractLyricUrlsFromHtml = (html) => {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  return [...new Set(hrefs.map(normalizeLyricUrl).filter(Boolean))].sort();
};

const fetchTextViaBrowser = async (page, limiter, url, timeout, retries) => {
  let lastErr = null;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await limiter.waitTurn();
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout
      });
      if (!response) throw new Error("No response");
      if (response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
      return await page.content();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        const backoff = Math.min(15000, 500 * 2 ** (i - 1));
        await sleep(backoff);
      }
    }
  }
  throw new Error(`Failed after retries for ${url}: ${String(lastErr)}`);
};

const stripTagsPreserveBreaks = (fragment) => {
  let text = fragment
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
};

const parseLyricsPage = (html) => {
  const titleMatch = html.match(/<div\s+id=["']title["']\s*>([\s\S]*?)<\/div>/i);
  const contentMatch = html.match(/<div\s+id=["']content["']\s*>([\s\S]*?)<\/div>/i);
  if (!titleMatch || !contentMatch) return null;

  const title = stripTagsPreserveBreaks(titleMatch[1]);
  const body = stripTagsPreserveBreaks(contentMatch[1])
    .split("\n")
    .filter((line, idx, arr) => !(idx >= arr.length - 1 && /^(back|print|top)$/i.test(line.trim())))
    .join("\n")
    .trim();
  if (!title || !body) return null;
  return { title, body };
};

const safeFilename = (raw) =>
  raw
    .replace(/\s+/g, " ")
    .replaceAll("/", "-")
    .replace(/[<>:"\\|?*]/g, "")
    .trim()
    .replace(/[. ]+$/g, "") || "untitled";

const uniquePath = async (dir, name) => {
  let candidate = path.join(dir, `${name}.txt`);
  let suffix = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${name} (${suffix}).txt`);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
};

const buildWaybackUrl = (snapshot, originalUrl) => {
  const cleanUrl = decodeHtmlEntities(originalUrl);
  const encoded = encodeURIComponent(cleanUrl).replaceAll("%3A", ":").replaceAll("%2F", "/");
  return `${WAYBACK_BASE}/${snapshot}/${encoded}`;
};

const persistState = async ({ outputDir, manifestBySource, failuresBySource, attemptsBySource, summary }) => {
  const manifest = Object.values(manifestBySource).sort((a, b) => a.title.localeCompare(b.title));
  const failures = Object.values(failuresBySource).sort((a, b) => a.source_url.localeCompare(b.source_url));
  await writeJson(path.join(outputDir, "manifest.json"), manifest);
  await writeJson(path.join(outputDir, "failures.json"), failures);
  await writeJson(path.join(outputDir, ATTEMPTS_FILE), attemptsBySource);
  await writeJson(path.join(outputDir, "summary.json"), summary);
};

const discoverSeedUrls = async ({ cfg, page, limiter }) => {
  const seedCachePath = path.join(cfg.outputDir, SEED_URLS_CACHE_FILE);
  if (!cfg.refreshSeed) {
    const cached = await readJson(seedCachePath, []);
    if (Array.isArray(cached) && cached.length > 0) {
      log(`[seed] loaded ${cached.length} lyric URLs from seed cache`);
      return [...new Set(cached.filter((x) => typeof x === "string"))].sort();
    }
  }

  if (cfg.seedHtmlFile) {
    try {
      const html = await fs.readFile(cfg.seedHtmlFile, "utf8");
      const urls = extractLyricUrlsFromHtml(html);
      if (urls.length > 0) {
        await writeJson(seedCachePath, urls);
        log(`[seed] extracted ${urls.length} lyric URLs from local HTML`);
        return urls;
      }
    } catch (err) {
      log(`[warn] could not read seed HTML: ${err}`);
    }
  }

  const tryCdx = cfg.seedMode !== "index";
  const tryIndex = cfg.seedMode !== "cdx" || true;

  let urls = [];
  if (tryCdx) {
    try {
      log("[seed] attempting CDX discovery");
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
        "lyrics.trancestation.nl/*"
      )}&output=json&fl=original,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&from=${cfg.snapshot.slice(0, 4)}`;
      const html = await fetchTextViaBrowser(page, limiter, cdxUrl, cfg.timeout, cfg.retries);
      const text = stripTagsPreserveBreaks(html);
      const start = text.indexOf("[");
      const payload = JSON.parse(text.slice(start));
      if (Array.isArray(payload)) {
        const originalUrls = payload.slice(1).map((row) => (Array.isArray(row) ? String(row[0]) : "")).filter(Boolean);
        urls = [...new Set(originalUrls.map(normalizeLyricUrl).filter(Boolean))].sort();
      }
      if (urls.length > 0) {
        await writeJson(seedCachePath, urls);
        log(`[seed] extracted ${urls.length} lyric URLs from CDX`);
        return urls;
      }
    } catch (err) {
      log(`[warn] CDX discovery failed: ${err}`);
    }
  }

  if (tryIndex) {
    try {
      log("[seed] attempting index discovery");
      const html = await fetchTextViaBrowser(page, limiter, cfg.indexUrl, cfg.timeout, cfg.retries);
      urls = extractLyricUrlsFromHtml(html);
      if (urls.length > 0) {
        await fs.writeFile(path.join(cfg.outputDir, "index-cache.html"), html, "utf8");
        await writeJson(seedCachePath, urls);
        log(`[seed] extracted ${urls.length} lyric URLs from index`);
        return urls;
      }
    } catch (err) {
      log(`[warn] index discovery failed: ${err}`);
    }
  }

  return [];
};

const run = async () => {
  const cfg = parseArgs();
  const outputDir = cfg.outputDir;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "lyrics"), { recursive: true });

  const browser = await chromium.launch({ headless: !cfg.headed });
  const context = await browser.newContext();
  const limiter = new GlobalRateLimiter(cfg.requestDelay * 1000);

  const seedPage = await context.newPage();
  const allUrls = await discoverSeedUrls({ cfg, page: seedPage, limiter });
  await seedPage.close();

  if (allUrls.length === 0) {
    log("[fatal] could not discover any lyric URLs.");
    await browser.close();
    process.exit(1);
  }

  const sliced = allUrls.slice(cfg.offset, cfg.max > 0 ? cfg.offset + cfg.max : undefined);
  const manifest = await readJson(path.join(outputDir, "manifest.json"), []);
  const failures = await readJson(path.join(outputDir, "failures.json"), []);
  const attemptsBySource = await readJson(path.join(outputDir, ATTEMPTS_FILE), {});

  const manifestBySource = Object.fromEntries(
    (Array.isArray(manifest) ? manifest : [])
      .filter((x) => x?.source_url)
      .map((x) => [normalizeLyricUrl(String(x.source_url)) ?? String(x.source_url), x])
  );
  const failuresBySource = Object.fromEntries(
    (Array.isArray(failures) ? failures : [])
      .filter((x) => x?.source_url)
      .map((x) => [normalizeLyricUrl(String(x.source_url)) ?? String(x.source_url), x])
  );

  const pending = sliced.filter((url) => {
    if (manifestBySource[url]) return false;
    if (cfg.failuresOnly && !failuresBySource[url]) return false;
    if (!cfg.retryFailures && failuresBySource[url]) return false;
    if (!cfg.retryFailures && (attemptsBySource[url] || 0) >= cfg.maxAttempts) return false;
    return true;
  });

  log(`Discovered ${sliced.length} lyric URLs in selected range.`);
  log(
    `Resume status: ${Object.keys(manifestBySource).length} saved, ${Object.keys(failuresBySource).length} failures, ${pending.length} queued.`
  );
  if (pending.length === 0) {
    await browser.close();
    return;
  }

  let idx = 0;
  let done = 0;
  const started = Date.now();

  const worker = async () => {
    const page = await context.newPage();
    while (true) {
      const myIndex = idx;
      idx += 1;
      if (myIndex >= pending.length) break;
      const sourceUrl = normalizeLyricUrl(pending[myIndex]) ?? pending[myIndex];
      try {
        const snapshotCandidates = [...new Set([cfg.snapshot, ...cfg.altSnapshots].filter(Boolean))];
        let parsed = null;
        let archiveUrl = "";
        if (cfg.debugTries) {
          log(`[url] ${sourceUrl}`);
        }

        for (const snapshot of snapshotCandidates) {
          const candidateUrl = buildWaybackUrl(snapshot, sourceUrl);
          if (cfg.debugTries) {
            log(`[try] snapshot=${snapshot} url=${candidateUrl}`);
          }
          try {
            const html = await fetchTextViaBrowser(page, limiter, candidateUrl, cfg.timeout, cfg.retries);
            const candidateParsed = parseLyricsPage(html);
            if (candidateParsed) {
              parsed = candidateParsed;
              archiveUrl = candidateUrl;
              if (cfg.debugTries) {
                log(`[ok] snapshot=${snapshot} source=${sourceUrl}`);
              }
              break;
            } else if (cfg.debugTries) {
              log(`[miss] snapshot=${snapshot} parsed=no-title-content source=${sourceUrl}`);
            }
          } catch (error) {
            if (cfg.debugTries) {
              log(`[fail] snapshot=${snapshot} source=${sourceUrl} error=${String(error)}`);
            }
          }
        }

        // Intentionally do not use CDX closest-timestamp fallback here.
        // We only attempt user-provided snapshots: --snapshot + --alt-snapshots.
        if (!parsed) throw new Error("Missing #title or #content");

        const fileName = safeFilename(parsed.title);
        const filePath = await uniquePath(path.join(outputDir, "lyrics"), fileName);
        await fs.writeFile(filePath, `${parsed.body}\n`, "utf8");
        manifestBySource[sourceUrl] = {
          title: parsed.title,
          file: path.relative(outputDir, filePath),
          source_url: sourceUrl,
          archive_url: archiveUrl || buildWaybackUrl(cfg.snapshot, sourceUrl)
        };
        delete failuresBySource[sourceUrl];
        attemptsBySource[sourceUrl] = 0;
      } catch (err) {
        attemptsBySource[sourceUrl] = (attemptsBySource[sourceUrl] || 0) + 1;
        failuresBySource[sourceUrl] = { source_url: sourceUrl, error: String(err) };
        if (cfg.debugTries) {
          log(`[final-fail] source=${sourceUrl} attempts=${attemptsBySource[sourceUrl]} error=${String(err)}`);
        }
      } finally {
        done += 1;
        if (done % cfg.logEvery === 0 || done === pending.length) {
          const elapsed = (Date.now() - started) / 1000;
          const rate = done / Math.max(elapsed, 0.001);
          const remain = pending.length - done;
          const eta = Math.round(remain / Math.max(rate, 0.001));
          log(
            `[progress] ${done}/${pending.length} (saved_total=${Object.keys(manifestBySource).length}, failures_total=${
              Object.keys(failuresBySource).length
            }, rate=${rate.toFixed(2)}/s, eta=${eta}s)`
          );
        }

        if (done % cfg.saveEvery === 0 || done === pending.length) {
          await persistState({
            outputDir,
            manifestBySource,
            failuresBySource,
            attemptsBySource,
            summary: {
              source_urls: sliced.length,
              queued_urls: pending.length,
              completed_urls: done,
              remaining_urls: Math.max(pending.length - done, 0),
              saved_files: Object.keys(manifestBySource).length,
              failed_urls: Object.keys(failuresBySource).length,
              max_attempts: cfg.maxAttempts,
              exhausted_urls: Object.values(attemptsBySource).filter((x) => x >= cfg.maxAttempts).length
            }
          });
          log(`[checkpoint] wrote state at ${done}/${pending.length}`);
        }
      }
    }
    await page.close();
  };

  await Promise.all(Array.from({ length: cfg.workers }, () => worker()));
  await browser.close();
  log(`Done. Saved total: ${Object.keys(manifestBySource).length}. Failures total: ${Object.keys(failuresBySource).length}.`);
  log(`Output: ${outputDir}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
