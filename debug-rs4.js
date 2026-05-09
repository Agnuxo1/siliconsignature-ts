const rs = require('./dist/reedsolomon');
const { rsEncode, rsSyndromes, gfMul, gfDiv, gfPolyScale, gfPolyMul } = rs;

// Rebuild GF tables
const GF_SIZE = 256, GF_ORDER = 255;
const GF_EXP = new Array(GF_SIZE * 2), GF_LOG = new Array(GF_SIZE);
let x = 1;
for (let i = 0; i < GF_SIZE - 1; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & GF_SIZE) x ^= 0x11d; }
for (let i = 0; i < GF_SIZE - 1; i++) GF_EXP[i + GF_SIZE - 1] = GF_EXP[i];

const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
const nsym = 8, enc = rsEncode(data, nsym);
const corrupted = new Uint8Array(enc);
corrupted[3] ^= 0x55; // error at index 3, error value = 0x55

const synd = Array.from(rsSyndromes(corrupted, nsym));

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

const errors = [16]; // from Chien search

// Forney
function gfPolyFormalDerivative(s) {
  const d = [];
  for (let i = 1; i < s.length; i += 2) d.push(s[i]);
  while (d.length < s.length - 1) d.push(0);
  return d;
}

const omegaFull = gfPolyMul(synd, sigma);
const omega = omegaFull.slice(0, nsym);
const sigmaDeriv = gfPolyFormalDerivative(sigma);

console.log("omega:", Array.from(omega));
console.log("sigmaDeriv:", Array.from(sigmaDeriv));

const pos = errors[0];
const xInvLog = (GF_ORDER - pos) % GF_ORDER;

// Evaluate omega at X_j
let omegaVal = 0;
for (let j = 0; j < omega.length; j++) {
  if (omega[j] !== 0) omegaVal ^= GF_EXP[(GF_LOG[omega[j]] + xInvLog * j) % GF_ORDER];
}

// Evaluate sigma' at X_j
let derivVal = 0;
for (let j = 0; j < sigmaDeriv.length; j++) {
  if (sigmaDeriv[j] !== 0) derivVal ^= GF_EXP[(GF_LOG[sigmaDeriv[j]] + xInvLog * j) % GF_ORDER];
}

console.log("omegaVal:", omegaVal, "derivVal:", derivVal);

const xInv = GF_EXP[xInvLog];
const errVal = gfMul(xInv, gfDiv(omegaVal, derivVal));
console.log("xInv:", xInv, "error value:", errVal, "expected:", 0x55);

// Apply correction
const byteIndex = corrupted.length - 1 - pos;
console.log("byteIndex:", byteIndex, "corrupted[3]:", corrupted[byteIndex]);
const corrected = new Uint8Array(corrupted);
corrected[byteIndex] ^= errVal;
console.log("corrected[3]:", corrected[byteIndex], "expected:", enc[byteIndex]);

// Verify syndromes
const checkSynd = Array.from(rsSyndromes(corrected, nsym));
console.log("Verified syndromes:", checkSynd.every(s => s === 0));
