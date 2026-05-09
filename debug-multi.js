const rs = require('./dist/reedsolomon');
const { rsEncode, rsDecode, rsSyndromes } = rs;

// 4-error test
const data = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
const nsym = 16;
const enc = new Uint8Array(rsEncode(data, nsym));
enc[0] ^= 0xff; enc[3] ^= 0xaa; enc[5] ^= 0xbb; enc[7] ^= 0xcc;

console.log("Corrupted bytes at indices 0,3,5,7");

const synd = Array.from(rsSyndromes(enc, nsym));
console.log("Syndromes all zero?", synd.every(s => s === 0));

const result = rsDecode(enc, nsym);
console.log("Decode result:", result ? "success" : "null");
if (result) console.log("Decoded:", Array.from(result));

// Expected error positions from end
const msgLen = enc.length;
console.log("Expected error positions from end:", 
  [msgLen-1-0, msgLen-1-3, msgLen-1-5, msgLen-1-7]);
