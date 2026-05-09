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
enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[5] ^= 0xbb; enc[7] ^= 0xcc;

// Compute syndromes from corrupted message
const synd = Array.from(rsSyndromes(enc, nsym));
console.log("Syndromes:", synd);

// BM to get sigma
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
console.log("sigma:", sigma, "L:", L);

// Compute omega = S * sigma mod x^nsym
const omegaFull = gfPolyMul(synd, sigma);
const omega = omegaFull.slice(0, nsym);
console.log("omega:", Array.from(omega));

// Error positions
const errors = [15, 17, 19, 22];
const expected = [0xcc, 0xbb, 0xaa, 0xff];
const sigmaDeriv = gfFormalDeriv(sigma);
console.log("sigmaDeriv:", Array.from(sigmaDeriv));

for (let idx = 0; idx < errors.length; idx++) {
  const pos = errors[idx];
  const xInvLog = (GF_ORDER - pos) % GF_ORDER;
  const xLog = pos % GF_ORDER;

  let omegaVal = 0;
  for (let j = 0; j < omega.length; j++) {
    if (omega[j] !== 0) omegaVal ^= GF_EXP[(GF_LOG[omega[j]] + xInvLog * j) % GF_ORDER];
  }

  let derivVal = 0;
  for (let j = 0; j < sigmaDeriv.length; j++) {
    if (sigmaDeriv[j] !== 0) derivVal ^= GF_EXP[(GF_LOG[sigmaDeriv[j]] + xInvLog * j) % GF_ORDER];
  }

  console.log(`pos=${pos}: omegaVal=${omegaVal}, deriv=${derivVal}`);

  const e_plain = derivVal !== 0 ? gfDiv(omegaVal, derivVal) : 0;
  const e_x = derivVal !== 0 ? gfMul(GF_EXP[xLog], gfDiv(omegaVal, derivVal)) : 0;
  const e_xinv = derivVal !== 0 ? gfMul(GF_EXP[xInvLog], gfDiv(omegaVal, derivVal)) : 0;

  console.log(`  plain=${e_plain}, x*=${e_x}, xInv*=${e_xinv}, expected=${expected[idx]}`);
}
