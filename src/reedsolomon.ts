/**
 * Reed-Solomon Error Correction over GF(2^8)
 *
 * Uses primitive polynomial 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
 * with primitive element alpha = 0x02.
 *
 * This module provides full RS encoding and decoding including
 * syndrome calculation, Berlekamp-Massey, Chien search, and
 * the Forney algorithm.
 */

const GF_SIZE = 256; // 2^8
const GF_ORDER = GF_SIZE - 1; // 255

/** GF exponent table: GF_EXP[i] = alpha^i */
const GF_EXP: number[] = new Array(GF_SIZE * 2);
/** GF log table: GF_LOG[alpha^i] = i */
const GF_LOG: number[] = new Array(GF_SIZE);

let tablesInitialized = false;

/** Initialize GF_EXP and GF_LOG tables using primitive polynomial 0x11d */
export function initGfTables(): void {
  if (tablesInitialized) return;

  const primPoly = 0x11d; // x^8 + x^4 + x^3 + x^2 + 1

  let x = 1;
  for (let i = 0; i < GF_SIZE - 1; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & GF_SIZE) {
      x ^= primPoly;
    }
  }

  // Wrap-around for safety
  for (let i = 0; i < GF_SIZE - 1; i++) {
    GF_EXP[i + GF_SIZE - 1] = GF_EXP[i];
  }

  tablesInitialized = true;
}

// Ensure tables are ready
initGfTables();

// ---------------------------------------------------------------------------
// GF arithmetic helpers
// ---------------------------------------------------------------------------

/**
 * Multiply two elements in GF(2^8).
 * Returns 0 if either operand is 0, otherwise uses log tables.
 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/**
 * Divide a by b in GF(2^8).
 * @throws if dividing by zero.
 */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero in GF(2^8)");
  if (a === 0) return 0;
  const diff = (GF_LOG[a] - GF_LOG[b] + GF_ORDER) % GF_ORDER;
  return GF_EXP[diff];
}

/**
 * Raise a to the power n in GF(2^8).
 */
export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] * n) % GF_ORDER];
}

/**
 * Inverse (1/a) in GF(2^8).
 */
function gfInverse(a: number): number {
  if (a === 0) throw new Error("Inverse of zero");
  return GF_EXP[GF_ORDER - GF_LOG[a]];
}

/**
 * Multiply a polynomial by a scalar in GF(2^8).
 */
export function gfPolyScale(poly: number[], s: number): number[] {
  return poly.map((c) => gfMul(c, s));
}

/**
 * Add two polynomials in GF(2^8) (addition = XOR).
 * Pads the shorter polynomial with leading zeros.
 */
export function gfPolyAdd(a: number[], b: number[]): number[] {
  const result: number[] = [];
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const av = i < a.length ? a[a.length - 1 - i] : 0;
    const bv = i < b.length ? b[b.length - 1 - i] : 0;
    result.unshift(av ^ bv);
  }
  return result;
}

/**
 * Multiply two polynomials in GF(2^8).
 */
export function gfPolyMul(a: number[], b: number[]): number[] {
  const result: number[] = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return result;
}

/**
 * Evaluate a polynomial at x using Horner's method.
 * poly[0] is the highest-degree coefficient.
 */
