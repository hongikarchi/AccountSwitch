import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crc32, inflateSync } from 'node:zlib';
import {
  APP_ICON_SIZES,
  MASTER,
  PALETTES,
  TRAY_ICON_SIZES,
  encodeIco,
  encodePng,
  geometryFor,
  render,
} from '../scripts/build-icons.mjs';

const repo = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const PNG_SIGNATURE = '89504e470d0a1a0a';

/** Read a PNG strictly: signature, every chunk's checksum, header and pixel data length. */
function readPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), PNG_SIGNATURE);
  const chunks = {};
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const typed = bytes.subarray(at + 4, at + 8 + length);
    assert.equal(bytes.readUInt32BE(at + 8 + length), crc32(typed), `${type} checksum`);
    chunks[type] = typed.subarray(4);
    at += 12 + length;
  }
  assert.ok(chunks.IEND, 'ends with IEND');
  const width = chunks.IHDR.readUInt32BE(0);
  const height = chunks.IHDR.readUInt32BE(4);
  assert.equal(chunks.IHDR[8], 8);
  assert.equal(chunks.IHDR[9], 6);
  const raw = inflateSync(chunks.IDAT);
  assert.equal(raw.length, (width * 4 + 1) * height);
  return { width, height, raw };
}

/** Read an ICO directory strictly, and check that each image is what its entry says. */
function readIco(bytes) {
  assert.equal(bytes.readUInt16LE(0), 0);
  assert.equal(bytes.readUInt16LE(2), 1);
  const count = bytes.readUInt16LE(4);
  let expectedOffset = 6 + count * 16;
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const size = bytes[entry] || 256;
    assert.equal(bytes[entry + 1] || 256, size);
    assert.equal(bytes.readUInt16LE(entry + 4), 1);
    assert.equal(bytes.readUInt16LE(entry + 6), 32);
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    assert.equal(offset, expectedOffset);
    const image = bytes.subarray(offset, offset + length);
    assert.equal(image.length, length);
    if (image.subarray(0, 8).toString('hex') === PNG_SIGNATURE) {
      const { width, height } = readPng(image);
      assert.deepEqual([width, height], [size, size]);
    } else {
      assert.equal(image.readUInt32LE(0), 40);
      assert.equal(image.readInt32LE(4), size);
      assert.equal(image.readInt32LE(8), size * 2);
      assert.equal(image.readUInt16LE(14), 32);
      const maskStride = Math.ceil(size / 32) * 4;
      assert.equal(length, 40 + size * size * 4 + maskStride * size);
    }
    sizes.push(size);
    expectedOffset += length;
  }
  assert.equal(bytes.length, expectedOffset);
  return sizes;
}

const pixel = (rgba, size, x, y) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

test('the committed icons are valid and hold the listed sizes', () => {
  assert.deepEqual(readIco(repo('assets/brand/accountswitch.ico')), APP_ICON_SIZES);
  assert.deepEqual(readIco(repo('assets/brand/tray-light-taskbar.ico')), TRAY_ICON_SIZES);
  assert.deepEqual(readIco(repo('assets/brand/tray-dark-taskbar.ico')), TRAY_ICON_SIZES);
  const dimensions = (path) => {
    const { width, height } = readPng(repo(path));
    return [width, height];
  };
  assert.deepEqual(dimensions('assets/brand/icon.png'), [1024, 1024]);
  assert.deepEqual(dimensions('assets/brand/menubar-template.png'), [18, 18]);
  assert.deepEqual(dimensions('assets/brand/menubar-template@2x.png'), [36, 36]);
});

test('the copies the shell and the Mac app build from match the brand folder', () => {
  assert.ok(
    repo('src/desktop/shell/accountswitch.ico').equals(repo('assets/brand/accountswitch.ico')),
  );
  assert.ok(repo('src/desktop/mac/icon.png').equals(repo('assets/brand/icon.png')));
});

