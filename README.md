# SiliconSignature — TypeScript / npm Package

Hardware-bound image authentication for browser and Node.js. Pure TypeScript implementation with zero dependencies.

## 📦 Installation

```bash
npm install siliconsignature
# or
yarn add siliconsignature
# or
pnpm add siliconsignature
```

## 🚀 Quick Start

### Sign an Image (Browser)
```typescript
import { signImage, verifyImage } from 'siliconsignature';

// Load image as ArrayBuffer
const response = await fetch('photo.png');
const imageData = await response.arrayBuffer();

// Sign
const signed = await signImage(imageData, {
  creatorId: 'Agnuxo1',
  metadata: { project: 'P2PCLAW' }
});

// signed.image — signed image as ArrayBuffer
// signed.nonce — ASIC nonce
// signed.hash — SHA-256
// signed.timestamp — Unix timestamp
```

### Verify an Image
```typescript
const result = await verifyImage(signedImageData);

if (result.valid) {
  console.log('✅ Signed by:', result.creator);
  console.log('📅 Timestamp:', new Date(result.timestamp * 1000));
} else {
  console.log('❌ Image has been tampered with');
}
```

### Node.js
```typescript
import { readFileSync } from 'fs';
import { signImage } from 'siliconsignature';

const image = readFileSync('input.png');
const signed = await signImage(image, { creatorId: 'node_user' });

// Save signed image
writeFileSync('signed.png', Buffer.from(signed.image));
```

## ⚙️ API Reference

### `signImage(imageData, options?)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `imageData` | `ArrayBuffer \| Buffer` | required | Raw image bytes (PNG/JPG) |
| `options.creatorId` | `string` | `'anonymous'` | Creator identifier |
| `options.metadata` | `object` | `{}` | Arbitrary metadata to embed |
| `options.redundancy` | `number` | `5` | Reed-Solomon redundancy copies |

**Returns:** `Promise<SignedImageResult>`

### `verifyImage(imageData)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `imageData` | `ArrayBuffer \| Buffer` | Raw image bytes |

**Returns:** `Promise<VerifyResult>`

```typescript
interface VerifyResult {
  valid: boolean;
  creator?: string;
  timestamp?: number;
  nonce?: number;
  metadata?: object;
  confidence?: number; // 0.0 — 1.0
}
```

## 🏗️ How It Works

1. **Parse Image**: Decode PNG/JPG to RGBA pixel array
2. **Hash**: SHA-256 of raw pixel bytes
3. **PoW**: Find nonce such that `SHA256(hash + nonce)` meets difficulty target
4. **RS Encode**: Reed-Solomon over GF(2⁸) with 32 parity symbols
5. **Embed**: Write signature + RS parity to LSB of blue channel (offset 0x20)
6. **Redundancy**: 5 copies across image for voting-based recovery

## 📁 Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main library — sign + verify |
| `package.json` | npm manifest |
| `tsconfig.json` | TypeScript config |

## 🔗 Links

- 🌐 Web App: https://agnuxo1.github.io/siliconsignature-web/
- 🔏 Main Repo: https://github.com/Agnuxo1/Secure_image_generation_with_ASIC_signature
- 🏠 Project Hub: https://p2pclaw.com

## 📝 License

MIT — Francisco Angulo de Lafuente (@Agnuxo1)

**Part of the P2PCLAW Ecosystem**
