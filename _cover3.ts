// Throwaway: blank-gap stats for the new Contour defaults vs the old ones,
// across seeds and canvas sizes.
import { computeContours, DEFAULT_CONTOUR, type ContourParams } from "./src/tools/contourCore";

const CELL = 6;

function gaps(p: ContourParams, W: number, H: number) {
  const { lines } = computeContours(W, H, p, null);
  const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
  const INF = 1e9;
  const d = new Float64Array(gw * gh).fill(INF);
  let len = 0;
  for (const line of lines) {
    const pts = line.pts;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i+1], x1 = pts[i+2], y1 = pts[i+3];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      len += seg;
      const steps = Math.max(1, Math.ceil(seg / CELL));
      for (let s = 0; s <= steps; s++) {
        const gx = Math.min(gw-1, Math.max(0, Math.round((x0 + ((x1-x0)*s)/steps) / CELL)));
        const gy = Math.min(gh-1, Math.max(0, Math.round((y0 + ((y1-y0)*s)/steps) / CELL)));
        d[gy*gw+gx] = 0;
      }
    }
  }
  const a = 1, b = Math.SQRT2;
  const at = (x: number, y: number) => (x<0||y<0||x>=gw||y>=gh ? INF : d[y*gw+x]);
  for (let y=0;y<gh;y++) for (let x=0;x<gw;x++) { const k=y*gw+x; d[k]=Math.min(d[k], at(x-1,y)+a, at(x,y-1)+a, at(x-1,y-1)+b, at(x+1,y-1)+b); }
  for (let y=gh-1;y>=0;y--) for (let x=gw-1;x>=0;x--) { const k=y*gw+x; d[k]=Math.min(d[k], at(x+1,y)+a, at(x,y+1)+a, at(x+1,y+1)+b, at(x-1,y+1)+b); }
  const s = Float64Array.from(d).sort();
  const q = (pq: number) => s[Math.floor(pq*(s.length-1))] * CELL;
  // Report holes relative to the canvas so sizes are comparable.
  return { p95: q(0.95), max: q(1), len, rings: lines.length, rel: q(1) / Math.min(W, H) };
}

const SEEDS: number[] = [];
for (let i = 0; i < 100; i++) SEEDS.push(((i * 3571 + 101) % 99999) + 1);
SEEDS.push(17946, 57194, 85784, 82202, 89377, 60044, 46933);

const OLD: Partial<ContourParams> = { levels: 10, fill: 0.6, evenness: 0 };
const st = (ns: number[]) => {
  const s = [...ns].sort((a, b) => a - b);
  const at = (q: number) => s[Math.floor(q * (s.length - 1))];
  return { min: s[0], med: at(0.5), p90: at(0.9), max: s[s.length - 1] };
};

for (const [W, H] of [[1080, 1080], [680, 580], [1080, 1350], [1920, 1080]] as Array<[number, number]>) {
  const rows: Array<[string, Partial<ContourParams>]> = [
    ["old defaults", OLD],
    ["new defaults", {}],
  ];
  console.log(`\n${W}x${H}`);
  for (const [name, over] of rows) {
    const holes: number[] = [];
    const rels: number[] = [];
    const inks: number[] = [];
    const rings: number[] = [];
    for (const seed of SEEDS) {
      const g = gaps({ ...DEFAULT_CONTOUR, ...over, seed }, W, H);
      holes.push(g.max);
      rels.push(g.rel);
      inks.push(g.len);
      rings.push(g.rings);
    }
    const h = st(holes), r = st(rels), k = st(inks), rg = st(rings);
    console.log(
      `  ${name.padEnd(13)} biggest hole med ${h.med.toFixed(0)}px p90 ${h.p90.toFixed(0)}px worst ${h.max.toFixed(0)}px  (worst = ${(r.max*100).toFixed(1)}% of the short edge) | ink med ${(k.med/1000).toFixed(0)}k spread ${(k.min/1000).toFixed(0)}-${(k.max/1000).toFixed(0)}k | rings med ${rg.med}`,
    );
  }
}
