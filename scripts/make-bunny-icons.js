#!/usr/bin/env node
"use strict";

// desk-pet: the bunny build's app icons, drawn from the bunny's own idle pose
// (themes/bunny/assets/idle.svg, first frame), so they follow every art sync.
//
//   node scripts/make-bunny-icons.js [theme-folder] [assets-folder]
//
// Writes into assets/:
//   icon.ico                      Windows app, installer, shortcuts (16–256 px)
//   icon.png                      1024 px, the bunny on a mint rounded square,
//                                 nearly full-bleed: the Windows/Linux tray
//                                 source (resized to 32 px at runtime)
//   dock-icon.png                 1024 px on Apple's Big Sur grid (macOS app
//                                 icon and Dock)
//   icons/<n>x<n>.png             Linux sizes
//   tray-iconTemplate(@2x).png    macOS menu-bar silhouette, 18 / 36 px
// The SVG is rasterized here (its rects only, exact area coverage), and the
// PNG/ICO files are encoded here too (zlib only): no image tools needed.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------- the idle SVG as flat rects ----------


function parseAttrs(text) {
  const attrs = {};
  for (const m of String(text).matchAll(/([a-zA-Z_:-]+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function normalizeHex(value) {
  const v = String(value).trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
  if (/^#[0-9A-F]{6}$/.test(v)) return v;
  throw new Error(`Unsupported fill: ${value}`);
}

function parseTransform(value) {
  let s = 1, tx = 0, ty = 0;
  if (!value) return { s, tx, ty };
  // Only translate() then scale(), the form the bunny's build writes.
  const t = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(value);
  const k = /scale\(\s*(-?[\d.]+)\s*\)/.exec(value);
  if (/rotate|matrix|skew/.test(value)) throw new Error(`Unsupported transform: ${value}`);
  if (t) { tx = Number(t[1]); ty = Number(t[2]); }
  if (k) s = Number(k[1]);
  return { s, tx, ty };
}

/** Every <rect> in document order, in canvas units: { x0, y0, x1, y1, fill, opacity }. */
function svgRects(svgText) {
  const body = String(svgText).replace(/<defs>[\s\S]*?<\/defs>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack = [{ s: 1, tx: 0, ty: 0, fill: null }];
  const rects = [];
  for (const m of body.matchAll(/<(\/?)(g|rect)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, attrText, selfClosing] = m;
    if (tag === "g" && closing) { stack.pop(); continue; }
    const attrs = parseAttrs(attrText);
    const parent = stack[stack.length - 1];
    if (tag === "g") {
      const local = parseTransform(attrs.transform);
      const g = {
        s: parent.s * local.s,
        tx: parent.tx + parent.s * local.tx,
        ty: parent.ty + parent.s * local.ty,
        fill: attrs.fill || parent.fill,
      };
      if (!selfClosing) stack.push(g);
      continue;
    }
    if (attrs.transform) throw new Error("Unsupported transform on a rect");
    const x = Number(attrs.x || 0), y = Number(attrs.y || 0);
    const w = Number(attrs.width || 0), h = Number(attrs.height || 0);
    if (!(w > 0 && h > 0)) continue;
    rects.push({
      x0: parent.tx + parent.s * x,
      y0: parent.ty + parent.s * y,
      x1: parent.tx + parent.s * (x + w),
      y1: parent.ty + parent.s * (y + h),
      fill: normalizeHex(attrs.fill || parent.fill || "#000"),
      opacity: attrs.opacity === undefined ? 1 : Number(attrs.opacity),
    });
  }
  return rects;
}

// ---------- drawing ----------

const hex = (h) => {
  const v = normalizeHex(h).slice(1);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};

/** A premultiplied float RGBA canvas. */
function canvas(n) {
  return { n, px: new Float64Array(n * n * 4) };
}

/** Paint `rgb` at `alpha` over an axis-aligned box, weighting each pixel by the area it covers. */
function fillBox(cv, x0, y0, x1, y1, rgb, alpha) {
  const { n, px } = cv;
  const ix0 = Math.max(0, Math.floor(x0)), iy0 = Math.max(0, Math.floor(y0));
  const ix1 = Math.min(n, Math.ceil(x1)), iy1 = Math.min(n, Math.ceil(y1));
  for (let y = iy0; y < iy1; y++) {
    const cy = Math.min(y + 1, y1) - Math.max(y, y0);
    if (cy <= 0) continue;
    for (let x = ix0; x < ix1; x++) {
      const cx = Math.min(x + 1, x1) - Math.max(x, x0);
      if (cx <= 0) continue;
      const a = alpha * cx * cy;
      const o = (y * n + x) * 4;
      px[o] = px[o] * (1 - a) + (rgb[0] / 255) * a;
      px[o + 1] = px[o + 1] * (1 - a) + (rgb[1] / 255) * a;
      px[o + 2] = px[o + 2] * (1 - a) + (rgb[2] / 255) * a;
      px[o + 3] = px[o + 3] * (1 - a) + a;
    }
  }
}

/** A rounded square (corners anti-aliased with 4×4 samples), top band `top`, lower band `low` below `floorY`. */
function roundedSquare(cv, { m, b, r, top, low, floorY }) {
  const { n } = cv;
  const inside = (x, y) => {
    const lx = x - m, ly = y - m;
    if (lx < 0 || ly < 0 || lx > b || ly > b) return false;
    const cx = Math.min(Math.max(lx, r), b - r), cy = Math.min(Math.max(ly, r), b - r);
    return (lx - cx) ** 2 + (ly - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let cover = 0;
    for (let u = 0; u < 4; u++) for (let v = 0; v < 4; v++) if (inside(x + (u + 0.5) / 4, y + (v + 0.5) / 4)) cover++;
    if (!cover) continue;
    // the floor band starts mid-pixel too
    const lowShare = Math.min(1, Math.max(0, y + 1 - floorY));
    const rgb = top.map((c, i) => c * (1 - lowShare) + low[i] * lowShare);
    fillBox(cv, x, y, x + 1, y + 1, rgb, cover / 16);
  }
}

/** The bunny's rects at `scale` px per canvas unit with canvas (0, 0) at (ox, oy). */
function drawBunny(cv, rects, { scale, ox, oy, shadow }) {
  for (const r of rects) {
    // The theme's ground shadow is translucent black; on the tile it is a darker mint.
    const isShadow = r.fill === "#000000" && r.opacity < 1;
    const rgb = isShadow ? shadow : hex(r.fill);
    const alpha = isShadow ? 1 : r.opacity;
    fillBox(cv, ox + r.x0 * scale, oy + r.y0 * scale, ox + r.x1 * scale, oy + r.y1 * scale, rgb, alpha);
  }
}

/** Straight 8-bit RGBA from a premultiplied canvas. */
function toRgba(cv) {
  const { n, px } = cv;
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const a = px[i * 4 + 3];
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(Math.min(1, px[i * 4 + c] / a) * 255);
    out[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return out;
}

// ---------- the icon designs (all measured on a 1024 grid, scaled to any size) ----------

const MINT = { top: hex("#BFE5CB"), low: hex("#AEDBBD"), shadow: hex("#93C9A4") };

// macOS Big Sur grid: 824 px body, 100 px margin; the bunny 25 px per unit,
// so its 0.6-unit pixels are whole 15 px squares.
const BIG_SUR = { m: 100, b: 824, r: 185, scale: 25, ox: 512 - 10 * 25, oy: 292 };
// Windows: the square fills more of the tile and the bunny is larger.
const WINDOWS = { m: 36, b: 952, r: 200, scale: 30, ox: 512 - 10 * 30, oy: 246 };
// Small sizes (taskbar, title bar, the 32 px tray): nearly full-bleed, the bunny
// as large as it fits, so its ears and face survive at 16–32 px.
const SMALL = { m: 16, b: 992, r: 210, scale: 34, ox: 512 - 10 * 34, oy: 203 };
const frameFor = (size) => (size <= 32 ? SMALL : WINDOWS);

function appIcon(rects, size, frame) {
  const k = size / 1024;
  const cv = canvas(size);
  roundedSquare(cv, {
    m: frame.m * k, b: frame.b * k, r: frame.r * k,
    top: MINT.top, low: MINT.low, floorY: (frame.m + frame.b * 0.72) * k,
  });
  drawBunny(cv, rects, { scale: frame.scale * k, ox: frame.ox * k, oy: frame.oy * k, shadow: MINT.shadow });
  return toRgba(cv);
}

// macOS menu-bar Template: the bunny in black, eyes cut out as whole pixels.
function trayTemplate(rects, size) {
  const scale = size / 24; // the pose is 19.2 × 23.8 units
  const ox = size / 2 - 10 * scale, oy = (size - 23.8 * scale) / 2 + 2.8 * scale;
  const cv = canvas(size);
  const eyes = rects.filter((r) => r.fill === "#2B1A0E" && r.y1 - r.y0 > 1.5);
  const solid = rects.filter((r) => r.opacity >= 1 && r.fill !== "#F2949C" && r.fill !== "#2B1A0E");
  for (const r of solid) fillBox(cv, ox + r.x0 * scale, oy + r.y0 * scale, ox + r.x1 * scale, oy + r.y1 * scale, [0, 0, 0], 1);
  const rgba = toRgba(cv);
  // keep the silhouette bold at menu-bar size
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = rgba[i] >= 96 ? 255 : 0;
  for (const e of eyes) {
    const cx = ox + ((e.x0 + e.x1) / 2) * scale, top = oy + e.y0 * scale, bottom = oy + e.y1 * scale;
    const w = Math.max(1, Math.round((e.x1 - e.x0) * scale));
    const x0 = Math.round(cx - w / 2);
    for (let y = Math.round(top); y < Math.max(Math.round(top) + 2, Math.round(bottom)); y++) {
      for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) rgba[(y * size + x) * 4 + 3] = 0;
    }
  }
  return rgba;
}

// ---------- PNG and ICO ----------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** A 32-bit BMP icon image (BITMAPINFOHEADER, bottom-up BGRA, AND mask), as Windows' own icons use. */
function bmpIconImage(size, rgba) {
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskRow * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskRow * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = (row * size + x) * 4;
      pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}
function ico(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([head, ...entries, ...images.map((image) => image.data)]);
}

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];

function makeBunnyIcons({ themeDir, assetsDir }) {
  const theme = JSON.parse(fs.readFileSync(path.join(themeDir, "theme.json"), "utf8"));
  const idle = theme.states && Array.isArray(theme.states.idle) ? theme.states.idle[0] : "idle.svg";
  const idleSvg = fs.readFileSync(path.join(themeDir, "assets", idle), "utf8");
  const skipped = idleSvg.replace(/<defs>[\s\S]*?<\/defs>/, "").match(/<(path|circle|ellipse|polygon|polyline|line|image|use|text)\b/g);
  if (skipped) console.warn(`make-bunny-icons: ${idle} has shapes this rasterizer skips (${[...new Set(skipped)].join(", ")}); check the icons.`);
  const rects = svgRects(idleSvg);
  if (rects.length === 0) throw new Error(`No rects found in ${idle}`);

  const written = [];
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(assetsDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, rel), data);
    written.push(rel);
  };
  // icon.png is the Windows/Linux tray source (resized to 32 px at runtime),
  // so it uses the small-size frame; the macOS app and Dock use dock-icon.png.
  write("icon.png", png(1024, appIcon(rects, 1024, SMALL)));
  write("dock-icon.png", png(1024, appIcon(rects, 1024, BIG_SUR)));
  for (const size of LINUX_SIZES) write(`icons/${size}x${size}.png`, png(size, appIcon(rects, size, frameFor(size))));
  write("icon.ico", ico(ICO_SIZES.map((size) => ({ size, data: bmpIconImage(size, appIcon(rects, size, frameFor(size))) }))));
  write("tray-iconTemplate.png", png(18, trayTemplate(rects, 18)));
  write("tray-iconTemplate@2x.png", png(36, trayTemplate(rects, 36)));
  return written;
}

module.exports = { makeBunnyIcons, svgRects, ICO_SIZES };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const [themeArg, assetsArg] = process.argv.slice(2);
  const themeDir = path.resolve(themeArg || path.join(root, "themes", "bunny"));
  const assetsDir = path.resolve(assetsArg || path.join(root, "assets"));
  try {
    const written = makeBunnyIcons({ themeDir, assetsDir });
    console.log(`Wrote ${written.length} icon file(s) into ${assetsDir}`);
  } catch (err) {
    console.error(`Icon build failed: ${err.message}`);
    process.exit(1);
  }
}
