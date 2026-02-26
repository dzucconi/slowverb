export type Chain = Readonly<Record<string, ReadonlyArray<string>>>;

export type LegacyModel = Readonly<{
  chain: Chain;
  starterKeys: ReadonlyArray<string>;
}>;

export type MultiOrderChain = Readonly<Record<string, Chain>>;

export type MarkovModel = Readonly<{
  chains: MultiOrderChain;
  orders: ReadonlyArray<number>;
  starterKeys: ReadonlyArray<string>;
}>;
