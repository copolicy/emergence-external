// Throwaway: old vs new Contour (Supply Chain) defaults across the seeds that
// used to leave big blank areas. Bottom row is the new defaults with the real
// stamp/cutout treatment, as a sanity check on the ink.
import { stampOptsForStroke } from "./src/tools/stampTreatment";
import {
  BG,
  computeContours,
  DEFAULT_CONTOUR,
  drawContours,
  INK,
  type ContourParams,
} from "./src/tools/contourCore";

const SIZE = 200;
const SEEDS = [17946, 57194, 85784, 60044, 46933];
const ROWS: Array<[string, Partial<ContourParams>, boolean]> = [
  ["old (lv10, fill .6, no spread)", { levels: 10, fill: 0.6, evenness: 0 }, false],
  ["new (lv12, fill .2, spread .6)", {}, false],
  ["new + ink treatment", {}, true],
];

const out = document.getElementById("out")!;
const table = document.createElement("table");
const head = document.createElement("tr");
head.appendChild(document.createElement("th"));
for (const seed of SEEDS) {
  const th = document.createElement("th");
  th.textContent = `seed ${seed}`;
  head.appendChild(th);
}
table.appendChild(head);

for (const [name, over, treated] of ROWS) {
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.textContent = name;
  tr.appendChild(th);
  for (const seed of SEEDS) {
    const td = document.createElement("td");
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const params: ContourParams = {
      ...DEFAULT_CONTOUR,
      ...over,
      seed,
      // Bump the stroke for the untreated rows so 0.3px linework reads at
      // thumbnail scale; the treated row keeps the real weight.
      lineWidth: treated ? DEFAULT_CONTOUR.lineWidth : 0.7,
    };
    const result = computeContours(SIZE, SIZE, params, null);
    drawContours(
      ctx,
      1,
      SIZE,
      SIZE,
      result,
      INK,
      BG,
      1,
      true,
      params.seed,
      treated ? stampOptsForStroke(params) : undefined,
    );
    td.appendChild(canvas);
    tr.appendChild(td);
  }
  table.appendChild(tr);
}

out.replaceChildren(table);
