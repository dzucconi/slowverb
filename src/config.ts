export const CONFIG = {
  animation: {
    fadeInMsPerCharacter: 75,
    fadeOutMs: 100,
    pauseAfterVerseMs: 4000,
    blackHoldMs: 500,
  },
  text: {
    maxFragmentWords: 8,
    maxFragments: 8,
  },
  generation: {
    maxTokens: 100,
    defaultTemperature: 1,
    temperatureMin: 0.05,
    temperatureMax: 2.5,
  },
  ui: {
    cursorIdleMs: 3000,
    maxHistory: 50,
  },
  app: {
    defaultReloadMinutes: 30,
    bootRetryMs: 1000,
  },
} as const;
