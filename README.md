# SiliconSignature TypeScript Core Library

Pure TypeScript implementation of the SiliconSignature watermarking system. Provides Reed-Solomon error correction, LSB steganography embedding/extraction, and software-based image signing.

## Features

- **Zero external runtime dependencies** - Pure TypeScript with no npm dependencies in production
- **Reed-Solomon error correction** over GF(2^8) with full Berlekamp-Massey decoder
- **LSB steganography** embedding in all RGB channels
- **Software signing** simulating ASIC proof-of-work with SHA-256
- **Browser and Node.js compatible**
- **Fully typed** with TypeScript interfaces

## Installation

```bash
npm install siliconsignature-ts
```

## Quick Start

### Sign an Image

```typescript
import { softwareSign, verifyWatermark, extractWatermark } from "siliconsignature-ts";

// In a browser, get ImageData from a canvas
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d")!;
const image = document.getElementById("source") as HTMLImageElement;
ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

// Sign the image (async - searches for proof-of-work nonce)
const result = await softwareSign(imageData, "my-creator-id");

// Apply the watermarked pixels back to the canvas
ctx.putImageData(
  new ImageData(result.imageData, canvas.width, canvas.height),
  0, 0
);

console.log("Signature:", result.signature);
// {
//   hash: "65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996",
//   nonce: "f16823b5",
//   ntime: "6964c85e",
//   version: "20000000",
//   status: "AUTHENTICATED_BY_BM1387",
//   creator_id: "my-creator-id",
//   timestamp: 1715432000
// }
```

### Verify a Watermarked Image

```typescript
// Verify without expected payload (extract-only)
const verifyResult = verifyWatermark(imageData);
console.log(verifyResult.verified);   // true
console.log(verifyResult.integrity);  // "FULL"
console.log(verifyResult.confidence); // 1.0

// Verify against an expected payload
const verifyResult2 = verifyWatermark(imageData, expectedPayload);
console.log(verifyResult2.verified); // true if fields match
```

### Manual Embed/Extract

```typescript
import { embedWatermark, extractWatermark, encodeSignature, decodeSignature } from "siliconsignature-ts";

// Build a payload manually
const payload = {
  hash: "65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996",
  nonce: "f16823b5",
  ntime: "6964c85e",
  version: "20000000",
  status: "AUTHENTICATED_BY_BM1387",
  creator_id: "manual-test",
  timestamp: 1715432000,
};

// Embed into image
const result = embedWatermark(imageData, payload);

// Extract from image (returns null if no watermark found)
const extracted = extractWatermark({
  data: result.imageData,
  width: imageData.width,
  height: imageData.height,
});
console.log(extracted); // { hash: "...", nonce: "...", ... }
```

### Reed-Solomon API

```typescript
import { rsEncode, rsDecode, rsSyndromes, gfMul, gfDiv, gfPolyMul, gfPolyEval } from "siliconsignature-ts";

// Encode data with 16 error correction symbols
const data = new TextEncoder().encode("Hello, World!");
const encoded = rsEncode(data, 16);
console.log(encoded.length); // data.length + 16

// Decode (corrects up to 8 errors)
const decoded = rsDecode(encoded, 16);
console.log(decoded); // original data

// Introduce errors and correct
const corrupted = new Uint8Array(encoded);
corrupted[0] ^= 0xff;
corrupted[3] ^= 0xaa;
const corrected = rsDecode(corrupted, 16);
console.log(corrected); // still original data!

// GF arithmetic
console.log(gfMul(2, 4));  // 8
console.log(gfDiv(8, 2));  // 4
console.log(gfPolyEval([1, 3, 2], 1)); // 0 (x^2 + 3x + 2 evaluated at x=1)
```

## API Reference

### Interfaces

#### `SignaturePayload`

```typescript
interface SignaturePayload {
  hash: string;        // 64-char hex SHA-256 of the image
  nonce: string;       // 8-char hex proof-of-work nonce
  ntime: string;       // 8-char hex unix timestamp
  version: string;     // 8-char hex version
  status: string;      // Authentication status
  creator_id?: string; // Optional creator identifier
  timestamp?: number;  // Unix timestamp (seconds)
}
```

#### `SignResult`

```typescript
interface SignResult {
  imageData: Uint8ClampedArray; // Modified image pixels (RGBA)
  signature: SignaturePayload;   // The embedded signature
}
```

#### `VerifyResult`

```typescript
interface VerifyResult {
  verified: boolean;                    // Watermark verified
  signature: SignaturePayload | null;   // Extracted signature
  integrity: "FULL" | "PARTIAL" | "NONE"; // Integrity level
  confidence: number;                   // 0.0 to 1.0
}
```

### Functions

| Function | Description |
|----------|-------------|
| `softwareSign(imageData, creatorId?)` | Full signing pipeline: hash, PoW nonce search, embed |
| `embedWatermark(imageData, payload)` | Embed a payload into image LSBs |
| `extractWatermark(imageData)` | Extract payload from image LSBs |
| `verifyWatermark(imageData, payload?)` | Verify watermark integrity |
| `hashImage(imageData)` | SHA-256 hash of pixel bytes |
| `searchNonce(hash, difficulty?)` | Find proof-of-work nonce |
| `verifyNonce(hash, nonce, difficulty?)` | Verify a nonce |
| `rsEncode(data, nsym)` | Reed-Solomon encode |
| `rsDecode(data, nsym)` | Reed-Solomon decode (Berlekamp-Massey) |
| `rsSyndromes(msg, nsym)` | Compute RS syndromes |
| `encodeSignature(payload)` | Payload to UTF-8 bytes |
| `decodeSignature(bytes)` | UTF-8 bytes to payload |

## Format Specification (SSv1)

The watermark binary format:

```
JSON payload -> UTF-8 bytes -> Reed-Solomon(nsym=32) -> 4-byte BE length header -> 5x repeat -> LSB embed in all RGB channels
```

- **Field**: GF(2^8) with primitive polynomial 0x11d
- **Error correction**: 32 symbols (corrects up to 16 byte errors per repetition)
- **Repetition**: 5 copies for redundancy
- **Channels**: R, G, B (alpha is untouched)
- **Bit position**: LSB (bit 0)

## Reed-Solomon Implementation

This library includes a **complete Reed-Solomon decoder** implementing:

1. **Syndrome calculation** - Detect errors by evaluating at roots
2. **Berlekamp-Massey algorithm** - Find the error locator polynomial
3. **Chien search** - Find error positions
4. **Forney algorithm** - Compute error values

The decoder can correct up to `nsym/2` byte errors in the message.

## Testing

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Type-check (no emit)
npm run lint

# Build
npm run build
```

## Platform Compatibility

| Platform | Status | Notes |
|----------|--------|-------|
| Browser (Canvas API) | Supported | Use `getImageData()` / `putImageData()` |
| Node.js | Supported | Provide `{ data: Uint8ClampedArray, width, height }` |
| Web Workers | Supported | No DOM dependencies |

## License

MIT
