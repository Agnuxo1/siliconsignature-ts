const { gfMul, gfDiv } = require('./dist/reedsolomon');
const GF_ORDER = 255;
const GF_EXP = new Array(512), GF_LOG = new Array(256);
let x = 1;
for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 0; i < 255; i++) GF_EXP[i + 255] = GF_EXP[i];

const testCases = [
  { pos: 15, omega: 164, deriv: 189, expected: 0xcc },
  { pos: 17, omega: 231, deriv: 235, expected: 0xbb },
  { pos: 19, omega: 12,  deriv: 112, expected: 0xaa },
  { pos: 22, omega: 77,  deriv: 200, expected: 0xff },
];

for (const tc of testCases) {
  const xInvLog = (GF_ORDER - tc.pos) % GF_ORDER;
  const xLog = tc.pos % GF_ORDER;
  
  // Formula 1: omega / deriv
  const e1 = gfDiv(tc.omega, tc.deriv);
  // Formula 2: x * omega / deriv
  const e2 = gfMul(GF_EXP[xLog], gfDiv(tc.omega, tc.deriv));
  // Formula 3: xInv * omega / deriv
  const e3 = gfMul(GF_EXP[xInvLog], gfDiv(tc.omega, tc.deriv));
  // Formula 4: x^2 * omega / deriv
  const e4 = gfMul(GF_EXP[(xLog * 2) % GF_ORDER], gfDiv(tc.omega, tc.deriv));
  // Formula 5: xInv^2 * omega / deriv
  const e5 = gfMul(GF_EXP[(xInvLog * 2) % GF_ORDER], gfDiv(tc.omega, tc.deriv));
  
  console.log(`pos=${tc.pos}: e1=${e1}, e2=${e2}, e3=${e3}, e4=${e4}, e5=${e5}, expected=${tc.expected}`);
}
