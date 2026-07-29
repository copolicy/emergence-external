// Accuracy of the SVG-export contour tracer against fields whose iso contour
// is known analytically. Any systematic area/width bias here is the same bias
// the exported SVG carries relative to the canvas.
import { __debugTrace } from "./src/tools/stampTreatment";

const out = document.getElementById("out")!;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  out.textContent = log.join("\n");
};

/** Sum of |signed area| over the subpaths of a traced `d` string. */
function pathArea(d: string) {
  const subs = d.split("Z").filter((s) => s.trim().length);
  let abs = 0;
  let signed = 0;
  let pts = 0;
  for (const s of subs) {
    const nums = s
      .split(/[ML]/)
      .filter((t) => t.trim().length)
      .map((t) => t.trim().split(/\s+/).map(Number));
    pts += nums.length;
    let acc = 0;
    for (let i = 0; i < nums.length; i++) {
      const [x1, y1] = nums[i];
      const [x2, y2] = nums[(i + 1) % nums.length];
      acc += x1 * y2 - x2 * y1;
    }
    acc /= 2;
    abs += Math.abs(acc);
    signed += acc;
  }
  return { abs, signed, subs: subs.length, pts };
}

const ISO = 127.5;

// ---- Test 1: vertical stripe. Linear ramp => iso edges at |x-cx| = HW/2.
function stripeTest(pw: number, ph: number, cx: number, HW: number) {
  const field = new Uint8ClampedArray(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      // pixel center sits at x + 0.5
      const px = x + 0.5;
      const v = 255 * (1 - Math.abs(px - cx) / HW);
      field[y * pw + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  const d = __debugTrace(field, pw, ph, ISO, 1);
  const a = pathArea(d);
  // true region: |x-cx| <= HW/2, full height => width HW, but clipped rows at
  // top/bottom are exact since the stripe spans all rows.
  const trueWidth = HW;
  const trueArea = trueWidth * ph;
  const measWidth = a.abs / ph;
  say(`stripe pw=${pw} ph=${ph} halfwidth=${HW}`);
  say(`  subpaths ${a.subs} pts ${a.pts}`);
  say(`  true  width ${trueWidth.toFixed(3)}  area ${trueArea.toFixed(1)}`);
  say(`  trace width ${measWidth.toFixed(3)}  area ${a.abs.toFixed(1)}`);
  say(
    `  width bias ${(measWidth - trueWidth).toFixed(3)} px total = ${((measWidth - trueWidth) / 2).toFixed(3)} px per edge`,
  );
  say("");
}

// ---- Test 2: disc. Linear radial ramp => iso contour at r = R/2.
function discTest(pw: number, ph: number, R: number) {
  const cx = pw / 2;
  const cy = ph / 2;
  const field = new Uint8ClampedArray(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const v = 255 * (1 - r / R);
      field[y * pw + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  const d = __debugTrace(field, pw, ph, ISO, 1);
  const a = pathArea(d);
  const trueR = R / 2;
  const trueArea = Math.PI * trueR * trueR;
  const measR = Math.sqrt(a.abs / Math.PI);
  say(`disc pw=${pw} ph=${ph} R=${R}`);
  say(`  subpaths ${a.subs} pts ${a.pts}`);
  say(`  true  r ${trueR.toFixed(3)}  area ${trueArea.toFixed(1)}`);
  say(`  trace r ${measR.toFixed(3)}  area ${a.abs.toFixed(1)}`);
  say(`  radius bias ${(measR - trueR).toFixed(3)} px`);
  say("");
}

stripeTest(200, 120, 100, 30);
stripeTest(200, 120, 100, 12);
stripeTest(200, 120, 100.5, 30);
discTest(300, 300, 200);
discTest(300, 300, 80);
say("DONE");
