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
}>;

export const startAnimationLoop = (
  nextFragments: () => ReadonlyArray<string>,
): AnimationLoop => {
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);

  let currentFragments: ReadonlyArray<string> = [];
  let controller = new AbortController();

  const run = async (): Promise<void> => {
    controller = new AbortController();
    const { signal } = controller;

    wrapper.innerHTML = "";
    wrapper.style.opacity = "1";

    currentFragments = nextFragments();
    const words = buildVerseElements(currentFragments, wrapper);

    await animateWordSequence(words, signal);
    if (!signal.aborted) await delay(CONFIG.animation.pauseAfterVerseMs, signal);
    if (!signal.aborted) await animateFadeOut(wrapper, signal);
    if (!signal.aborted) await delay(CONFIG.animation.blackHoldMs, signal);

    void run();
  };

  void run();

  return {
    getCurrentText: () => currentFragments.join("\n"),
    skip: () => controller.abort(),
  };
};
