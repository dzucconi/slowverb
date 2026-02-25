import { Chain, MarkovModel } from "./types";

const SENTENCE_END_RE = /[.!?]$/;
const CAPITALIZED_RE = /^[A-Z]/;

const pickRandom = <T>(items: ReadonlyArray<T>): T => {
  const index = Math.floor(Math.random() * items.length);
  const value = items[index];
  if (value === undefined) {
    throw new Error("Cannot pick from empty array.");
  }

  return value;
};

const postProcessSentence = (sentence: string): string =>
  sentence
    .toLowerCase()
    .trim()
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/,$/, ".");

const splitBigramKey = (key: string): [string, string] => {
  const [first, second] = key.split(" ");
  if (first === undefined || second === undefined) {
    throw new Error(`Malformed bigram key: "${key}"`);
  }

  return [first, second];
};

export const loadModel = async (): Promise<MarkovModel> => {
  const response = await fetch("/chain.json");
  if (!response.ok) {
    throw new Error(`Failed to load chain.json (${response.status}).`);
  }

  const chain = (await response.json()) as Chain;
  const starterKeys = Object.keys(chain).filter((key) => CAPITALIZED_RE.test(key));
  if (starterKeys.length === 0) {
    throw new Error("No sentence starters found in chain.");
  }

  return { chain, starterKeys };
};

export const generateSentence = (model: MarkovModel, maxTokens = 100): string => {
  const startKey = pickRandom(model.starterKeys);
  const [first, second] = splitBigramKey(startKey);
  const words: string[] = [first, second];

  for (let step = 0; step < maxTokens; step += 1) {
    const lookupKey = `${words[words.length - 2]} ${words[words.length - 1]}`;
    const nextWords = model.chain[lookupKey];
    if (nextWords === undefined || nextWords.length === 0) {
      break;
    }

    const nextWord = pickRandom(nextWords);
    words.push(nextWord);
    if (SENTENCE_END_RE.test(nextWord)) {
      break;
    }
  }

  return postProcessSentence(words.join(" "));
};

export const generateVerseFragments = (model: MarkovModel): string[] =>
  generateSentence(model).split(", ");
