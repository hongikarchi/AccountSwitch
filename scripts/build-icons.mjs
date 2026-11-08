// Generate every raster icon in assets/brand from the mark's geometry: the Windows app icon, the
// tray icons for light and dark taskbars, and the macOS icon and menu bar template. Shapes are
// computed analytically and supersampled; PNG and ICO are written directly, so nothing beyond Node
// is needed. The results are committed, so a normal build does not run this. After changing the
// mark, run `npm run build:icons` and keep assets/brand/logo.svg in step with MASTER.
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The mark on its 24-unit grid; the same numbers as assets/brand/logo.svg. */
export const MASTER = {
  grid: 24,
  tileRadius: 5,
  trackX: 3,
  trackY: 8,
  trackWidth: 18,
  trackHeight: 8,
  knobRadius: 3,
};

export const APP_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
export const TRAY_ICON_SIZES = [16, 20, 24, 32];

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

export const PALETTES = {
  // Also the tray icon for a light taskbar.
  app: { tile: BLACK, track: WHITE, knob: BLACK },
  darkTaskbar: { tile: WHITE, track: BLACK, knob: WHITE },
  // macOS draws a template from its alpha alone, so the track is a hole in the tile.
  template: { tile: BLACK, track: CLEAR, knob: BLACK },
};

// Plain scaling blurs the small sizes, so these are placed by hand on whole pixels: a clean white
// ring around the knob, and the knob clearly right of center. Numbers are in pixels of that size.
const HINTED = {
  16: { tileRadius: 3, trackX: 2, trackY: 5, trackHeight: 6, knobRadius: 2 },
  20: { tileRadius: 4, trackX: 2, trackY: 6, trackHeight: 8, knobRadius: 3 },
  32: { tileRadius: 7, trackX: 4, trackY: 10, trackHeight: 12, knobRadius: 4 },
};

/**
 * Pixel geometry of the mark at one size. The track stays centered in the tile and the knob stays
 * concentric with the track's right cap, so one set of numbers per size is enough.
 */
export function geometryFor(size) {
  const scale = size / MASTER.grid;
  const ring = (MASTER.trackHeight / 2 - MASTER.knobRadius) * scale;
  const trackX = Math.round(MASTER.trackX * scale);
  const trackY = Math.round(MASTER.trackY * scale);
  const halfTrack = size / 2 - trackY;
  const hinted = HINTED[size] ?? {
    tileRadius: MASTER.tileRadius * scale,
    trackX,
    trackY,
    trackHeight: halfTrack * 2,
    knobRadius: halfTrack - Math.max(1, Math.round(ring)),
  };
  const trackWidth = size - hinted.trackX * 2;
  const trackRadius = hinted.trackHeight / 2;
  return {
    size,
    tile: { x: 0, y: 0, width: size, height: size, radius: hinted.tileRadius },
    track: {
      x: hinted.trackX,
      y: hinted.trackY,
      width: trackWidth,
      height: hinted.trackHeight,
      radius: trackRadius,
    },
    knob: {
      cx: hinted.trackX + trackWidth - trackRadius,
      cy: size / 2,
      radius: hinted.knobRadius,
    },
  };
}

/** The same mark drawn smaller inside a larger transparent canvas (the macOS icon grid). */
export function insetGeometry(size, inset) {
  const inner = geometryFor(size - inset * 2);
  const move = ({ x, y, ...rest }) => ({ x: x + inset, y: y + inset, ...rest });
  return {
    size,
    tile: move(inner.tile),
    track: move(inner.track),
    knob: { ...inner.knob, cx: inner.knob.cx + inset, cy: inner.knob.cy + inset },
  };
}

