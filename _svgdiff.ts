import {
  __debugPaintMesh,
  buildMeshSVG,
  computeMesh,
  DEFAULT_MESH,
  drawMesh,
  INK,
  MH,
  MW,
} from "./src/tools/meshCore";
import {
  __debugStamp,
  __debugSteps,
  stampOptsForStroke,
} from "./src/tools/stampTreatment";

const out = document.getElementById("out")!;
const holder = document.getElementById("holder")!;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  out.textContent = log.join("\n");
};

const w = MW;
const h = MH;
const params = DEFAULT_MESH;
const stampOpts = stampOptsForStroke(params);
const lines = computeMesh(w, h, params);
const fade = true;
const fadeSeed = params.seed;

// Compare at the treatment's own buffer resolution so the field is 1:1 exact.
const S = 4;
const SHOW = 300; // css width for the full views
// Zoom crop window, in preview px
const CROP = { x: 150, y: 120, w: 60, h: 48 };
const ZOOM = 6;

function add(label: string, c: HTMLCanvasElement, cssW: number) {
  const fig = document.createElement("figure");
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  c.style.width = cssW + "px";
  fig.appendChild(cap);
  fig.appendChild(c);
  holder.appendChild(fig);
}

function full(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w * S;
  c.height = h * S;
  return c;
}

function crop(src: HTMLCanvasElement, label: string) {
  const c = document.createElement("canvas");
  c.width = CROP.w * ZOOM;
  c.height = CROP.h * ZOOM;
  const x = c.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  x.drawImage(
    src,
    CROP.x * S,
    CROP.y * S,
    CROP.w * S,
    CROP.h * S,
    0,
    0,
    c.width,
    c.height,
  );
  add(label, c, CROP.w * 2.6);
}

async function raster(svg: string): Promise<HTMLCanvasElement> {
  // Force the browser to rasterize at the FULL target resolution. Left at the
  // intrinsic 680x580 it rasterizes small and drawImage upscales bilinearly,
  // which softens edges and fattens any alpha-threshold measurement.
  const sized = svg.replace(
    /<svg([^>]*?)width="(\d+)" height="(\d+)"/,
    (_m, pre, ww, hh) =>
      `<svg${pre}width="${+ww * S}" height="${+hh * S}"`,
  );
  say(`raster header: ${sized.slice(0, 110)}`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("svg load failed"));
    img.src = url;
  });
  const c = full();
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c;
}

function inkStats(c: HTMLCanvasElement) {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const n = c.width * c.height;
  let cov = 0;
  let hard = 0;
  for (let i = 0; i < n; i++) {
    cov += d[i * 4 + 3] / 255;
    if (d[i * 4 + 3] >= 128) hard++;
  }
  return { cov, hard, n };
}

