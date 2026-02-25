import "../style.css";
import { startAnimationLoop } from "./animator";
import { generateVerseFragments, loadModel } from "./markov";
import { animationConfig } from "./types";

const getReloadIntervalMinutes = (): number => {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("r");
  if (value === null) {
    return 30;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
};

const scheduleReload = (): void => {
  window.setTimeout(
    () => {
      window.location.reload();
    },
    getReloadIntervalMinutes() * 60 * 1000
  );
};

const boot = async (): Promise<void> => {
  try {
    const model = await loadModel();
    startAnimationLoop(() => generateVerseFragments(model), animationConfig);
    scheduleReload();
  } catch {
    window.setTimeout(() => {
      void boot();
    }, 1000);
  }
};

void boot();
