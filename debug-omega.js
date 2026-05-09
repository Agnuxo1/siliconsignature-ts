const { gfMul, gfDiv, gfPolyScale, gfPolyMul } = require('./dist/reedsolomon');
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

const synd = [97, 77, 7, 241, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const sigma = [1, 14, 93, 110, 202];
const errors = [15, 17, 19, 22];
const expected = [0xcc, 0xbb, 0xaa, 0xff];
const nsym = 16;

// Method 1: omega = S * sigma mod x^nsym
const omega1 = gfPolyMul(synd, sigma).slice(0, nsym);
console.log("omega1 (S*sigma):", Array.from(omega1));

// Method 2: omega = (1 + S) * sigma mod x^nsym, but S starts with x
// S_shifted = [0, S_0, S_1, S_2, ...]
const S_shifted = [0, ...synd];
const omega2 = gfPolyMul(S_shifted, sigma).slice(0, nsym);
console.log("omega2 (x*S*sigma):", Array.from(omega2));

// Method 3: Use syndromes as coefficients of S(x) = S_0 + S_1*x + ...
// but with the "1 + S(x)" convention from some textbooks
// Actually: omega = sigma(x) * sum_{j=0}^{nsym-1} S_j * x^j mod x^nsym
// This is what omega1 is

// Try Forney with each omega and each formula
for (let mi = 1; mi <= 2; mi++) {
  const omega = mi === 1 ? omega1 : omega2;
  const sigmaDeriv = gfFormalDeriv(sigma);
  
  console.log(`\n--- Method ${mi} ---`);
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

    const e_plain = gfDiv(omegaVal, derivVal);
    const e_x = gfMul(GF_EXP[xLog], gfDiv(omegaVal, derivVal));
    const e_xinv = gfMul(GF_EXP[xInvLog], gfDiv(omegaVal, derivVal));
    
    console.log(`pos=${pos}: plain=${e_plain}, x*=${e_x}, xInv*=${e_xinv}, expected=${expected[idx]}`);
  }
}