test('the SVG master and the generator agree on the mark', () => {
  const svg = repo('assets/brand/logo.svg').toString();
  const m = MASTER;
  const knobX = m.trackX + m.trackWidth - m.trackHeight / 2;
  assert.match(svg, new RegExp(`viewBox="0 0 ${m.grid} ${m.grid}"`));
  assert.match(svg, new RegExp(`<rect width="${m.grid}" height="${m.grid}" rx="${m.tileRadius}"`));
  assert.match(
    svg,
    new RegExp(
      `<rect x="${m.trackX}" y="${m.trackY}" width="${m.trackWidth}" height="${m.trackHeight}" rx="${m.trackHeight / 2}"`,
    ),
  );
  assert.match(svg, new RegExp(`<circle cx="${knobX}" cy="${m.grid / 2}" r="${m.knobRadius}"`));
});

for (const size of [16, 20, 24, 32])
  test(`at ${size} px the shapes land on whole pixels with the knob on the right`, () => {
    const { track, knob } = geometryFor(size);
    for (const value of [track.x, track.y, track.width, track.height, knob.radius])
      assert.ok(Number.isInteger(value), `${value} is a whole pixel`);
    assert.equal(track.x * 2 + track.width, size, 'centered across');
    assert.equal(track.y * 2 + track.height, size, 'centered down');
    assert.ok(knob.cx > size / 2 + 1, 'knob right of center');

    const middle = Math.floor(size / 2);
    const rgba = render(geometryFor(size), PALETTES.app);
    assert.deepEqual(pixel(rgba, size, 0, middle), [0, 0, 0, 255], 'tile');
    assert.deepEqual(pixel(rgba, size, track.x + 1, middle), [255, 255, 255, 255], 'track');
    assert.deepEqual(pixel(rgba, size, knob.cx, middle), [0, 0, 0, 255], 'knob');
    // The first pixel right of the knob: nearly white, so the ring is visible on that side too.
    const ring = pixel(rgba, size, knob.cx + knob.radius, middle);
    assert.ok(ring[0] > 230, `ring pixel is ${ring[0]}`);
    const inverted = render(geometryFor(size), PALETTES.darkTaskbar);
    assert.deepEqual(pixel(inverted, size, 0, middle), [255, 255, 255, 255], 'inverted tile');
    assert.deepEqual(pixel(inverted, size, knob.cx, middle), [255, 255, 255, 255], 'inverted knob');
  });

test('the template image is alpha only, with the track as a hole', () => {
  const rgba = render(geometryFor(18), PALETTES.template);
  for (let at = 0; at < rgba.length; at += 4)
    assert.deepEqual([...rgba.subarray(at, at + 3)], [0, 0, 0]);
  assert.equal(pixel(rgba, 18, 0, 9)[3], 255, 'tile');
  assert.equal(pixel(rgba, 18, 4, 9)[3], 0, 'track');
  assert.equal(pixel(rgba, 18, 13, 9)[3], 255, 'knob');
});

test('an ICO bitmap runs from the bottom row, in BGRA, with clear pixels masked', () => {
  // All opaque red, except a clear top left corner.
  const rgba = Buffer.alloc(16 * 16 * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba.set([255, 0, 0, 255], at);
  rgba.set([0, 0, 0, 0], 0);
  const bitmap = encodeIco([{ size: 16, rgba }]).subarray(6 + 16 + 40);
  const mask = bitmap.subarray(16 * 16 * 4);
  assert.deepEqual([...bitmap.subarray(15 * 16 * 4, 15 * 16 * 4 + 4)], [0, 0, 0, 0]);
  assert.deepEqual([...bitmap.subarray(0, 4)], [0, 0, 255, 255]);
  assert.equal(mask[15 * 4], 0x80, 'the last mask row is the top row');
  assert.equal(
    mask.subarray(0, 15 * 4).every((byte) => byte === 0),
    true,
  );
});

test('the PNG writer keeps every byte', () => {
  const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const { width, height, raw } = readPng(encodePng(2, 1, rgba));
  assert.deepEqual([width, height], [2, 1]);
  assert.deepEqual([...raw], [0, ...rgba]);
});
