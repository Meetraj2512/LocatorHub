/**
 * Generates icons/icon16.png, icons/icon48.png, icons/icon128.png
 * Pure Node.js — no npm packages required.
 * Run: node create-icons.js
 */
'use strict';

const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

// ── CRC32 ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk ─────────────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.allocUnsafe(4);
  const crcBuf    = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

// ── PNG builder ───────────────────────────────────────────────────────────────
// pixelFn(x, y) → [r, g, b]

function buildPNG(width, height, pixelFn) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 2; // color type: RGB (truecolor)
  ihdr[10] = 0; // deflate compression
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const rowBytes = 1 + width * 3; // 1 filter byte + 3 bytes per pixel
  const raw = Buffer.allocUnsafe(height * rowBytes);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const off = y * rowBytes + 1 + x * 3;
      raw[off]     = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }

  return Buffer.concat([
    SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Icon pixel function ────────────────────────────────────────────────────────
// Draws a target/crosshair on a deep-blue background — fitting for a "locator" tool.

const BG    = [26, 115, 232]; // #1A73E8
const WHITE = [255, 255, 255];

function targetPixel(size) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR    = size * 0.40;
  const innerR    = size * 0.32;
  const centerR   = size * 0.09;
  const armHalf   = size * 0.055;
  const armStart  = centerR + size * 0.02;
  const armEnd    = innerR - size * 0.02;

  return function (x, y) {
    const dx   = x - cx + 0.5;
    const dy   = y - cy + 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Outer ring
    if (dist >= innerR && dist <= outerR) return WHITE;
    // Centre dot
    if (dist <= centerR) return WHITE;
    // Cross-arms (horizontal & vertical)
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (ady <= armHalf && adx >= armStart && adx <= armEnd) return WHITE;
    if (adx <= armHalf && ady >= armStart && ady <= armEnd) return WHITE;

    return BG;
  };
}

// ── Write icons ───────────────────────────────────────────────────────────────

fs.mkdirSync(path.join(__dirname, 'icons'), { recursive: true });

for (const size of [16, 48, 128]) {
  const png = buildPNG(size, size, targetPixel(size));
  const out = path.join(__dirname, 'icons', `icon${size}.png`);
  fs.writeFileSync(out, png);
  process.stdout.write(`Created ${out}  (${size}×${size}, ${png.length} bytes)\n`);
}

process.stdout.write('Done.\n');
