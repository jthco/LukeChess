// One schema supplies live faders, defaults, validation, and local persistence.
const groups = [
  [
    "Growth",
    [
      ["rate", "Paths per second", 0, 120, 1, 60, "forest-rate"],
      ["fade", "Fade speed", 0, 1, 0.001, 0.01, "forest-fade"],
      ["searchDepth", "Exploration depth", 2, 8, 1, 5],
      ["burstMs", "Search burst (ms)", 10, 100, 5, 65],
      ["intervalMs", "Search rest (ms)", 30, 500, 10, 90],
    ],
  ],
  [
    "Stroke geometry",
    [
      ["curvature", "Curvature", 0, 0.25, 0.001, 0.035],
      ["bendVariation", "Curvature variation", 0, 0.25, 0.001, 0.045],
      ["scatter", "Perpendicular scatter", 0, 0.2, 0.001, 0.0425],
      ["generationFade", "Lookahead fading", 0, 1, 0.05, 0.3],
      ["tipWidth", "Tip width ratio", 0, 1, 0.05, 0.2],
      ["captureRadius", "Capture circle (square radius)", 0, 0.45, 0.01, 0.22],
      ["taper", "Depth taper", 0, 2, 0.05, 0.5],
      ["width", "Stroke width (px)", 0.2, 5, 0.1, 1.4],
      ["segments", "Curve smoothness", 4, 40, 1, 16],
    ],
  ],
  [
    "Unselected forest",
    [
      ["forestOpacity", "Canvas opacity (%)", 0, 100, 1, 75, "forest-opacity"],
      ["forestStroke", "Stroke opacity", 0, 1, 0.01, 0.28],
      ["forestFade", "Fade multiplier", 0, 5, 0.1, 1],
      ["forestTint", "Tint strength", 0, 1, 0.01, 0],
    ],
  ],
  [
    "Selected tree",
    [
      ["selectedOpacity", "Canvas opacity (%)", 0, 100, 1, 100],
      ["selectedStroke", "Stroke opacity", 0, 1, 0.01, 0.4],
      ["selectedFade", "Fade multiplier", 0, 5, 0.1, 1.4],
      ["selectedTint", "Tint strength", 0, 1, 0.01, 0],
    ],
  ],
];
const colors = [
  ["whiteStart", "White paths: start", "#063d59"],
  ["whiteEnd", "White paths: end", "#1b6680"],
  ["blackStart", "Black paths: start", "#7a1f0b"],
  ["blackEnd", "Black paths: end", "#a13d20"],
  ["selectedStart", "Selected: start", "#146b29"],
  ["selectedEnd", "Selected: end", "#339947"],
  ["forestTintColor", "Forest tint", "#457582"],
  ["selectedTintColor", "Selected tint", "#79bd62"],
];
const KEY = "lukechess.forest-tuning.v1";
export function createForestTuning() {
  const root = document.querySelector("#forest-tuning"),
    inputs = new Map(),
    outputs = new Map();
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {}
  for (const [title, fields] of groups) {
    const section = document.createElement("details");
    section.open = title === "Growth";
    const summary = document.createElement("summary");
    summary.textContent = title;
    section.append(summary);
    for (const [key, label, min, max, step, value, id] of fields) {
      const row = document.createElement("label"),
        heading = document.createElement("span"),
        output = document.createElement("output");
      heading.textContent = label;
      heading.append(output);
      row.append(heading);
      const input = document.createElement("input");
      input.type = "range";
      input.id = id || "forest-" + key;
      input.min = min;
      input.max = max;
      input.step = step;
      input.value =
        Number.isFinite(saved[key]) && saved[key] >= min && saved[key] <= max
          ? saved[key]
          : value;
      output.htmlFor = input.id;
      row.append(input);
      section.append(row);
      inputs.set(key, input);
      outputs.set(key, output);
    }
    root.append(section);
  }
  const palette = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Colours";
  palette.append(summary);
  for (const [key, label, value] of colors) {
    const row = document.createElement("label");
    row.className = "forest-color";
    row.textContent = label;
    const input = document.createElement("input");
    input.type = "color";
    input.id = "forest-" + key;
    input.value = /^#[0-9a-f]{6}$/i.test(saved[key]) ? saved[key] : value;
    row.append(input);
    palette.append(row);
    inputs.set(key, input);
  }
  root.append(palette);
  const read = () =>
    Object.fromEntries(
      [...inputs].map(([key, input]) => [
        key,
        input.type === "color" ? input.value : Number(input.value),
      ]),
    );
  const update = () => {
    for (const [key, output] of outputs) output.value = inputs.get(key).value;
    try {
      localStorage.setItem(KEY, JSON.stringify(read()));
    } catch {}
  };
  root.addEventListener("input", update);
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset tuning";
  reset.onclick = () => {
    for (const [, fields] of groups)
      for (const [key, , , , , value] of fields) inputs.get(key).value = value;
    for (const [key, , value] of colors) inputs.get(key).value = value;
    update();
  };
  root.append(reset);
  // Reading may be unavailable in privacy modes; controls still work.
  for (const [key, output] of outputs) output.value = inputs.get(key).value;
  return { read };
}
export function bendDirection(square) {
  // Zero-based board coordinates; orientation never changes a move's bend.
  return (square.charCodeAt(0) - 97 + Number(square[1]) - 1) % 2 ? -1 : 1;
}
