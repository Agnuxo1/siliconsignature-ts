const { rsEncode, rsDecode, rsSyndromes, gfPolyEval, gfMul, gfDiv, gfPow } = require('./dist/reedsolomon');

// Single error test
const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21]);
const nsym = 8;
const enc = rsEncode(data, nsym);

// Introduce 1 error
const corrupted = new Uint8Array(enc);
corrupted[3] ^= 0x55;

console.log("Original data:", Array.from(data));
console.log("Encoded (first 20):", Array.from(enc.slice(0, 20)));
console.log("Corrupted[3]:", corrupted[3], "original:", enc[3]);

const synd = rsSyndromes(corrupted, nsym);
console.log("Syndromes:", Array.from(synd));

// Test decode
try {
  const decoded = rsDecode(corrupted, nsym);
  console.log("Decoded:", decoded ? Array.from(decoded) : null);
} catch (e) {
  console.log("Decode error:", e.message);
}
