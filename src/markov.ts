import { CONFIG } from "./config";
import { CAPITALIZED, pickRandom, postProcess, SENTENCE_END, toFragments } from "./text";
import { Chain, MarkovModel, MultiOrderChain } from "./types";

const parseOrder = (raw: string): number => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 2) {
    throw new Error(`Invalid chain order: "${raw}"`);
  }
  return n;
};

const splitKey = (key: string, order: number): string[] => {
  const parts = key.split(" ").filter(Boolean);
  if (parts.length !== order) {
    throw new Error(`Malformed key for order ${order}: "${key}"`);
  }
  return parts;
};

const toDistribution = (
  items: ReadonlyArray<string>,
): ReadonlyArray<Readonly<{ token: string; count: number }>> => {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()].map(([token, count]) => ({ token, count }));
};

const pickWithTemperature = (items: ReadonlyArray<string>, temperature: number): string => {
  if (items.length === 0) {
    throw new Error("Cannot pick from empty array.");
  }
  if (temperature >= 0.99 && temperature <= 1.01) {
    return pickRandom(items);
  }

  const distribution = toDistribution(items);
  if (temperature <= 0.05) {
    const sorted = [...distribution].sort((a, b) => b.count - a.count);
    const [top] = sorted;
    if (top === undefined) {
      throw new Error("No candidates for deterministic pick.");
    }
    return top.token;
  }

  const power = 1 / temperature;
  const weighted = distribution.map(({ token, count }) => ({
    token,
    weight: count ** power,
  }));
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    return pickRandom(items);
  }

  let draw = Math.random() * totalWeight;
  for (const w of weighted) {
    draw -= w.weight;
    if (draw <= 0) {
      return w.token;
    }
  }
  const last = weighted[weighted.length - 1];
  if (last === undefined) {
    throw new Error("No candidates for weighted pick.");
  }
  return last.token;
};

const lookupNext = (model: MarkovModel, words: ReadonlyArray<string>): ReadonlyArray<string> => {
  for (const order of model.orders) {
    if (words.length < order) {
      continue;
    }
    const key = words.slice(words.length - order).join(" ");
    const chain = model.chains[String(order)];
    const next = chain?.[key];
    if (next !== undefined && next.length > 0) {
      return next;
    }
  }
  return [];
};

export const loadMarkovModel = async (): Promise<MarkovModel> => {
  const response = await fetch("/chain.json");
  if (!response.ok) {
    throw new Error(`Failed to load chain.json (${response.status}).`);
  }

  const chains = (await response.json()) as MultiOrderChain;
  const orders = Object.keys(chains)
    .map(parseOrder)
    .sort((a, b) => b - a);
  if (orders.length === 0) {
    throw new Error("No chain orders found in chain.json.");
  }

  const highestOrder = orders[0];
  if (highestOrder === undefined) {
    throw new Error("No highest order available.");
  }
  const topChain = chains[String(highestOrder)] as Chain | undefined;
  if (topChain === undefined) {
    throw new Error(`Missing chain for order ${highestOrder}.`);
  }

  const starterKeys = Object.keys(topChain).filter((key) => {
    const [first] = splitKey(key, highestOrder);
    return first !== undefined && CAPITALIZED.test(first);
  });
  if (starterKeys.length === 0) {
    throw new Error("No sentence starters found in chain.");
  }

  return { chains, orders, starterKeys };
};

export const generateMarkovSentence = (
  model: MarkovModel,
  temperature: number = CONFIG.generation.defaultTemperature,
): string => {
  const startKey = pickRandom(model.starterKeys);
  const highestOrder = model.orders[0];
  if (highestOrder === undefined) {
    throw new Error("No orders configured.");
  }
  const words: string[] = splitKey(startKey, highestOrder);

  for (let step = 0; step < CONFIG.generation.maxTokens; step += 1) {
    const next = lookupNext(model, words);
    if (next.length === 0) {
      break;
    }

    const word = pickWithTemperature(next, temperature);
    words.push(word);
    if (SENTENCE_END.test(word)) {
      break;
    }
  }

  return postProcess(words.join(" "));
};

export const generateMarkovFragments = (
  model: MarkovModel,
  temperature: number = CONFIG.generation.defaultTemperature,
): ReadonlyArray<string> =>
  toFragments(generateMarkovSentence(model, temperature));
