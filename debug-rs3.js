const rs = require('./dist/reedsolomon');

// Add GF tables by reinitializing them
const GF_SIZE = 256;
const GF_ORDER = 255;
const GF_EXP = new Array(GF_SIZE * 2);
const GF_LOG = new Array(GF_SIZE);
const primPoly = 0x11d;
let x = 1;
for (let i = 0; i < GF_SIZE - 1; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & GF_SIZE) x ^= primPoly;
}
for (let i = 0; i < GF_SIZE - 1; i++) GF_EXP[i + GF_SIZE - 1] = GF_EXP[i];

const { rsEncode, rsSyndromes, gfMul, gfDiv, gfPolyScale } = rs;

const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
const nsym = 8;
const enc = rsEncode(data, nsym);
const corrupted = new Uint8Array(enc);
corrupted[3] ^= 0x55;

const synd = Array.from(rsSyndromes(corrupted, nsym));
console.log("Syndromes:", synd);

// BM
let sigma = [1], b = [1], L = 0, m = 1;
for (let n = 0; n < nsym; n++) {
  let delta = synd[n];
  for (let i = 1; i <= L; i++) delta ^= gfMul(sigma[i], synd[n - i]);
  if (delta === 0) { m++; }
  else if (2 * L <= n) {
    const sigmaOld = [...sigma];
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    L = n + 1 - L;
    b = gfPolyScale(sigmaOld, gfDiv(1, delta));
    m = 1;
  } else {
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    m++;
  }
}

console.log("sigma:", sigma, "L:", L);

// Chien search
const msgLen = corrupted.length;
const errors = [];
for (let i = 0; i < msgLen; i++) {
  const xLog = (GF_ORDER - i) % GF_ORDER;
  let val = sigma[0];
  for (let j = 1; j < sigma.length; j++) {
    if (sigma[j] !== 0) {
      val ^= GF_EXP[(GF_LOG[sigma[j]] + xLog * j) % GF_ORDER];
    }
  }
  if (val === 0) {
    errors.push(i);
    console.log(`  Root found at i=${i}, xLog=${xLog}, byteIndex=${msgLen - 1 - i}`);
  }
}
console.log("Errors found:", errors);
console.log("Expected error pos from end:", msgLen - 1 - 3);

// Test sigma directly at expected root
const expectedXLog = (GF_ORDER - (msgLen - 1 - 3)) % GF_ORDER;
let val = sigma[0];
for (let j = 1; j < sigma.length; j++) {
  if (sigma[j] !== 0) val ^= GF_EXP[(GF_LOG[sigma[j]] + expectedXLog * j) % GF_ORDER];
}
console.log("sigma at expected root:", val);
