// Throwaway: which seeds leave the biggest blank areas, and how much does
// raising the contour line count close them?
import { computeContours, DEFAULT_CONTOUR, type ContourParams } from "./src/tools/contourCore";

const W = 1080, H = 1080, CELL = 6;

function gaps(p: ContourParams) {
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
  let over = 0;
  for (let k=0;k<d.length;k++) if (d[k]*CELL > 60) over++;
  return { p95: q(0.95), max: q(1), blank60: over/d.length, len, rings: lines.length, d, gw, gh };
}

const SEEDS: number[] = [];
for (let i = 0; i < 150; i++) SEEDS.push(((i * 3571 + 101) % 99999) + 1);
SEEDS.push(46933, 60044);

const cur = SEEDS.map((seed) => {
  const g = gaps({ ...DEFAULT_CONTOUR, seed });
  return { seed, max: g.max, p95: g.p95, blank: g.blank60, len: g.len, rings: g.rings };
});
cur.sort((x, y) => y.max - x.max);
console.log("worst 8 seeds under current defaults (levels 10, fill .6):");
for (const r of cur.slice(0, 8)) {
  console.log(`  seed ${String(r.seed).padStart(5)}  hole ${r.max.toFixed(0)}px  gap p95 ${r.p95.toFixed(0)}px  >60px-blank ${(r.blank*100).toFixed(1)}%  rings ${r.rings}  ink ${(r.len/1000).toFixed(0)}k`);
}
console.log("best 4:");
for (const r of cur.slice(-4)) {
  console.log(`  seed ${String(r.seed).padStart(5)}  hole ${r.max.toFixed(0)}px  gap p95 ${r.p95.toFixed(0)}px  rings ${r.rings}  ink ${(r.len/1000).toFixed(0)}k`);
}
const named = cur.filter((r) => r.seed === 46933 || r.seed === 60044);
console.log("reference seeds:");
for (const r of named) console.log(`  seed ${r.seed}  hole ${r.max.toFixed(0)}px  gap p95 ${r.p95.toFixed(0)}px  >60px-blank ${(r.blank*100).toFixed(1)}%  rings ${r.rings}  ink ${(r.len/1000).toFixed(0)}k`);

console.log("\ncandidates on the 10 worst seeds (hole radius px / ink k):");
const worst10 = cur.slice(0, 10).map((r) => r.seed);
const cands: Array<[string, Partial<ContourParams>]> = [
  ["current", {}],
  ["levels 13", { levels: 13 }],
  ["levels 16", { levels: 16 }],
  ["levels 20", { levels: 20 }],
  ["levels 16 fill .8", { levels: 16, fill: 0.8 }],
  ["levels 16 fill .4", { levels: 16, fill: 0.4 }],
  ["levels 16 scale 4", { levels: 16, fieldScale: 4 }],
  ["levels 20 scale 4", { levels: 20, fieldScale: 4 }],
];
for (const [name, over] of cands) {
  const holes: number[] = [];
  const inks: number[] = [];
  const alls: number[] = [];
  for (const seed of worst10) {
    const g = gaps({ ...DEFAULT_CONTOUR, ...over, seed });
    holes.push(g.max);
    inks.push(g.len);
  }
  for (const seed of SEEDS.slice(0, 60)) alls.push(gaps({ ...DEFAULT_CONTOUR, ...over, seed }).max);
  const med = (ns: number[]) => [...ns].sort((a,b)=>a-b)[Math.floor(ns.length/2)];
  console.log(
    `  ${name.padEnd(20)} worst-seed holes med ${med(holes).toFixed(0)}px max ${Math.max(...holes).toFixed(0)}px | all-seed hole med ${med(alls).toFixed(0)}px max ${Math.max(...alls).toFixed(0)}px | ink med ${(med(inks)/1000).toFixed(0)}k`,
  );
}
