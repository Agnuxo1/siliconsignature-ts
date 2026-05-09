// Rebuild GF tables
const GF_SIZE = 256, GF_ORDER = 255;
const GF_EXP = new Array(GF_SIZE * 2), GF_LOG = new Array(GF_SIZE);
let x = 1;
for (let i = 0; i < GF_SIZE - 1; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & GF_SIZE) x ^= 0x11d; }
for (let i = 0; i < GF_SIZE - 1; i++) GF_EXP[i + GF_SIZE - 1] = GF_EXP[i];

function gfDiv(a, b) { if (b===0) throw new Error("div0"); if (a===0) return 0; return GF_EXP[(GF_LOG[a] - GF_LOG[b] + GF_ORDER) % GF_ORDER]; }
function gfMul(a, b) { if (a===0 || b===0) return 0; return GF_EXP[GF_LOG[a] + GF_LOG[b]]; }

const omegaVal = 63, derivVal = 76, pos = 16;
const xInvLog = (GF_ORDER - pos) % GF_ORDER;
const xLog = pos % GF_ORDER;

// Current formula: xInv * omega / deriv
const e1 = gfMul(GF_EXP[xInvLog], gfDiv(omegaVal, derivVal));
console.log("e1 (xInv * omega/deriv):", e1);

// Try: x * omega / deriv  
const e2 = gfMul(GF_EXP[xLog], gfDiv(omegaVal, derivVal));
console.log("e2 (x * omega/deriv):", e2);

// Try: omega / deriv
const e3 = gfDiv(omegaVal, derivVal);
console.log("e3 (omega/deriv):", e3);

// Try: xInv^2 * omega / deriv
const e4 = gfMul(GF_EXP[(xInvLog * 2) % GF_ORDER], gfDiv(omegaVal, derivVal));
console.log("e4 (xInv^2 * omega/deriv):", e4);

// Try: x^2 * omega / deriv
const e5 = gfMul(GF_EXP[(xLog * 2) % GF_ORDER], gfDiv(omegaVal, derivVal));
console.log("e5 (x^2 * omega/deriv):", e5);

console.log("Expected:", 85);

// Also, verify what 85 * deriv / xInv or x gives
console.log("\nReverse check:");
console.log("85 * deriv:", gfMul(85, derivVal));
console.log("85 * deriv / xInv:", gfDiv(gfMul(85, derivVal), GF_EXP[xInvLog]));
console.log("85 * deriv / x:", gfDiv(gfMul(85, derivVal), GF_EXP[xLog]));
console.log("85 * deriv * xInv:", gfMul(gfMul(85, derivVal), GF_EXP[xInvLog]));
console.log("85 * deriv * x:", gfMul(gfMul(85, derivVal), GF_EXP[xLog]));