export function gfPolyEval(poly: number[], x: number): number {
  let result = poly[0];
  for (let i = 1; i < poly.length; i++) {
    result = gfMul(result, x) ^ poly[i];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reed-Solomon generator polynomial
// ---------------------------------------------------------------------------

/**
 * Build the RS generator polynomial for `nsym` correction symbols.
 * Generator = Product of (x - alpha^i) for i = 1..nsym
 * (using the common convention of roots alpha^1 through alpha^nsym)
 */
export function rsGeneratorPoly(nsym: number): number[] {
  let gen = [1];
  for (let i = 1; i <= nsym; i++) {
    gen = gfPolyMul(gen, [1, gfPow(2, i)]);
  }
  return gen;
}

// ---------------------------------------------------------------------------
// Reed-Solomon encoder
// ---------------------------------------------------------------------------

/**
 * Encode data bytes with Reed-Solomon error correction.
 * Appends `nsym` parity bytes to the data.
 */
export function rsEncode(data: Uint8Array, nsym: number): Uint8Array {
  if (nsym <= 0) throw new Error("nsym must be positive");
  if (data.length + nsym > GF_ORDER)
    throw new Error("Message too long for RS encoding");

  const gen = rsGeneratorPoly(nsym);
  const remainder = new Array(nsym).fill(0);

  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (coef !== 0) {
      for (let j = 0; j < nsym; j++) {
        remainder[j] ^= gfMul(gen[j + 1], coef);
      }
    }
  }

  const result = new Uint8Array(data.length + nsym);
  result.set(data);
  result.set(remainder, data.length);
  return result;
}

// ---------------------------------------------------------------------------
// Syndrome calculation
// ---------------------------------------------------------------------------

/**
 * Compute the nsym syndromes of a received message.
 * Syndrome[i] = msg_evaluated_at(alpha^(i+1)) for i = 0..nsym-1
 * If all syndromes are zero, the message has no (detectable) errors.
 */
export function rsSyndromes(msg: Uint8Array, nsym: number): Uint8Array {
  const synd = new Uint8Array(nsym);
  for (let i = 0; i < nsym; i++) {
    synd[i] = gfPolyEval(Array.from(msg), gfPow(2, i + 1));
  }
  return synd;
}

// ---------------------------------------------------------------------------
// Berlekamp-Massey algorithm for error locator polynomial
// ---------------------------------------------------------------------------

/**
 * Berlekamp-Massey algorithm.
 * Given syndromes S_0, S_1, ..., S_(nsym-1),
 * finds the error locator polynomial.
 * Returns sigma = [sigma_0, sigma_1, ..., sigma_L] where
 * sigma(x) = sigma_0 + sigma_1*x + ... + sigma_L*x^L
 * and sigma_0 = 1.
 */
function berlekampMassey(synd: number[], nsym: number): number[] {
  // sigma(x) = error locator polynomial, sigma[0] = constant term
  let sigma = [1];
  let b = [1]; // auxiliary polynomial
  let L = 0; // number of errors found
  let m = 1; // number of iterations since L updated
  let delta = 0; // discrepancy

  for (let n = 0; n < nsym; n++) {
    // Compute discrepancy: delta = S_n + Sum_{i=1}^L sigma_i * S_{n-i}
    delta = synd[n];
    for (let i = 1; i <= L; i++) {
      delta ^= gfMul(sigma[i], synd[n - i]);
    }

    if (delta === 0) {
      // No discrepancy, just increment m
      m++;
    } else if (2 * L <= n) {
      // Need to update sigma and L
      const sigmaOld = [...sigma];
      const scale = delta;

      // sigma_new(x) = sigma_old(x) - scale * x^m * b(x)
      while (sigma.length < b.length + m) {
        sigma.push(0);
      }
      for (let i = 0; i < b.length; i++) {
        sigma[i + m] ^= gfMul(b[i], scale);
      }

      L = n + 1 - L;
      b = gfPolyScale(sigmaOld, gfDiv(1, scale));
      m = 1;
    } else {
      // 2*L > n: update sigma but not L
      while (sigma.length < b.length + m) {
        sigma.push(0);
      }
      for (let i = 0; i < b.length; i++) {
        sigma[i + m] ^= gfMul(b[i], delta);
      }
      m++;
    }
  }

  return sigma;
}

// ---------------------------------------------------------------------------
// Chien search - find error positions
// ---------------------------------------------------------------------------

/**
 * Chien search: find the roots of the error locator polynomial.
 * Returns an array of error positions (0-based from the end of the message).
 *
 * The error positions correspond to msg[msgLen - 1 - pos] being in error.
 * In other words, pos = 0 means the last byte of the message.
 */
function chienSearch(
  sigma: number[],
  msgLen: number,
  _nsym: number
): number[] {
  const errors: number[] = [];

  // sigma(x) = sigma_0 + sigma_1*x + ... + sigma_L*x^L
  // Test sigma(alpha^(-i)) for i = 0..msgLen-1
  // If sigma(alpha^(-i)) = 0, error is at position i from the end
  // i.e., error is in byte at index msgLen - 1 - i

  for (let i = 0; i < msgLen; i++) {
    // x = alpha^(-i) = alpha^(255 - i)
    const xLog = (GF_ORDER - i) % GF_ORDER;
    let val = sigma[0];
    for (let j = 1; j < sigma.length; j++) {
      if (sigma[j] !== 0) {
        val ^= GF_EXP[(GF_LOG[sigma[j]] + xLog * j) % GF_ORDER];
      }
    }
    if (val === 0) {
      // Error at position i from the end
      errors.push(i);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Gaussian elimination - solve for error values
// ---------------------------------------------------------------------------

/**
 * Solve for error values using Gaussian elimination in GF(2^8).
 *
 * Given error positions and syndromes, solves the linear system:
 *   S_j = Sum_k e_k * alpha^((j+1)*pos_k) for j = 0..nu-1
 *
 * where pos_k are the error positions (from end) and e_k are the error values.
 * Uses only the first `nu` syndrome equations where nu = errors.length.
 */
function solveErrorValues(
  synd: number[],
  errors: number[]
): number[] {
  const nu = errors.length;

  // Build augmented matrix [A | b]
  // A[j][k] = alpha^((j+1)*pos_k)
  // b[j] = S_j
  const aug: number[][] = [];
  for (let j = 0; j < nu; j++) {
    const row: number[] = [];
    for (let k = 0; k < nu; k++) {
      const pos = errors[k];
      row.push(GF_EXP[((j + 1) * pos) % GF_ORDER]);
    }
    row.push(synd[j]);
    aug.push(row);
  }

  // Gaussian elimination
  for (let col = 0; col < nu; col++) {
    // Find pivot
    let pivot = -1;
    for (let row = col; row < nu; row++) {
      if (aug[row][col] !== 0) {
        pivot = row;
        break;
      }
    }

    if (pivot === -1) {
      // Singular matrix - can't solve
      return new Array(nu).fill(0);
    }

    // Swap pivot row
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

    // Normalize pivot row: divide by pivot element
    const pivVal = aug[col][col];
    const pivInv = gfInverse(pivVal);
    for (let j = col; j <= nu; j++) {
      if (aug[col][j] !== 0) {
        aug[col][j] = gfMul(aug[col][j], pivInv);
      }
    }

    // Eliminate column in all other rows
    for (let row = 0; row < nu; row++) {
      if (row !== col && aug[row][col] !== 0) {
        const factor = aug[row][col];
        for (let j = col; j <= nu; j++) {
          if (aug[col][j] !== 0) {
            aug[row][j] ^= gfMul(aug[col][j], factor);
          }
        }
      }
    }
  }

  // Extract solution
  const errorValues: number[] = [];
  for (let i = 0; i < nu; i++) {
    errorValues.push(aug[i][nu]);
  }
  return errorValues;
}

// ---------------------------------------------------------------------------
// Full Reed-Solomon decoder
// ---------------------------------------------------------------------------

/**
 * Decode a Reed-Solomon encoded message, correcting up to `nsym/2` errors.
 *
 * Returns the corrected data (original message without parity bytes) or null
 * if the message is uncorrectable.
 */
export function rsDecode(data: Uint8Array, nsym: number): Uint8Array | null {
  if (data.length < nsym) return null;

  // Syndrome calculation
  const syndArray = rsSyndromes(data, nsym);

  // Check if all syndromes are zero (no errors)
  let allZero = true;
  for (let i = 0; i < nsym; i++) {
    if (syndArray[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) {
    // No errors - return original data without parity
    return data.slice(0, data.length - nsym);
  }

  // Berlekamp-Massey: find error locator polynomial
  const sigma = berlekampMassey(Array.from(syndArray), nsym);

  // Number of errors = degree of sigma (highest non-zero coefficient)
  let errorCount = sigma.length - 1;
  while (errorCount > 0 && sigma[errorCount] === 0) {
    errorCount--;
  }

  if (errorCount === 0 || errorCount > nsym / 2) {
    return null; // Too many errors or no errors found
  }

  // Chien search: find error positions
  const errors = chienSearch(sigma, data.length, nsym);

  if (errors.length !== errorCount) {
    // Couldn't find enough roots - message uncorrectable
    return null;
  }

  // Solve for error values using Gaussian elimination
  const errorValues = solveErrorValues(Array.from(syndArray), errors);

  // Apply corrections
  const corrected = new Uint8Array(data);
  for (let i = 0; i < errors.length; i++) {
    // errors[i] is the position from the END of the message
    const posFromEnd = errors[i];
    const byteIndex = data.length - 1 - posFromEnd;
    if (byteIndex >= 0 && byteIndex < data.length) {
      corrected[byteIndex] ^= errorValues[i];
    }
  }

  // Verify syndromes of corrected message
  const checkSynd = rsSyndromes(corrected, nsym);
  for (let i = 0; i < nsym; i++) {
    if (checkSynd[i] !== 0) {
      return null; // Correction failed
    }
  }

  // Return corrected data without parity bytes
  return corrected.slice(0, data.length - nsym);
}

// ---------------------------------------------------------------------------
// Utility: intentionally corrupt data (for testing)
// ---------------------------------------------------------------------------

/**
 * Introduce random errors into a byte array for testing purposes.
 * Each byte has `errorRate` probability of being XORed with a random value.
 */
export function introduceErrors(
  data: Uint8Array,
  errorRate: number
): Uint8Array {
  const corrupted = new Uint8Array(data);
  for (let i = 0; i < corrupted.length; i++) {
    if (Math.random() < errorRate) {
      corrupted[i] ^= Math.floor(Math.random() * 255) + 1;
    }
  }
  return corrupted;
}
