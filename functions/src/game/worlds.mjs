import { sceneStops } from "./world-catalog.mjs";
export { sceneStops };
export function sceneForLevel(level = 1) {
  const id = Math.max(1, Math.min(300, Math.floor(Number(level) || 1)));
  const stop = Math.floor((id - 1) / 10);
  return {
    ...sceneStops[stop],
    stop,
    family: stop,
    vista: 0,
    first: stop * 10 + 1,
    last: (stop + 1) * 10,
  };
}
