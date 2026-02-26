import { CONFIG } from "./config";
import { CAPITALIZED, pickRandom, postProcess, SENTENCE_END, toFragments } from "./text";
import { Chain, LegacyModel } from "./types";

const splitBigramKey = (key: string): [string, string] => {
  const [first, second] = key.split(" ");
  if (first === undefined || second === undefined) {
    throw new Error(`Malformed bigram key: "${key}"`);
  }
  return [first, second];
};

export const loadLegacyModel = async (): Promise<LegacyModel> => {
  const response = await fetch("/chain-legacy.json");
  if (!response.ok) {
    throw new Error(`Failed to load chain-legacy.json (${response.status}).`);
  }

  const chain = (await response.json()) as Chain;
  const starterKeys = Object.keys(chain).filter((key) => CAPITALIZED.test(key));
  if (starterKeys.length === 0) {
    throw new Error("No sentence starters found in legacy chain.");
  }

  return { chain, starterKeys };
};

export const generateLegacySentence = (model: LegacyModel): string => {
  const startKey = pickRandom(model.starterKeys);
  const [first, second] = splitBigramKey(startKey);
  const words: string[] = [first, second];

  for (let step = 0; step < CONFIG.generation.maxTokens; step += 1) {
    const lookupKey = `${words[words.length - 2]} ${words[words.length - 1]}`;
    const nextWords = model.chain[lookupKey];
    if (nextWords === undefined || nextWords.length === 0) {
      break;
    }

    const nextWord = pickRandom(nextWords);
    words.push(nextWord);
    if (SENTENCE_END.test(nextWord)) {
      break;
    }
  }

  return postProcess(words.join(" "));
};

export const generateLegacyFragments = (model: LegacyModel): ReadonlyArray<string> =>
  toFragments(generateLegacySentence(model));
