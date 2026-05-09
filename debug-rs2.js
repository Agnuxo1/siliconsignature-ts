const { rsEncode, rsSyndromes, gfMul, gfDiv, gfPow, GF_EXP, GF_LOG, gfPolyMul, gfPolyEval, gfPolyScale } = require('./dist/reedsolomon');

// Manually instrument the decoder steps
const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
const nsym = 8;
const enc = rsEncode(data, nsym);
const corrupted = new Uint8Array(enc);
corrupted[3] ^= 0x55; // error at position 3

const synd = Array.from(rsSyndromes(corrupted, nsym));
console.log("Syndromes:", synd);

// Berlekamp-Massey (from source)
let sigma = [1];
let b = [1];
let L = 0;
let m = 1;

for (let n = 0; n < nsym; n++) {
  let delta = synd[n];
  for (let i = 1; i <= L; i++) {
    delta ^= gfMul(sigma[i], synd[n - i]);
  }

  if (delta === 0) {
    m++;
  } else if (2 * L <= n) {
    const sigmaOld = [...sigma];
    const scale = delta;
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], scale);
    L = n + 1 - L;
    b = gfPolyScale(sigmaOld, gfDiv(1, delta));
    m = 1;
  } else {
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    m++;
  }
}

console.log("BM sigma:", sigma);
console.log("BM L (error count):", L);

// Check true degree
let trueDegree = sigma.length - 1;
while (trueDegree > 0 && sigma[trueDegree] === 0) trueDegree--;
console.log("True degree:", trueDegree);

if (trueDegree > nsym / 2) {
  console.log("Too many errors");
  process.exit(1);
}

// Chien search
const GF_ORDER = 255;
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
  }
}

console.log("Chien search errors (pos from end):", errors);
console.log("Expected position from end:", msgLen - 1 - 3, "(error at index 3)");

if (errors.length !== trueDegree) {
  console.log("ERROR: Chien found", errors.length, "roots but expected", trueDegree);
}
