// Minimal animated GIF89a encoder (global palette, LZW, looping). No dependencies.

function lzw(minCode, pixels) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1, dict = new Map();
  const out = [];
  let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits; curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = prefix * 256 + k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); next = eoi + 1; codeSize = minCode + 1; dict = new Map(); }
    else { if (next >= (1 << codeSize)) codeSize++; dict.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

// palette: [[r,g,b], ...] (<=256); frames: [{pixels: Uint8Array(width*height) of palette indexes, delay: centiseconds}]
export function encodeGif(width, height, palette, frames) {
  const bytes = [];
  const b = v => bytes.push(v & 255), w16 = v => { b(v); b(v >> 8); }, str = s => { for (const c of s) b(c.charCodeAt(0)); };
  let bits = 1; while ((1 << bits) < palette.length) bits++;
  str('GIF89a'); w16(width); w16(height);
  b(0x80 | ((bits - 1) << 4) | (bits - 1)); b(0); b(0);
  for (let i = 0; i < (1 << bits); i++) { const c = palette[i] || [0, 0, 0]; b(c[0]); b(c[1]); b(c[2]); }
  b(0x21); b(0xff); b(11); str('NETSCAPE2.0'); b(3); b(1); w16(0); b(0); // loop forever
  const minCode = Math.max(2, bits);
  for (const f of frames) {
    b(0x21); b(0xf9); b(4); b(0x04); w16(Math.max(2, Math.round(f.delay))); b(0); b(0);
    b(0x2c); w16(0); w16(0); w16(width); w16(height); b(0);
    b(minCode);
    const data = lzw(minCode, f.pixels);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); b(n); for (let j = 0; j < n; j++) bytes.push(data[i + j]); }
    b(0);
  }
  b(0x3b);
  return Buffer.from(bytes);
}
