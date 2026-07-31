// node_modules/simplex-noise/dist/esm/simplex-noise.js
var SQRT3 = /* @__PURE__ */ Math.sqrt(3);
var SQRT5 = /* @__PURE__ */ Math.sqrt(5);
var F2 = 0.5 * (SQRT3 - 1);
var G2 = (3 - SQRT3) / 6;
var F3 = 1 / 3;
var G3 = 1 / 6;
var F4 = (SQRT5 - 1) / 4;
var G4 = (5 - SQRT5) / 20;
var fastFloor = (x) => Math.floor(x) | 0;
var grad2 = /* @__PURE__ */ new Float64Array([
  1,
  1,
  -1,
  1,
  1,
  -1,
  -1,
  -1,
  1,
  0,
  -1,
  0,
  1,
  0,
  -1,
  0,
  0,
  1,
  0,
  -1,
  0,
  1,
  0,
  -1
]);
function createNoise2D(random = Math.random) {
  const perm = buildPermutationTable(random);
  const permGrad2x = new Float64Array(perm).map((v) => grad2[v % 12 * 2]);
  const permGrad2y = new Float64Array(perm).map((v) => grad2[v % 12 * 2 + 1]);
  return function noise2D(x, y) {
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    const s = (x + y) * F2;
    const i = fastFloor(x + s);
    const j = fastFloor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = ii + perm[jj];
      const g0x = permGrad2x[gi0];
      const g0y = permGrad2y[gi0];
      t0 *= t0;
      n0 = t0 * t0 * (g0x * x0 + g0y * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = ii + i1 + perm[jj + j1];
      const g1x = permGrad2x[gi1];
      const g1y = permGrad2y[gi1];
      t1 *= t1;
      n1 = t1 * t1 * (g1x * x1 + g1y * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = ii + 1 + perm[jj + 1];
      const g2x = permGrad2x[gi2];
      const g2y = permGrad2y[gi2];
      t2 *= t2;
      n2 = t2 * t2 * (g2x * x2 + g2y * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}
function buildPermutationTable(random) {
  const tableSize = 512;
  const p = new Uint8Array(tableSize);
  for (let i = 0; i < tableSize / 2; i++) {
    p[i] = i;
  }
  for (let i = 0; i < tableSize / 2 - 1; i++) {
    const r = i + ~~(random() * (256 - i));
    const aux = p[i];
    p[i] = p[r];
    p[r] = aux;
  }
  for (let i = 256; i < tableSize; i++) {
    p[i] = p[i - 256];
  }
  return p;
}

// node_modules/d3-array/src/count.js
function count(values, valueof) {
  let count2 = 0;
  if (valueof === void 0) {
    for (let value of values) {
      if (value != null && (value = +value) >= value) {
        ++count2;
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null && (value = +value) >= value) {
        ++count2;
      }
    }
  }
  return count2;
}

// node_modules/d3-array/src/extent.js
function extent(values, valueof) {
  let min;
  let max;
  if (valueof === void 0) {
    for (const value of values) {
      if (value != null) {
        if (min === void 0) {
          if (value >= value) min = max = value;
        } else {
          if (min > value) min = value;
          if (max < value) max = value;
        }
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null) {
        if (min === void 0) {
          if (value >= value) min = max = value;
        } else {
          if (min > value) min = value;
          if (max < value) max = value;
        }
      }
    }
  }
  return [min, max];
}

// node_modules/d3-array/src/ticks.js
var e10 = Math.sqrt(50);
var e5 = Math.sqrt(10);
var e2 = Math.sqrt(2);
function tickSpec(start, stop, count2) {
  const step = (stop - start) / Math.max(0, count2), power = Math.floor(Math.log10(step)), error = step / Math.pow(10, power), factor = error >= e10 ? 10 : error >= e5 ? 5 : error >= e2 ? 2 : 1;
  let i1, i2, inc;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count2 && count2 < 2) return tickSpec(start, stop, count2 * 2);
  return [i1, i2, inc];
}
function ticks(start, stop, count2) {
  stop = +stop, start = +start, count2 = +count2;
  if (!(count2 > 0)) return [];
  if (start === stop) return [start];
  const reverse = stop < start, [i1, i2, inc] = reverse ? tickSpec(stop, start, count2) : tickSpec(start, stop, count2);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1, ticks2 = new Array(n);
  if (reverse) {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks2[i] = (i2 - i) / -inc;
    else for (let i = 0; i < n; ++i) ticks2[i] = (i2 - i) * inc;
  } else {
    if (inc < 0) for (let i = 0; i < n; ++i) ticks2[i] = (i1 + i) / -inc;
    else for (let i = 0; i < n; ++i) ticks2[i] = (i1 + i) * inc;
  }
  return ticks2;
}
function tickIncrement(start, stop, count2) {
  stop = +stop, start = +start, count2 = +count2;
  return tickSpec(start, stop, count2)[2];
}

// node_modules/d3-array/src/nice.js
function nice(start, stop, count2) {
  let prestep;
  while (true) {
    const step = tickIncrement(start, stop, count2);
    if (step === prestep || step === 0 || !isFinite(step)) {
      return [start, stop];
    } else if (step > 0) {
      start = Math.floor(start / step) * step;
      stop = Math.ceil(stop / step) * step;
    } else if (step < 0) {
      start = Math.ceil(start * step) / step;
      stop = Math.floor(stop * step) / step;
    }
    prestep = step;
  }
}

// node_modules/d3-array/src/threshold/sturges.js
function thresholdSturges(values) {
  return Math.max(1, Math.ceil(Math.log(count(values)) / Math.LN2) + 1);
}

// node_modules/d3-contour/src/array.js
var array = Array.prototype;
var slice = array.slice;

// node_modules/d3-contour/src/ascending.js
function ascending_default(a, b) {
  return a - b;
}

// node_modules/d3-contour/src/area.js
function area_default(ring) {
  var i = 0, n = ring.length, area = ring[n - 1][1] * ring[0][0] - ring[n - 1][0] * ring[0][1];
  while (++i < n) area += ring[i - 1][1] * ring[i][0] - ring[i - 1][0] * ring[i][1];
  return area;
}

// node_modules/d3-contour/src/constant.js
var constant_default = (x) => () => x;

// node_modules/d3-contour/src/contains.js
function contains_default(ring, hole) {
  var i = -1, n = hole.length, c;
  while (++i < n) if (c = ringContains(ring, hole[i])) return c;
  return 0;
}
function ringContains(ring, point) {
  var x = point[0], y = point[1], contains = -1;
  for (var i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    var pi = ring[i], xi = pi[0], yi = pi[1], pj = ring[j], xj = pj[0], yj = pj[1];
    if (segmentContains(pi, pj, point)) return 0;
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) contains = -contains;
  }
  return contains;
}
function segmentContains(a, b, c) {
  var i;
  return collinear(a, b, c) && within(a[i = +(a[0] === b[0])], c[i], b[i]);
}
function collinear(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) === (c[0] - a[0]) * (b[1] - a[1]);
}
function within(p, q, r) {
  return p <= q && q <= r || r <= q && q <= p;
}

// node_modules/d3-contour/src/noop.js
function noop_default() {
}

// node_modules/d3-contour/src/contours.js
var cases = [
  [],
  [[[1, 1.5], [0.5, 1]]],
  [[[1.5, 1], [1, 1.5]]],
  [[[1.5, 1], [0.5, 1]]],
  [[[1, 0.5], [1.5, 1]]],
  [[[1, 1.5], [0.5, 1]], [[1, 0.5], [1.5, 1]]],
  [[[1, 0.5], [1, 1.5]]],
  [[[1, 0.5], [0.5, 1]]],
  [[[0.5, 1], [1, 0.5]]],
  [[[1, 1.5], [1, 0.5]]],
  [[[0.5, 1], [1, 0.5]], [[1.5, 1], [1, 1.5]]],
  [[[1.5, 1], [1, 0.5]]],
  [[[0.5, 1], [1.5, 1]]],
  [[[1, 1.5], [1.5, 1]]],
  [[[0.5, 1], [1, 1.5]]],
  []
];
function contours_default() {
  var dx = 1, dy = 1, threshold = thresholdSturges, smooth = smoothLinear;
  function contours(values) {
    var tz = threshold(values);
    if (!Array.isArray(tz)) {
      const e = extent(values, finite);
      tz = ticks(...nice(e[0], e[1], tz), tz);
      while (tz[tz.length - 1] >= e[1]) tz.pop();
      while (tz[1] < e[0]) tz.shift();
    } else {
      tz = tz.slice().sort(ascending_default);
    }
    return tz.map((value) => contour(values, value));
  }
  function contour(values, value) {
    const v = value == null ? NaN : +value;
    if (isNaN(v)) throw new Error(`invalid value: ${value}`);
    var polygons = [], holes = [];
    isorings(values, v, function(ring) {
      smooth(ring, values, v);
      if (area_default(ring) > 0) polygons.push([ring]);
      else holes.push(ring);
    });
    holes.forEach(function(hole) {
      for (var i = 0, n = polygons.length, polygon; i < n; ++i) {
        if (contains_default((polygon = polygons[i])[0], hole) !== -1) {
          polygon.push(hole);
          return;
        }
      }
    });
    return {
      type: "MultiPolygon",
      value,
      coordinates: polygons
    };
  }
  function isorings(values, value, callback) {
    var fragmentByStart = new Array(), fragmentByEnd = new Array(), x, y, t0, t1, t2, t3;
    x = y = -1;
    t1 = above(values[0], value);
    cases[t1 << 1].forEach(stitch);
    while (++x < dx - 1) {
      t0 = t1, t1 = above(values[x + 1], value);
      cases[t0 | t1 << 1].forEach(stitch);
    }
    cases[t1 << 0].forEach(stitch);
    while (++y < dy - 1) {
      x = -1;
      t1 = above(values[y * dx + dx], value);
      t2 = above(values[y * dx], value);
      cases[t1 << 1 | t2 << 2].forEach(stitch);
      while (++x < dx - 1) {
        t0 = t1, t1 = above(values[y * dx + dx + x + 1], value);
        t3 = t2, t2 = above(values[y * dx + x + 1], value);
        cases[t0 | t1 << 1 | t2 << 2 | t3 << 3].forEach(stitch);
      }
      cases[t1 | t2 << 3].forEach(stitch);
    }
    x = -1;
    t2 = values[y * dx] >= value;
    cases[t2 << 2].forEach(stitch);
    while (++x < dx - 1) {
      t3 = t2, t2 = above(values[y * dx + x + 1], value);
      cases[t2 << 2 | t3 << 3].forEach(stitch);
    }
    cases[t2 << 3].forEach(stitch);
    function stitch(line) {
      var start = [line[0][0] + x, line[0][1] + y], end = [line[1][0] + x, line[1][1] + y], startIndex = index(start), endIndex = index(end), f, g;
      if (f = fragmentByEnd[startIndex]) {
        if (g = fragmentByStart[endIndex]) {
          delete fragmentByEnd[f.end];
          delete fragmentByStart[g.start];
          if (f === g) {
            f.ring.push(end);
            callback(f.ring);
          } else {
            fragmentByStart[f.start] = fragmentByEnd[g.end] = { start: f.start, end: g.end, ring: f.ring.concat(g.ring) };
          }
        } else {
          delete fragmentByEnd[f.end];
          f.ring.push(end);
          fragmentByEnd[f.end = endIndex] = f;
        }
      } else if (f = fragmentByStart[endIndex]) {
        if (g = fragmentByEnd[startIndex]) {
          delete fragmentByStart[f.start];
          delete fragmentByEnd[g.end];
          if (f === g) {
            f.ring.push(end);
            callback(f.ring);
          } else {
            fragmentByStart[g.start] = fragmentByEnd[f.end] = { start: g.start, end: f.end, ring: g.ring.concat(f.ring) };
          }
        } else {
          delete fragmentByStart[f.start];
          f.ring.unshift(start);
          fragmentByStart[f.start = startIndex] = f;
        }
      } else {
        fragmentByStart[startIndex] = fragmentByEnd[endIndex] = { start: startIndex, end: endIndex, ring: [start, end] };
      }
    }
  }
  function index(point) {
    return point[0] * 2 + point[1] * (dx + 1) * 4;
  }
  function smoothLinear(ring, values, value) {
    ring.forEach(function(point) {
      var x = point[0], y = point[1], xt = x | 0, yt = y | 0, v1 = valid(values[yt * dx + xt]);
      if (x > 0 && x < dx && xt === x) {
        point[0] = smooth1(x, valid(values[yt * dx + xt - 1]), v1, value);
      }
      if (y > 0 && y < dy && yt === y) {
        point[1] = smooth1(y, valid(values[(yt - 1) * dx + xt]), v1, value);
      }
    });
  }
  contours.contour = contour;
  contours.size = function(_) {
    if (!arguments.length) return [dx, dy];
    var _0 = Math.floor(_[0]), _1 = Math.floor(_[1]);
    if (!(_0 >= 0 && _1 >= 0)) throw new Error("invalid size");
    return dx = _0, dy = _1, contours;
  };
  contours.thresholds = function(_) {
    return arguments.length ? (threshold = typeof _ === "function" ? _ : Array.isArray(_) ? constant_default(slice.call(_)) : constant_default(_), contours) : threshold;
  };
  contours.smooth = function(_) {
    return arguments.length ? (smooth = _ ? smoothLinear : noop_default, contours) : smooth === smoothLinear;
  };
  return contours;
}
function finite(x) {
  return isFinite(x) ? x : NaN;
}
function above(x, value) {
  return x == null ? false : +x >= value;
}
function valid(v) {
  return v == null || isNaN(v = +v) ? -Infinity : v;
}
function smooth1(x, v0, v1, value) {
  const a = value - v0;
  const b = v1 - v0;
  const d = isFinite(a) || isFinite(b) ? a / b : Math.sign(a) / Math.sign(b);
  return isNaN(d) ? x : x + d - 0.5;
}

// src/tools/specimenTreeCore.ts
function mulberry32(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/tools/flowFieldCore.ts
var TAU = Math.PI * 2;

// src/tools/contourCore.ts
var CW = 680;
var CH = 580;
var DEFAULT_CONTOUR = {
  seed: 46933,
  fieldScale: 3,
  octaves: 0,
  warp: 0,
  levels: 10,
  fill: 0.6,
  lineWidth: 0.3,
  // Ink treatment, both dialled in against the reference and locked — no
  // sliders, so the pass always fattens the contours and breaks them by this
  // much.
  stamp: 0.39,
  cutout: 0.72,
  imageInfluence: 0.8,
  contrast: 1.1
};

// _cover.ts
var W = 1080;
var H = 1080;
function buildField(gw2, gh2, w, h, p) {
  const rng = mulberry32(p.seed);
  const noise = createNoise2D(rng);
  const warpNoiseX = createNoise2D(mulberry32(p.seed ^ 4660));
  const warpNoiseY = createNoise2D(mulberry32(p.seed ^ 39612));
  const octaves = Math.max(1, Math.round(p.octaves));
  const cell = Math.max(w, h) / p.fieldScale;
  const fbm = (nx, ny, fn) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * fn(nx * freq, ny * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
  const values = new Float64Array(gw2 * gh2);
  for (let j = 0; j < gh2; j++) {
    for (let i = 0; i < gw2; i++) {
      const px = i / (gw2 - 1) * w;
      const py = j / (gh2 - 1) * h;
      const nx = px / cell;
      const ny = py / cell;
      const qx = warpNoiseX(nx, ny);
      const qy = warpNoiseY(nx, ny);
      const n = fbm(nx + p.warp * qx, ny + p.warp * qy, noise);
      values[j * gw2 + i] = (n + 1) / 2;
    }
  }
  return values;
}
function fieldStats(values, gw2, gh2, w, h) {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < values.length; k++) {
    if (values[k] < lo) lo = values[k];
    if (values[k] > hi) hi = values[k];
  }
  const sx = w / (gw2 - 1);
  const sy = h / (gh2 - 1);
  let sum = 0, n = 0;
  for (let j = 1; j < gh2 - 1; j++) {
    for (let i = 1; i < gw2 - 1; i++) {
      const gx = (values[j * gw2 + i + 1] - values[j * gw2 + i - 1]) / (2 * sx);
      const gy = (values[(j + 1) * gw2 + i] - values[(j - 1) * gw2 + i]) / (2 * sy);
      sum += Math.hypot(gx, gy);
      n++;
    }
  }
  return { lo, hi, meanGrad: sum / n };
}
function trace(p, levels, w = W, h = H) {
  const cellPx2 = 3;
  const gw2 = Math.max(8, Math.round(w / cellPx2));
  const gh2 = Math.max(8, Math.round(h / cellPx2));
  const values = buildField(gw2, gh2, w, h, p);
  const { lo, hi } = fieldStats(values, gw2, gh2, w, h);
  if (!isFinite(lo) || hi <= lo) return { lines: [], len: 0 };
  const sorted = Float64Array.from(values);
  sorted.sort();
  const n = sorted.length;
  const fill = Math.min(1, Math.max(0, p.fill));
  const lv = Math.max(2, Math.round(levels));
  const raw = [];
  for (let l = 1; l <= lv; l++) {
    const t = l / (lv + 1);
    const linear = lo + (hi - lo) * t;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
    raw.push(linear * (1 - fill) + sorted[idx] * fill);
  }
  const thresholds = [];
  for (const t of raw) if (!thresholds.length || t > thresholds[thresholds.length - 1]) thresholds.push(t);
  if (thresholds.length < 2) return { lines: [], len: 0 };
  const geo = contours_default().size([gw2, gh2]).thresholds(thresholds)(Array.from(values));
  const sx = w / (gw2 - 1);
  const sy = h / (gh2 - 1);
  const minRingArea = w * h * 24e-4;
  const lines = [];
  let len = 0;
  for (const multi of geo) {
    for (const polygon of multi.coordinates) {
      for (const ring of polygon) {
        const pts = [];
        for (const [gx, gy] of ring) pts.push(gx * sx, gy * sy);
        if (pts.length < 6) continue;
        let a2 = 0;
        for (let i = 0, m = pts.length / 2; i < m; i++) {
          const j = (i + 1) % m;
          a2 += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
        }
        if (Math.abs(a2) / 2 < minRingArea) continue;
        for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        lines.push(pts);
      }
    }
  }
  return { lines, len };
}
var CELL = 6;
function gapStats(lines, w = W, h = H) {
  const gw2 = Math.ceil(w / CELL), gh2 = Math.ceil(h / CELL);
  const INF = 1e9;
  const d = new Float64Array(gw2 * gh2).fill(INF);
  for (const pts of lines) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL));
      for (let s2 = 0; s2 <= steps; s2++) {
        const gx = Math.min(gw2 - 1, Math.max(0, Math.round((x0 + (x1 - x0) * s2 / steps) / CELL)));
        const gy = Math.min(gh2 - 1, Math.max(0, Math.round((y0 + (y1 - y0) * s2 / steps) / CELL)));
        d[gy * gw2 + gx] = 0;
      }
    }
  }
  const a = 1, b = Math.SQRT2;
  const at = (x, y) => x < 0 || y < 0 || x >= gw2 || y >= gh2 ? INF : d[y * gw2 + x];
  for (let y = 0; y < gh2; y++) for (let x = 0; x < gw2; x++) {
    const k = y * gw2 + x;
    d[k] = Math.min(d[k], at(x - 1, y) + a, at(x, y - 1) + a, at(x - 1, y - 1) + b, at(x + 1, y - 1) + b);
  }
  for (let y = gh2 - 1; y >= 0; y--) for (let x = gw2 - 1; x >= 0; x--) {
    const k = y * gw2 + x;
    d[k] = Math.min(d[k], at(x + 1, y) + a, at(x, y + 1) + a, at(x + 1, y + 1) + b, at(x - 1, y + 1) + b);
  }
  const s = Float64Array.from(d).sort();
  const q = (p) => s[Math.floor(p * (s.length - 1))] * CELL;
  let over = 0;
  for (let k = 0; k < d.length; k++) if (d[k] * CELL > 60) over++;
  return { p95: q(0.95), max: q(1), blank60: over / d.length };
}
var SEEDS = [];
for (let i = 0; i < 120; i++) SEEDS.push((i * 7919 + 46933) % 99999 + 1);
var cellPx = 3;
var gw = Math.max(8, Math.round(W / cellPx));
var gh = Math.max(8, Math.round(H / cellPx));
var implied = [];
var info = [];
for (const seed of SEEDS) {
  const p = { ...DEFAULT_CONTOUR, seed };
  const values = buildField(gw, gh, W, H, p);
  const { lo, hi, meanGrad } = fieldStats(values, gw, gh, W, H);
  const delta = (hi - lo) / (DEFAULT_CONTOUR.levels + 1);
  const spacing = delta / meanGrad;
  implied.push(spacing);
  info.push({ seed, range: hi - lo, grad: meanGrad, spacing, len: 0 });
}
var sortedSpacing = [...implied].sort((a, b) => a - b);
var medSpacing = sortedSpacing[Math.floor(sortedSpacing.length / 2)];
console.log(
  `current levels=10 \u2192 implied line spacing: min ${sortedSpacing[0].toFixed(0)}px  med ${medSpacing.toFixed(0)}px  max ${sortedSpacing[sortedSpacing.length - 1].toFixed(0)}px  (canvas ${W}px)`
);
console.log(`field range: min ${Math.min(...info.map((i) => i.range)).toFixed(2)} max ${Math.max(...info.map((i) => i.range)).toFixed(2)}`);
var K = medSpacing / Math.min(W, H);
console.log(`median spacing is ${(K * 100).toFixed(1)}% of the short edge
`);
function adaptiveLevels(p, w, h, targetFrac, min, max) {
  const values = buildField(gw, gh, w, h, p);
  const { lo, hi, meanGrad } = fieldStats(values, gw, gh, w, h);
  const spacing = targetFrac * Math.min(w, h);
  const delta = spacing * meanGrad;
  const lv = Math.round((hi - lo) / delta) - 1;
  return Math.min(max, Math.max(min, lv));
}
var rows = [];
var variants = [
  ["current fixed lv10", () => DEFAULT_CONTOUR.levels],
  ["adaptive (med spacing)", (p) => adaptiveLevels(p, W, H, K, 6, 30)],
  ["adaptive 0.8x spacing", (p) => adaptiveLevels(p, W, H, K * 0.8, 6, 34)],
  ["adaptive 0.65x spacing", (p) => adaptiveLevels(p, W, H, K * 0.65, 6, 40)]
];
for (const [name, pick] of variants) {
  const row = { name, p95: [], max: [], blank: [], lv: [], len: [] };
  for (const seed of SEEDS) {
    const p = { ...DEFAULT_CONTOUR, seed };
    const lv = pick(p);
    const { lines, len } = trace(p, lv);
    const g = gapStats(lines);
    row.p95.push(g.p95);
    row.max.push(g.max);
    row.blank.push(g.blank60);
    row.lv.push(lv);
    row.len.push(len);
  }
  rows.push(row);
}
var st = (ns) => {
  const s = [...ns].sort((a, b) => a - b);
  const at = (q) => s[Math.floor(q * (s.length - 1))];
  return { min: s[0], med: at(0.5), p90: at(0.9), max: s[s.length - 1] };
};
for (const r of rows) {
  const g = st(r.max), p = st(r.p95), b = st(r.blank), lv = st(r.lv), L = st(r.len);
  console.log(
    `${r.name.padEnd(24)} hole radius med ${g.med.toFixed(0)}px p90 ${g.p90.toFixed(0)}px worst ${g.max.toFixed(0)}px | gap p95 med ${p.med.toFixed(0)}px | >60px-blank med ${(b.med * 100).toFixed(1)}% worst ${(b.max * 100).toFixed(1)}% | levels ${lv.min}-${lv.max} (med ${lv.med}) | ink length med ${(L.med / 1e3).toFixed(1)}k spread ${(L.min / 1e3).toFixed(1)}k-${(L.max / 1e3).toFixed(1)}k`
  );
}
console.log("");
for (const [w, h] of [[CW, CH], [1080, 1350], [1920, 1080]]) {
  const maxes = [];
  const lvs = [];
  for (const seed of SEEDS.slice(0, 40)) {
    const p = { ...DEFAULT_CONTOUR, seed };
    const lv2 = adaptiveLevels(p, w, h, K * 0.8, 6, 34);
    const { lines } = trace(p, lv2, w, h);
    maxes.push(gapStats(lines, w, h).max);
    lvs.push(lv2);
  }
  const g = st(maxes), lv = st(lvs);
  console.log(`${w}x${h} adaptive 0.8x \u2192 hole med ${g.med.toFixed(0)}px worst ${g.max.toFixed(0)}px | levels ${lv.min}-${lv.max}`);
}
