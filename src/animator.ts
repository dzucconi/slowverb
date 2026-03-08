import { CONFIG } from "./config";

const durationForToken = (token: string): number =>
  token.length * CONFIG.animation.fadeInMsPerCharacter;

const createWordElement = (word: string): HTMLSpanElement => {
  const element = document.createElement("span");
  element.textContent = word;
  element.style.opacity = "0";
  return element;
};

const animateFadeIn = (
  element: HTMLElement,
  durationMs: number,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return Promise.resolve();
  const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: durationMs,
    easing: "linear",
    fill: "forwards",
  });
  return new Promise<void>((resolve) => {
    const abort = () => {
      animation.cancel();
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    animation.finished.then(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
  });
};

const animateFadeOut = (
  container: HTMLElement,
  signal: AbortSignal,
): Promise<void> => {
  if (signal.aborted) return Promise.resolve();
  const animation = container.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: CONFIG.animation.fadeOutMs,
    easing: "linear",
  });
  return new Promise<void>((resolve) => {
    const abort = () => {
      animation.cancel();
      container.style.opacity = "0";
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    animation.finished.then(() => {
      signal.removeEventListener("abort", abort);
      container.style.opacity = "0";
      resolve();
    });
  });
};

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const buildVerseElements = (
  fragments: ReadonlyArray<string>,
  container: HTMLElement,
): ReadonlyArray<HTMLSpanElement> => {
  const words: HTMLSpanElement[] = [];

  for (const fragment of fragments) {
    const paragraph = document.createElement("p");
    const tokens = fragment.split(" ");

    tokens.forEach((token, index) => {
      const wordElement = createWordElement(token);
      words.push(wordElement);
      paragraph.appendChild(wordElement);

      if (index < tokens.length - 1) {
        paragraph.appendChild(document.createTextNode(" "));
      }
    });

    container.appendChild(paragraph);
  }

  return words;
};

const animateWordSequence = async (
  words: ReadonlyArray<HTMLSpanElement>,
  signal: AbortSignal,
): Promise<void> => {
  for (const wordElement of words) {
    if (signal.aborted) return;
    const token = wordElement.textContent ?? "";
    await animateFadeIn(wordElement, durationForToken(token), signal);
  }
};

export type AnimationLoop = Readonly<{
  getCurrentText: () => string;
  skip: () => void;
  previous: () => void;
  togglePause: () => boolean;
}>;

type AnimationOptions = Readonly<{ fade?: boolean }>;

const showAllWords = (words: ReadonlyArray<HTMLSpanElement>): void => {
  for (const el of words) el.style.opacity = "1";
};

export const startAnimationLoop = (
  nextFragments: () => ReadonlyArray<string>,
  options: AnimationOptions = {},
): AnimationLoop => {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);

  const history: ReadonlyArray<string>[] = [];
  let historyIndex = -1;
  let currentFragments: ReadonlyArray<string> = [];
  let controller = new AbortController();
  let direction: "forward" | "back" = "forward";
  let paused = false;
  let unpause: (() => void) | null = null;

  const present = (fragments: ReadonlyArray<string>): ReadonlyArray<HTMLSpanElement> => {
    wrapper.innerHTML = "";
    wrapper.style.opacity = "1";
    currentFragments = fragments;
    return buildVerseElements(fragments, wrapper);
  };

  const run = async (): Promise<void> => {
    controller = new AbortController();
    const { signal } = controller;

    let fragments: ReadonlyArray<string>;

    if (direction === "back" && historyIndex >= 0) {
      fragments = history[historyIndex]!;
    } else {
      fragments = nextFragments();
      history.push(fragments);
      if (history.length > CONFIG.ui.maxHistory) history.shift();
      historyIndex = history.length - 1;
    }

    direction = "forward";
    const words = present(fragments);

    if (options.fade === false) {
      showAllWords(words);
      await delay(CONFIG.animation.pauseAfterVerseMs, signal);
    } else {
      await animateWordSequence(words, signal);
      if (!signal.aborted) await delay(CONFIG.animation.pauseAfterVerseMs, signal);
      if (!signal.aborted) await animateFadeOut(wrapper, signal);
      if (!signal.aborted) await delay(CONFIG.animation.blackHoldMs, signal);
    }

    if (paused && !signal.aborted) {
      await new Promise<void>((resolve) => { unpause = resolve; });
      unpause = null;
    }

    void run();
  };

  void run();

  return {
    getCurrentText: () => currentFragments.join("\n"),
    skip: () => {
      historyIndex = history.length;
      direction = "forward";
      if (unpause) unpause();
      controller.abort();
    },
    previous: () => {
      if (historyIndex > 0) {
        historyIndex--;
        direction = "back";
        if (unpause) unpause();
        controller.abort();
      }
    },
    togglePause: () => {
      paused = !paused;
      if (!paused && unpause) unpause();
      return paused;
    },
  };
};
