import { AnimationConfig } from "./types";

const durationForToken = (token: string, config: AnimationConfig): number =>
  token.length * config.factorMsPerCharacter;

const createWordElement = (word: string): HTMLSpanElement => {
  const element = document.createElement("span");
  element.textContent = word;
  element.style.opacity = "0";
  return element;
};

const animateFadeIn = (element: HTMLElement, durationMs: number): Promise<void> => {
  const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: durationMs,
    easing: "linear",
    fill: "forwards"
  });

  return animation.finished.then(() => undefined);
};

const buildVerseElements = (
  fragments: ReadonlyArray<string>,
  container: HTMLElement,
  config: AnimationConfig
): Readonly<{ words: ReadonlyArray<HTMLSpanElement>; totalDurationMs: number }> => {
  const words: HTMLSpanElement[] = [];
  let totalDurationMs = 0;

  for (const fragment of fragments) {
    const paragraph = document.createElement("p");
    const tokens = fragment.split(" ");

    tokens.forEach((token, index) => {
      const wordElement = createWordElement(token);
      words.push(wordElement);
      totalDurationMs += durationForToken(token, config);
      paragraph.appendChild(wordElement);

      if (index < tokens.length - 1) {
        paragraph.appendChild(document.createTextNode(" "));
      }
    });

    container.appendChild(paragraph);
  }

  return { words, totalDurationMs };
};

const animateWordSequence = async (
  words: ReadonlyArray<HTMLSpanElement>,
  config: AnimationConfig
): Promise<void> => {
  for (const wordElement of words) {
    const token = wordElement.textContent ?? "";
    await animateFadeIn(wordElement, durationForToken(token, config));
  }
};

export const startAnimationLoop = (
  nextFragments: () => ReadonlyArray<string>,
  config: AnimationConfig
): void => {
  const run = (): void => {
    document.body.innerHTML = "";
    const fragments = nextFragments();
    const { words, totalDurationMs } = buildVerseElements(fragments, document.body, config);

    void animateWordSequence(words, config);
    window.setTimeout(run, totalDurationMs + config.pauseMs);
  };

  run();
};
