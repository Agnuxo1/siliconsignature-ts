const { rsEncode, rsSyndromes, gfMul, gfDiv, gfPolyScale, gfPolyMul } = require('./dist/reedsolomon');

const GF_ORDER = 255;
const GF_EXP = new Array(512), GF_LOG = new Array(256);
let x = 1;
for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 0; i < 255; i++) GF_EXP[i + 255] = GF_EXP[i];

function gfFormalDeriv(s) {
  const d = [];
  for (let i = 1; i < s.length; i += 2) d.push(s[i]);
  while (d.length < s.length - 1) d.push(0);
  return d;
}

const data = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
const nsym = 16;
const enc = new Uint8Array(rsEncode(data, nsym));
const orig = Array.from(enc);
enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[5] ^= 0xbb; enc[7] ^= 0xcc;
const errorValues = [0xff, 0xaa, 0xbb, 0xcc]; // at indices 0,3,5,7
const errorPosFromEnd = [22, 19, 17, 15];

const synd = Array.from(rsSyndromes(enc, nsym));

// BM
let sigma = [1], b = [1], L = 0, m = 1;
for (let n = 0; n < nsym; n++) {
  let delta = synd[n];
  for (let i = 1; i <= L; i++) delta ^= gfMul(sigma[i], synd[n - i]);
  if (delta === 0) { m++; }
  else if (2 * L <= n) {
    const sOld = [...sigma];
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    L = n + 1 - L; b = gfPolyScale(sOld, gfDiv(1, delta)); m = 1;
  } else {
    while (sigma.length < b.length + m) sigma.push(0);
    for (let i = 0; i < b.length; i++) sigma[i + m] ^= gfMul(b[i], delta);
    m++;
  }
}

const errors = [15, 17, 19, 22];

// Forney
const omegaFull = gfPolyMul(synd, sigma);
const omega = omegaFull.slice(0, nsym);
const sigmaDeriv = gfFormalDeriv(sigma);

console.log("sigma:", sigma);
console.log("omega:", Array.from(omega));
console.log("sigmaDeriv:", Array.from(sigmaDeriv));

for (let idx = 0; idx < errors.length; idx++) {
  const pos = errors[idx];
  const xInvLog = (GF_ORDER - pos) % GF_ORDER;

  let omegaVal = 0;
  for (let j = 0; j < omega.length; j++) {
    if (omega[j] !== 0) omegaVal ^= GF_EXP[(GF_LOG[omega[j]] + xInvLog * j) % GF_ORDER];
  }

  let derivVal = 0;
  for (let j = 0; j < sigmaDeriv.length; j++) {
    if (sigmaDeriv[j] !== 0) derivVal ^= GF_EXP[(GF_LOG[sigmaDeriv[j]] + xInvLog * j) % GF_ORDER];
  }

  const errVal = gfDiv(omegaVal, derivVal);
  const expectedIdx = errorPosFromEnd.indexOf(pos);
  console.log(`pos=${pos}: omega=${omegaVal}, deriv=${derivVal}, err=${errVal}, expected=${errorValues[expectedIdx]}`);
}

// Apply corrections and check
const corrected = new Uint8Array(enc);
for (let i = 0; i < errors.length; i++) {
  const pos = errors[i];
  const byteIndex = enc.length - 1 - pos;
  const xInvLog = (GF_ORDER - pos) % GF_ORDER;
  let omegaVal = 0;
  for (let j = 0; j < omega.length; j++) {
    if (omega[j] !== 0) omegaVal ^= GF_EXP[(GF_LOG[omega[j]] + xInvLog * j) % GF_ORDER];
  }
  let derivVal = 0;
  for (let j = 0; j < sigmaDeriv.length; j++) {
    if (sigmaDeriv[j] !== 0) derivVal ^= GF_EXP[(GF_LOG[sigmaDeriv[j]] + xInvLog * j) % GF_ORDER];
  }
  const errVal = gfDiv(omegaVal, derivVal);
  corrected[byteIndex] ^= errVal;
}

// Verify syndromes
const checkSynd = Array.from(rsSyndromes(corrected, nsym));
console.log("All syndromes zero?", checkSynd.every(s => s === 0));
if (!checkSynd.every(s => s === 0)) {
  console.log("Remaining syndromes:", checkSynd.filter(s => s !== 0));
}

// Check if data matches
const decoded = corrected.slice(0, data.length);
console.log("Data matches?", Array.from(decoded).every((v, i) => v === data[i]));
