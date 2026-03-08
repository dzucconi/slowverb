import "../style.css";
import { AnimationLoop, startAnimationLoop } from "./animator";
import { CONFIG } from "./config";
import { generateLegacyFragments, loadLegacyModel } from "./legacy";
import { generateMarkovFragments, loadMarkovModel } from "./markov";

type Mode = "legacy" | "markov";

const parseMode = (raw: string | null): Mode =>
  raw === "legacy" || raw === "classic" ? "legacy" : "markov";

const parseTemperature = (raw: string | null): number => {
  if (raw === null) return CONFIG.generation.defaultTemperature;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n)
    ? Math.max(
        CONFIG.generation.temperatureMin,
        Math.min(CONFIG.generation.temperatureMax, n),
      )
    : CONFIG.generation.defaultTemperature;
};

const parseReloadMinutes = (raw: string | null): number => {
  if (raw === null) return CONFIG.app.defaultReloadMinutes;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : CONFIG.app.defaultReloadMinutes;
};

const readParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: parseMode(params.get("mode")),
    temperature: parseTemperature(params.get("temp")),
    reloadMinutes: parseReloadMinutes(params.get("r")),
    fade: params.get("fade") !== "false",
  };
};

const buildGenerator = async (
  mode: Mode,
  temperature: number,
): Promise<() => ReadonlyArray<string>> => {
  if (mode === "legacy") {
    const model = await loadLegacyModel();
    return () => generateLegacyFragments(model);
  }
  const model = await loadMarkovModel();
  return () => generateMarkovFragments(model, temperature);
};

const setupFullscreen = (): void => {
  document.addEventListener("dblclick", () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen();
    }
  });
};

const showToast = (message: string): void => {
  const existing = document.querySelector("[data-toast]");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.setAttribute("data-toast", "");
  el.textContent = message;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.classList.add("visible");
    setTimeout(() => {
      el.classList.remove("visible");
      el.addEventListener("transitionend", () => el.remove());
    }, 1500);
  });
};

const setupCopyShortcut = (loop: AnimationLoop): void => {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      const text = loop.getCurrentText();
      if (text) {
        e.preventDefault();
        void navigator.clipboard.writeText(text);
        showToast("Copied");
      }
    }
  });
};

const setupCursorAutoHide = (): void => {
  let timer: ReturnType<typeof setTimeout>;

  const hide = () => {
    document.documentElement.style.cursor = "none";
  };

  const show = () => {
    document.documentElement.style.cursor = "";
    clearTimeout(timer);
    timer = setTimeout(hide, CONFIG.ui.cursorIdleMs);
  };

  document.addEventListener("mousemove", show);
  document.addEventListener("mousedown", show);
  timer = setTimeout(hide, CONFIG.ui.cursorIdleMs);
};

const boot = async (): Promise<void> => {
  try {
    setupFullscreen();
    setupCursorAutoHide();
    const { mode, temperature, reloadMinutes, fade } = readParams();
    const generate = await buildGenerator(mode, temperature);
    const loop = startAnimationLoop(generate, { fade });
    setupCopyShortcut(loop);
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        loop.skip();
        showToast("Next");
      }
    });
    window.setTimeout(() => window.location.reload(), reloadMinutes * 60_000);
  } catch {
    window.setTimeout(() => void boot(), CONFIG.app.bootRetryMs);
  }
};

void boot();
