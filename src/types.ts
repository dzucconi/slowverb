export type Chain = Readonly<Record<string, ReadonlyArray<string>>>;

export type MarkovModel = Readonly<{
  chain: Chain;
  starterKeys: ReadonlyArray<string>;
}>;

export type AnimationConfig = Readonly<{
  factorMsPerCharacter: number;
  pauseMs: number;
}>;

export const animationConfig: AnimationConfig = {
  factorMsPerCharacter: 75,
  pauseMs: 4000
};
