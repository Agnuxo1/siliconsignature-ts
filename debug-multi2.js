const rs = require('./dist/reedsolomon');
const { rsEncode, rsSyndromes, gfMul, gfDiv, gfPolyScale, gfPolyMul } = rs;

// GF tables
const GF_ORDER = 255;
const GF_EXP = new Array(512), GF_LOG = new Array(256);
let x = 1;
for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 0; i < 255; i++) GF_EXP[i + 255] = GF_EXP[i];

function gfPolyFormalDerivative(s) {
  const d = [];
  for (let i = 1; i < s.length; i += 2) d.push(s[i]);
  while (d.length < s.length - 1) d.push(0);
  return d;
}

// 4-error test
const data = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
const nsym = 16;
const enc = new Uint8Array(rsEncode(data, nsym));
enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[5] ^= 0xbb; enc[7] ^= 0xcc;

const synd = Array.from(rsSyndromes(enc, nsym));

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
    L = n + 1 - L; b = gfPolyScale(sigmaOld, gfDiv(1, delta)); m = 1;
  } else {
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    m++;
  }
}

console.log("BM sigma:", sigma);
console.log("BM L:", L);
let trueDegree = sigma.length - 1;
while (trueDegree > 0 && sigma[trueDegree] === 0) trueDegree--;
console.log("True degree:", trueDegree);

// Chien search
const msgLen = enc.length;
const errors = [];
for (let i = 0; i < msgLen; i++) {
  const xLog = (GF_ORDER - i) % GF_ORDER;
  let val = sigma[0];
  for (let j = 1; j < sigma.length; j++) {
    if (sigma[j] !== 0) val ^= GF_EXP[(GF_LOG[sigma[j]] + xLog * j) % GF_ORDER];
  }
  if (val === 0) errors.push(i);
}
console.log("Chien errors found:", errors.length, "=", errors);
console.log("Expected positions from end:", [22, 19, 17, 15]);

// Check each expected position
for (const pos of [22, 19, 17, 15]) {
  const xLog = (GF_ORDER - pos) % GF_ORDER;
  let val = sigma[0];
  for (let j = 1; j < sigma.length; j++) {
    if (sigma[j] !== 0) val ^= GF_EXP[(GF_LOG[sigma[j]] + xLog * j) % GF_ORDER];
  }
  console.log(`  sigma at pos ${pos}: ${val === 0 ? 'ROOT' : val}`);
}

if (errors.length !== trueDegree) {
  console.log("Chien/degree mismatch!");
}