function inRoundedRect(px, py, { x, y, width, height, radius }) {
  const dx = Math.max(x + radius - px, px - (x + width - radius), 0);
  const dy = Math.max(y + radius - py, py - (y + height - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inCircle(px, py, { cx, cy, radius }) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Draw a geometry into straight-alpha RGBA bytes, row by row from the top. */
export function render(geometry, palette) {
  const { size, tile, track, knob } = geometry;
  const samples = size <= 64 ? 16 : size <= 256 ? 8 : 4;
  const weight = 1 / (samples * samples);
  const rgba = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < samples; sy++) {
        const py = row + (sy + 0.5) / samples;
        for (let sx = 0; sx < samples; sx++) {
          const px = column + (sx + 0.5) / samples;
          const color = inCircle(px, py, knob)
            ? palette.knob
            : inRoundedRect(px, py, track)
              ? palette.track
              : inRoundedRect(px, py, tile)
                ? palette.tile
                : CLEAR;
          // Sum premultiplied, so a clear neighbour cannot pull an edge toward its color.
          const opacity = color[3] / 255;
          red += color[0] * opacity;
          green += color[1] * opacity;
          blue += color[2] * opacity;
          alpha += opacity;
        }
      }
      const offset = (row * size + column) * 4;
      if (alpha > 0) {
        rgba[offset] = Math.round(red / alpha);
        rgba[offset + 1] = Math.round(green / alpha);
        rgba[offset + 2] = Math.round(blue / alpha);
        rgba[offset + 3] = Math.round(alpha * weight * 255);
      }
    }
  }
  return rgba;
}

function pngChunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

/** Encode straight-alpha RGBA bytes as an 8-bit RGBA PNG. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bits per channel.
  header[9] = 6; // RGBA.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++)
    rgba.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A 32-bit ICO bitmap: BGRA rows from the bottom, then a 1-bit mask of the clear pixels. */
function encodeDib(size, rgba) {
  const maskStride = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // Color rows plus mask rows, by the format's definition.
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);
  const pixels = Buffer.alloc(size * size * 4);
  const mask = Buffer.alloc(maskStride * size);
  for (let row = 0; row < size; row++) {
    const flipped = size - 1 - row;
    for (let column = 0; column < size; column++) {
      const from = (row * size + column) * 4;
      const to = (flipped * size + column) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
      if (rgba[from + 3] === 0) mask[flipped * maskStride + (column >> 3)] |= 0x80 >> (column & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

/**
 * Write an ICO. Below 256 px frames are bitmaps, which every Windows component reads; the 256 px
 * frame is a PNG, which keeps the file small.
 */
export function encodeIco(frames) {
  const directory = Buffer.alloc(6 + frames.length * 16);
  directory.writeUInt16LE(1, 2); // Type: icon.
  directory.writeUInt16LE(frames.length, 4);
  const images = frames.map(({ size, rgba }) =>
    size >= 256 ? encodePng(size, size, rgba) : encodeDib(size, rgba),
  );
  let offset = directory.length;
  frames.forEach(({ size }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size >= 256 ? 0 : size; // 0 means 256.
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  return Buffer.concat([directory, ...images]);
}

const icoFrom = (sizes, palette) =>
  encodeIco(sizes.map((size) => ({ size, rgba: render(geometryFor(size), palette) })));

const pngFrom = (geometry, palette) =>
  encodePng(geometry.size, geometry.size, render(geometry, palette));

/** Every generated file, by name in assets/brand. */
export function buildAll() {
  return {
    'accountswitch.ico': icoFrom(APP_ICON_SIZES, PALETTES.app),
    'tray-light-taskbar.ico': icoFrom(TRAY_ICON_SIZES, PALETTES.app),
    'tray-dark-taskbar.ico': icoFrom(TRAY_ICON_SIZES, PALETTES.darkTaskbar),
    // Apple's icon grid: the tile takes 824 of 1024 px, so it matches other apps in the Dock.
    'icon.png': pngFrom(insetGeometry(1024, 100), PALETTES.app),
    'menubar-template.png': pngFrom(geometryFor(18), PALETTES.template),
    'menubar-template@2x.png': pngFrom(geometryFor(36), PALETTES.template),
  };
}

if (import.meta.main) {
  const output = fileURLToPath(new URL('../assets/brand', import.meta.url));
  mkdirSync(output, { recursive: true });
  const icons = buildAll();
  for (const [name, bytes] of Object.entries(icons)) {
    writeFileSync(join(output, name), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
  }
  // The committed copies the two build scripts refresh, so they cannot lag on any one platform.
  const desktop = fileURLToPath(new URL('../src/desktop', import.meta.url));
  writeFileSync(join(desktop, 'shell', 'accountswitch.ico'), icons['accountswitch.ico']);
  writeFileSync(join(desktop, 'mac', 'icon.png'), icons['icon.png']);
}
