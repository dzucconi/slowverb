import { CONFIG } from "./config";

export const SENTENCE_END = /[.!?]$/;
export const CAPITALIZED = /^[A-Z]/;

export const pickRandom = <T>(items: ReadonlyArray<T>): T => {
  const index = Math.floor(Math.random() * items.length);
  const value = items[index];
  if (value === undefined) {
    throw new Error("Cannot pick from empty array.");
  }
  return value;
};

const balanceParens = (text: string): string => {
  const opens = (text.match(/\(/g) ?? []).length;
  const closes = (text.match(/\)/g) ?? []).length;
  if (opens === closes) return text;
  if (closes > opens) return text.replace(/\)/g, "");
  return text.replace(/\(/g, "");
};

export const postProcess = (sentence: string): string =>
  balanceParens(
    sentence
      .toLowerCase()
      .trim()
      .replace(/\s+([,.!?;:])/g, "$1")
      .replace(/,$/, "."),
  );

const splitLongFragment = (fragment: string): ReadonlyArray<string> => {
  const words = fragment.split(" ").filter(Boolean);
  if (words.length <= CONFIG.text.maxFragmentWords) {
    return [fragment];
  }
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CONFIG.text.maxFragmentWords) {
    chunks.push(words.slice(i, i + CONFIG.text.maxFragmentWords).join(" "));
  }
  return chunks;
};

const BREAK_PATTERN = /\s*(?:,\s+|–\s*|\s+–\s*|—\s*|\s+—\s*|\.\.\.\s*|\s*;\s+)\s*/;

export const toFragments = (sentence: string): ReadonlyArray<string> =>
  sentence
    .split(BREAK_PATTERN)
    .flatMap(splitLongFragment)
    .filter((f) => f.length > 0)
    .slice(0, CONFIG.text.maxFragments);
