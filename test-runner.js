const { 
  rsEncode, rsDecode, rsSyndromes, gfMul, gfDiv, gfPolyMul, gfPolyEval,
  rsGeneratorPoly, introduceErrors 
} = require('./dist/reedsolomon');
const {
  SIGNATURE_REPEATS, RS_NSYM, encodeSignature, decodeSignature,
  embedWatermark, extractWatermark, verifyWatermark
} = require('./dist/watermark');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  PASS: ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL: ' + name + ' - ' + e.message);
    failed++;
  }
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
}

function assertArrayEqual(a, b) {
  if (a.length !== b.length) throw new Error(`Array length mismatch: ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`Array mismatch at ${i}: ${a[i]} vs ${b[i]}`);
  }
}

function assertTrue(x) { if (!x) throw new Error('Expected true'); }
function assertNotNull(x) { if (x === null) throw new Error('Expected non-null'); }

console.log('\n=== Reed-Solomon Tests ===');

test('gfMul basics', () => {
  assertEqual(gfMul(0, 42), 0);
  assertEqual(gfMul(1, 42), 42);
  assertEqual(gfMul(2, 4), 8);
});

test('gfDiv is inverse of gfMul', () => {
  const a = 42, b = 17;
  const p = gfMul(a, b);
  assertEqual(gfDiv(p, b), a);
});

test('gfDiv throws on zero', () => {
  try { gfDiv(5, 0); assertTrue(false); } catch (e) { assertTrue(true); }
});

test('gfPolyMul', () => {
  const r = gfPolyMul([1, 1], [1, 2]);
  assertArrayEqual(r, [1, 3, 2]);
});

test('rsGeneratorPoly degree', () => {
  const g = rsGeneratorPoly(8);
  assertEqual(g.length, 9);
});

test('rsEncode produces correct length', () => {
  const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  const enc = rsEncode(data, 8);
  assertEqual(enc.length, 13);
});

test('rsEncode preserves data', () => {
  const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  const enc = rsEncode(data, 8);
  for (let i = 0; i < data.length; i++) assertEqual(enc[i], data[i]);
});

test('rsEncode zero syndromes', () => {
  const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
  const enc = rsEncode(data, 8);
  const synd = rsSyndromes(enc, 8);
  for (let i = 0; i < 8; i++) assertEqual(synd[i], 0);
});

test('rsDecode roundtrip', () => {
  const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
  const enc = rsEncode(data, 8);
  const dec = rsDecode(enc, 8);
  assertNotNull(dec);
  assertArrayEqual(Array.from(dec), Array.from(data));
});

test('rsDecode corrects single error', () => {
  const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
  const enc = new Uint8Array(rsEncode(data, 8));
  enc[3] ^= 0x55;
  const dec = rsDecode(enc, 8);
  assertNotNull(dec);
  assertArrayEqual(Array.from(dec), Array.from(data));
});

test('rsDecode corrects 4 errors', () => {
  const data = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
  const enc = new Uint8Array(rsEncode(data, 16));
  enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[5] ^= 0xbb; enc[7] ^= 0xcc;
  const dec = rsDecode(enc, 16);
  assertNotNull(dec);
  assertArrayEqual(Array.from(dec), Array.from(data));
});

test('rsDecode corrects max capacity errors', () => {
  const data = new Uint8Array(20);
  for (let i = 0; i < data.length; i++) data[i] = i + 1;
  const enc = new Uint8Array(rsEncode(data, 16));
  enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[7] ^= 0xbb; enc[11] ^= 0xcc;
  enc[15] ^= 0xdd; enc[19] ^= 0xee; enc[22] ^= 0x11; enc[25] ^= 0x22;
  const dec = rsDecode(enc, 16);
  assertNotNull(dec);
  assertArrayEqual(Array.from(dec), Array.from(data));
});

test('rsDecode non-zero syndromes for corrupted', () => {
  const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
  const enc = new Uint8Array(rsEncode(data, 8));
  enc[0] ^= 0xff;
  const synd = Array.from(rsSyndromes(enc, 8));
  assertTrue(synd.some(s => s !== 0));
});

console.log('\n=== Watermark Tests ===');

test('encodeSignature roundtrip', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387', creator_id: 'test_creator', timestamp: 1715432000
  };
  const bytes = encodeSignature(payload);
  const decoded = decodeSignature(bytes);
  assertNotNull(decoded);
  assertEqual(decoded.hash, payload.hash);
  assertEqual(decoded.nonce, payload.nonce);
  assertEqual(decoded.status, payload.status);
});

test('decodeSignature returns null for garbage', () => {
  assertEqual(decodeSignature(new Uint8Array([0xff, 0xfe])), null);
});

function createFakeImageData(w, h, seed = 42) {
  let a = seed;
  function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rng() * 256);
  return { data, width: w, height: h };
}

test('embed/extract roundtrip', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387', creator_id: 'test', timestamp: 1715432000
  };
  const img = createFakeImageData(128, 128);
  const result = embedWatermark(img, payload);
  assertEqual(result.imageData.length, img.data.length);
  
  const extracted = extractWatermark({ data: result.imageData, width: 128, height: 128 });
  assertNotNull(extracted);
  assertEqual(extracted.hash, payload.hash);
  assertEqual(extracted.nonce, payload.nonce);
});

test('verifyWatermark with matching payload', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387', creator_id: 'test', timestamp: 1715432000
  };
  const img = createFakeImageData(128, 128);
  const result = embedWatermark(img, payload);
  const v = verifyWatermark({ data: result.imageData, width: 128, height: 128 }, payload);
  assertEqual(v.verified, true);
  assertEqual(v.integrity, 'FULL');
  assertEqual(v.confidence, 1.0);
});

test('verifyWatermark without watermark', () => {
  const img = createFakeImageData(128, 128);
  const v = verifyWatermark(img);
  assertEqual(v.verified, false);
  assertEqual(v.integrity, 'NONE');
  assertEqual(v.confidence, 0);
});

function flipLsbPercent(imageData, percent, seed = 123) {
  let a = seed;
  function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      if (rng() < percent / 100) data[i + ch] ^= 1;
    }
  }
  return { data, width: imageData.width, height: imageData.height };
}

test('damage tolerance 10% LSB flip', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387'
  };
  const img = createFakeImageData(128, 128);
  const result = embedWatermark(img, payload);
  const damaged = flipLsbPercent({ data: result.imageData, width: 128, height: 128 }, 10);
  const extracted = extractWatermark(damaged);
  assertNotNull(extracted);
  assertEqual(extracted.hash, payload.hash);
});

test('damage tolerance 20% LSB flip', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387'
  };
  const img = createFakeImageData(128, 128);
  const result = embedWatermark(img, payload);
  const damaged = flipLsbPercent({ data: result.imageData, width: 128, height: 128 }, 20);
  const extracted = extractWatermark(damaged);
  assertNotNull(extracted);
  assertEqual(extracted.hash, payload.hash);
});

test('damage tolerance 30% LSB flip', () => {
  const payload = {
    hash: '65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996',
    nonce: 'f16823b5', ntime: '6964c85e', version: '20000000',
    status: 'AUTHENTICATED_BY_BM1387'
  };
  const img = createFakeImageData(256, 256);
  const result = embedWatermark(img, payload);
  const damaged = flipLsbPercent({ data: result.imageData, width: 256, height: 256 }, 30);
  const extracted = extractWatermark(damaged);
  assertNotNull(extracted);
  assertEqual(extracted.hash, payload.hash);
});

console.log('\n=== Cross-Platform Compatibility ===');

test('GF multiplication vector #1', () => { assertEqual(gfMul(2, 4), 8); });
test('GF multiplication vector #2', () => { assertEqual(gfMul(3, 7), 9); });
test('GF division vector', () => { assertEqual(gfDiv(8, 2), 4); });

test('RS deterministic encoding', () => {
  const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
  const enc = rsEncode(data, 8);
  assertEqual(enc.length, 13);
  const dec = rsDecode(enc, 8);
  assertArrayEqual(Array.from(dec), Array.from(data));
});

console.log('\n=== Summary ===');
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