async function run() {
  say(`params ${JSON.stringify(params)}`);
  say(`stampOpts ${JSON.stringify(stampOpts)}   lines ${lines.length}`);

  const cA = full();
  drawMesh(
    cA.getContext("2d")!,
    S,
    w,
    h,
    lines,
    INK,
    "transparent",
    1,
    fade,
    fadeSeed,
    stampOpts,
  );

  const svg = buildMeshSVG(
    w,
    h,
    lines,
    INK,
    "transparent",
    fade,
    fadeSeed,
    stampOpts,
  );
  const cB = await raster(svg);
  const cNZ = await raster(svg.replace(/evenodd/g, "nonzero"));

  // Ground truth: the region the canvas threshold keeps == field >= iso.
  const dbg = __debugStamp(w, h, INK, stampOpts!, (tctx) =>
    __debugPaintMesh(tctx, w, h, lines, INK, 1, fade, fadeSeed),
  );
  say(`steps ${JSON.stringify(__debugSteps(stampOpts!))}`);
  say(`field ${dbg.pw}x${dbg.ph} tDpr ${dbg.tDpr} iso ${dbg.iso}`);
  let isoArea = 0;
  for (let i = 0; i < dbg.field.length; i++) if (dbg.field[i] >= dbg.iso) isoArea++;
  // convert buffer px -> preview px^2, then to the S-scale raster used below
  const truthCov = (isoArea / (dbg.tDpr * dbg.tDpr)) * S * S;
  say(`iso region area: ${isoArea} buffer px  => ${truthCov.toFixed(0)} raster px`);

  // The iso region as a bitmap, 1:1 with the field (S === tDpr).
  const cT = full();
  {
    const tctx = cT.getContext("2d")!;
    const bi = tctx.createImageData(dbg.pw, dbg.ph);
    for (let i = 0; i < dbg.field.length; i++) {
      const on = dbg.field[i] >= dbg.iso;
      bi.data[i * 4] = 192;
      bi.data[i * 4 + 1] = 182;
      bi.data[i * 4 + 2] = 99;
      bi.data[i * 4 + 3] = on ? 255 : 0;
    }
    tctx.putImageData(bi, 0, 0);
  }

  const sA = inkStats(cA);
  const sB = inkStats(cB);
  const sT = inkStats(cT);
  const sNZ = inkStats(cNZ);
  const pct = (v: number) => ((v / sA.n) * 100).toFixed(3) + "%";
  say("");
  say(`GROUND TRUTH (field>=iso) coverage ${pct(truthCov)}`);
  say(`  truth raster coverage ${pct(sT.cov)}  hard ${sT.hard}`);
  say(`  canvas / truthRaster  ${(sA.cov / sT.cov).toFixed(3)}`);
  say(`  svg    / truthRaster  ${(sB.cov / sT.cov).toFixed(3)}`);
  say(`canvas          coverage ${pct(sA.cov)}  hard ${sA.hard}`);
  say(
    `svg evenodd     coverage ${pct(sB.cov)}  hard ${sB.hard}  ratio ${(sB.cov / sA.cov).toFixed(3)}`,
  );
  say(
    `svg nonzero     coverage ${pct(sNZ.cov)}  hard ${sNZ.hard}  ratio ${(sNZ.cov / sA.cov).toFixed(3)}`,
  );

  const px = (c: HTMLCanvasElement) =>
    c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;

  function diff(label: string, refC: HTMLCanvasElement, tstC: HTMLCanvasElement) {
    const r = px(refC);
    const t = px(tstC);
    const cD = full();
    const dctx = cD.getContext("2d")!;
    const dimg = dctx.createImageData(cD.width, cD.height);
    let onlyR = 0;
    let onlyT = 0;
    let both = 0;
    for (let i = 0; i < sA.n; i++) {
      const ri = r[i * 4 + 3] >= 128;
      const ti = t[i * 4 + 3] >= 128;
      if (ri && ti) both++;
      else if (ri) onlyR++;
      else if (ti) onlyT++;
      dimg.data[i * 4] = ri && !ti ? 255 : 0;
      dimg.data[i * 4 + 1] = ti && !ri ? 255 : 0;
      dimg.data[i * 4 + 3] = ri !== ti ? 255 : ri ? 60 : 10;
    }
    dctx.putImageData(dimg, 0, 0);
    say(`${label}: agree ${both}  ref-only(red) ${onlyR}  test-only(green) ${onlyT}`);
    return cD;
  }

  // Analytic area of the traced polygons (removes rasterization from the loop)
  {
    const d = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
    const subs = d.split("Z").filter((s) => s.trim().length);
    let absArea = 0;
    let signedArea = 0;
    let ptTotal = 0;
    for (const s of subs) {
      const nums = s
        .split(/[ML]/)
        .filter((t) => t.trim().length)
        .map((t) => t.trim().split(/\s+/).map(Number));
      ptTotal += nums.length;
      let acc = 0;
      for (let i = 0; i < nums.length; i++) {
        const [x1, y1] = nums[i];
        const [x2, y2] = nums[(i + 1) % nums.length];
        acc += x1 * y2 - x2 * y1;
      }
      acc /= 2;
      absArea += Math.abs(acc);
      signedArea += acc;
    }
    const truthPreviewArea = isoArea / (dbg.tDpr * dbg.tDpr);
    say("");
    say(`traced subpaths ${subs.length}  points ${ptTotal}`);
    say(`truth area (preview px^2)      ${truthPreviewArea.toFixed(0)}`);
    say(
      `traced |signed| sum            ${absArea.toFixed(0)}  ratio ${(absArea / truthPreviewArea).toFixed(3)}`,
    );
    say(
      `traced signed sum (abs)        ${Math.abs(signedArea).toFixed(0)}  ratio ${(Math.abs(signedArea) / truthPreviewArea).toFixed(3)}`,
    );
  }

  // Exact per-edge offset: ink run boundaries along scanlines, buffer px.
  {
    const runsOf = (data: Uint8ClampedArray, y: number) => {
      const runs: [number, number][] = [];
      let s = -1;
      for (let x = 0; x < cT.width; x++) {
        const on = data[(y * cT.width + x) * 4 + 3] >= 128;
        if (on && s < 0) s = x;
        else if (!on && s >= 0) {
          runs.push([s, x]);
          s = -1;
        }
      }
      if (s >= 0) runs.push([s, cT.width]);
      return runs;
    };
    const tD = px(cT);
    const bD = px(cB);
    let leftSum = 0;
    let rightSum = 0;
    let widthT = 0;
    let widthS = 0;
    let matched = 0;
    for (const y of [400, 700, 1000, 1300, 1600]) {
      const rt = runsOf(tD, y);
      const rs = runsOf(bD, y);
      say(`row ${y}: truth runs ${rt.length}, svg runs ${rs.length}`);
      say(
        `  truth ${rt.slice(0, 6).map((r) => `[${r[0]},${r[1]})`).join(" ")}`,
      );
      say(`  svg   ${rs.slice(0, 6).map((r) => `[${r[0]},${r[1]})`).join(" ")}`);
      // pair runs by overlap to measure per-edge offsets
      for (const a2 of rt) {
        const hit = rs.find((b2) => b2[0] < a2[1] && b2[1] > a2[0]);
        if (!hit) continue;
        matched++;
        leftSum += a2[0] - hit[0];
        rightSum += hit[1] - a2[1];
        widthT += a2[1] - a2[0];
        widthS += hit[1] - hit[0];
      }
    }
    say("");
    say(`matched runs ${matched}`);
    say(`mean truth run width ${(widthT / matched).toFixed(2)} buffer px`);
    say(`mean svg   run width ${(widthS / matched).toFixed(2)} buffer px`);
    say(
      `mean outward offset: left ${(leftSum / matched).toFixed(2)}  right ${(rightSum / matched).toFixed(2)} buffer px`,
    );
  }

  const dTS = diff("truth vs svg   ", cT, cB);
  const dTA = diff("truth vs canvas", cT, cA);
  say("");
  say("DONE");

  add("truth (field>=iso)", cT, SHOW);
  add("svg export", cB, SHOW);
  add("canvas", cA, SHOW);
  crop(cT, "ZOOM truth");
  crop(cB, "ZOOM svg");
  crop(cA, "ZOOM canvas");
  crop(dTS, "ZOOM truth-vs-svg");
  crop(dTA, "ZOOM truth-vs-canvas");
}

void run().catch((e) => say("ERROR " + (e as Error).message));
