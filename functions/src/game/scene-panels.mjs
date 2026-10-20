// Pastels chosen to echo each illustration without weakening text contrast.
const panelColors = [
  "#DFEED6",
  "#D9EEF7",
  "#E5DFF5",
  "#F5E8CE",
  "#F4DFE8",
  "#DEEAF0",
  "#DCECEE",
  "#E6DDF2",
  "#E1EAF8",
  "#F2E1CC",
  "#F3DFD4",
  "#E8DEF5",
  "#DDEBD5",
  "#EAE0F3",
  "#E3EED5",
  "#EEE5D7",
  "#DCE8F0",
  "#DFE9D8",
  "#E5EDF5",
  "#D7EFEB",
  "#DCEEE6",
  "#E2DFF3",
  "#E7E8D3",
  "#EDF0D1",
  "#DDEAF0",
  "#F5ECCE",
  "#F2DEDF",
  "#EEE2EE",
  "#DDEEF5",
  "#F5E3DB",
];
export const withScenePanels = (scenes) =>
  scenes.map((scene, index) => ({
    ...scene,
    panelColor: panelColors[index],
    panelDarkColor:
      "#" +
      panelColors[index]
        .slice(1)
        .match(/../g)
        .map((channel) =>
          Math.round(parseInt(channel, 16) * 0.16 + 20)
            .toString(16)
            .padStart(2, "0"),
        )
        .join(""),
  }));
