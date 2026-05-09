const { gfMul } = require('./dist/reedsolomon');

const synd = [97, 57, 168, 251, 35, 204, 62, 74, 78, 152, 201, 139, 73, 48, 73, 20];
const sigma = [1, 14, 93, 110, 202];

// Verify key equation: sum(sigma[i] * S_{j-i}) = 0 for j >= L
const L = 4;
for (let j = L; j < synd.length; j++) {
  let sum = 0;
  for (let i = 0; i <= L; i++) {
    if (j - i >= 0) sum ^= gfMul(sigma[i], synd[j - i]);
  }
  if (sum !== 0) console.log(`Key eq FAIL at j=${j}: sum=${sum}`);
}
console.log("Key equation check done");

// Now verify error locator roots
const GF_ORDER = 255;
const GF_EXP = new Array(512), GF_LOG = new Array(256);
let x = 1;
for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 0; i < 255; i++) GF_EXP[i + 255] = GF_EXP[i];

const errors = [15, 17, 19, 22];
for (const pos of errors) {
  const xInvLog = (GF_ORDER - pos) % GF_ORDER;
  let val = sigma[0];
  for (let j = 1; j < sigma.length; j++) {
    if (sigma[j] !== 0) val ^= GF_EXP[(GF_LOG[sigma[j]] + xInvLog * j) % GF_ORDER];
  }
  console.log(`sigma(alpha^-${pos}) = ${val}`);
}

// Let's directly solve for error values using the syndrome equations
// S_j = sum_k e_k * alpha^((j+1)*pos_k)
// This gives us nsym equations in nu unknowns

// Build the system matrix A where A[j][k] = alpha^((j+1)*pos_k)
// and vector b where b[j] = S_j
// Solve A * e = b for e

function buildMatrix() {
  const A = [];
  for (let j = 0; j < synd.length; j++) {
    const row = [];
    for (let k = 0; k < errors.length; k++) {
      const pos = errors[k];
      row.push(GF_EXP[((j + 1) * pos) % GF_ORDER]);
    }
    A.push(row);
  }
  return A;
}

const A = buildMatrix();
const b = [...synd];

// Gaussian elimination in GF(2^8)
// We have 16 equations and 4 unknowns, so it's overdetermined
// Use only the first 4 equations
const n = errors.length;
const aug = [];
for (let i = 0; i < n; i++) {
  aug.push([...A[i], b[i]]);
}

console.log("\nGaussian elimination:");
for (let col = 0; col < n; col++) {
  // Find pivot
  let pivot = -1;
  for (let row = col; row < n; row++) {
    if (aug[row][col] !== 0) { pivot = row; break; }
  }
  if (pivot === -1) { console.log("No pivot at col", col); break; }
  
  // Swap
  [aug[col], aug[pivot]] = [aug[pivot], aug[col]];
  
  // Normalize pivot row
  const pivVal = aug[col][col];
  const pivInv = GF_EXP[GF_ORDER - GF_LOG[pivVal]];
  for (let j = col; j <= n; j++) aug[col][j] = aug[col][j] === 0 ? 0 : GF_EXP[(GF_LOG[aug[col][j]] + GF_LOG[pivInv]) % GF_ORDER];
  
  // Eliminate
  for (let row = 0; row < n; row++) {
    if (row !== col && aug[row][col] !== 0) {
      const factor = aug[row][col];
      for (let j = col; j <= n; j++) {
        if (aug[col][j] !== 0) aug[row][j] ^= GF_EXP[(GF_LOG[aug[col][j]] + GF_LOG[factor]) % GF_ORDER];
      }
    }
  }
}

const solution = [];
for (let i = 0; i < n; i++) solution.push(aug[i][n]);
console.log("Error values (Gaussian):", solution);
console.log("Expected:", [0xcc, 0xbb, 0xaa, 0xff]);
