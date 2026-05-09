/**
 * LSB Steganography Engine for SiliconSignature
 *
 * Embeds signed payload data into the least significant bits of RGB channels
 * using Reed-Solomon error correction for robustness.
 */

import { rsEncode, rsDecode } from "./reedsolomon";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of times the payload is repeated for redundancy */
export const SIGNATURE_REPEATS = 5;

/** Reed-Solomon error correction symbol count */
export const RS_NSYM = 32;

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

/** The signed payload embedded in the image */
export interface SignaturePayload {
  /** 64-character hex SHA-256 of the image */
  hash: string;
  /** 8-character hex nonce */
  nonce: string;
  /** 8-character hex timestamp */
  ntime: string;
  /** 8-character hex version */
  version: string;
  /** Authentication status string */
  status: string;
  /** Optional creator identifier */
  creator_id?: string;
  /** Unix timestamp (seconds) */
  timestamp?: number;
}

/** Result of the sign/embed operation */
export interface SignResult {
  /** Modified image pixels (RGBA) */
  imageData: Uint8ClampedArray;
  /** The embedded signature payload */
  signature: SignaturePayload;
}

/** Result of the verify operation */
export interface VerifyResult {
  /** Whether the watermark was verified */
  verified: boolean;
  /** Extracted signature payload, if any */
  signature: SignaturePayload | null;
  /** Integrity level of the recovered watermark */
  integrity: "FULL" | "PARTIAL" | "NONE";
  /** Confidence score 0.0 to 1.0 */
  confidence: number;
}

/** ImageData-like structure for browser/Node compatibility */
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// JSON <-> Bytes conversion
// ---------------------------------------------------------------------------

/**
 * Encode a SignaturePayload object to UTF-8 bytes.
 */
export function encodeSignature(payload: SignaturePayload): Uint8Array {
  const json = JSON.stringify(payload);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

/**
 * Decode UTF-8 bytes back to a SignaturePayload object.
 * Returns null if the bytes cannot be parsed.
 */
export function decodeSignature(bytes: Uint8Array): SignaturePayload | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const json = decoder.decode(bytes);
    const payload = JSON.parse(json) as SignaturePayload;
    // Basic validation
    if (
      typeof payload.hash === "string" &&
      typeof payload.nonce === "string" &&
      typeof payload.ntime === "string" &&
      typeof payload.version === "string" &&
      typeof payload.status === "string"
    ) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bit-level helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Uint8Array to a bit array (LSB first per byte).
 */
function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    for (let j = 0; j < 8; j++) {
      bits.push((b >> j) & 1);
    }
  }
  return bits;
}

/**
 * Convert a bit array back to a Uint8Array.
 */
function bitsToBytes(bits: number[]): Uint8Array {
  const byteCount = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < bits.length; i++) {
    bytes[Math.floor(i / 8)] |= (bits[i] & 1) << (i % 8);
  }
  return bytes;
}

/**
 * Pack a 32-bit unsigned integer into 4 big-endian bytes.
 */
function packUint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = (value >>> 24) & 0xff;
  bytes[1] = (value >>> 16) & 0xff;
  bytes[2] = (value >>> 8) & 0xff;
  bytes[3] = value & 0xff;
  return bytes;
}

/**
 * Unpack 4 big-endian bytes into a 32-bit unsigned integer.
 */
function unpackUint32BE(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0;
  return (
    ((bytes[0] & 0xff) << 24) |
    ((bytes[1] & 0xff) << 16) |
    ((bytes[2] & 0xff) << 8) |
    (bytes[3] & 0xff)
  ) >>> 0;
}

// ---------------------------------------------------------------------------
// LSB Embedding / Extraction
// ---------------------------------------------------------------------------

/**
 * Embed a payload into the LSB of all RGB channels of an image.
 *
 * Pipeline:
 *   JSON -> UTF-8 bytes -> RS encode -> length header (4 BE) -> 5x repeat -> LSB embed
 *
 * @param imageData - Canvas ImageData or compatible object
 * @param payload   - The signature payload to embed
 * @returns SignResult with modified pixel data and the signature
 */
export function embedWatermark(
  imageData: ImageDataLike,
  payload: SignaturePayload
): SignResult {
  const pixels = imageData.data;

  // Validate: only RGB channels (skip alpha) => 3 bits per pixel
  const rgbChannelCount = Math.floor(pixels.length / 4) * 3;

  // 1. Encode payload to bytes
  const payloadBytes = encodeSignature(payload);

  // 2. Reed-Solomon encode
  const rsEncoded = rsEncode(payloadBytes, RS_NSYM);

  // 3. Prepend 4-byte big-endian length header
  const lengthHeader = packUint32BE(rsEncoded.length);
  const framed = new Uint8Array(lengthHeader.length + rsEncoded.length);
  framed.set(lengthHeader);
  framed.set(rsEncoded, lengthHeader.length);

  // 4. Repeat 5 times
  const repeated = new Uint8Array(framed.length * SIGNATURE_REPEATS);
  for (let i = 0; i < SIGNATURE_REPEATS; i++) {
    repeated.set(framed, i * framed.length);
  }

  // 5. Convert to bits
  const bits = bytesToBits(repeated);

  // 6. Capacity check
  if (bits.length > rgbChannelCount) {
    throw new Error(
      `Image too small: need ${bits.length} RGB channels, have ${rgbChannelCount}`
    );
  }

  // 7. Embed bits into LSB of RGB channels
  const modified = new Uint8ClampedArray(pixels);
  let bitIdx = 0;
  for (let px = 0; px < pixels.length && bitIdx < bits.length; px += 4) {
    // Red channel
    modified[px] = (pixels[px] & 0xfe) | (bits[bitIdx++] & 1);
    // Green channel
    if (bitIdx < bits.length) {
      modified[px + 1] = (pixels[px + 1] & 0xfe) | (bits[bitIdx++] & 1);
    }
    // Blue channel
    if (bitIdx < bits.length) {
      modified[px + 2] = (pixels[px + 2] & 0xfe) | (bits[bitIdx++] & 1);
    }
    // Alpha channel is left untouched
  }

  return {
    imageData: modified,
    signature: payload,
  };
}

/**
 * Extract a payload from the LSB of all RGB channels.
 *
 * Pipeline:
 *   LSB extract -> split by 5 repetitions -> for each: RS decode -> JSON parse -> return first valid
 *
 * @param imageData - Canvas ImageData or compatible object
 * @returns The first successfully decoded SignaturePayload, or null
 */
export function extractWatermark(
  imageData: ImageDataLike
): SignaturePayload | null {
  const pixels = imageData.data;

  // 1. Extract all LSBs from RGB channels
  const bits: number[] = [];
  for (let px = 0; px < pixels.length; px += 4) {
    bits.push(pixels[px] & 1);      // R
    bits.push(pixels[px + 1] & 1);  // G
    bits.push(pixels[px + 2] & 1);  // B
  }

  // 2. Convert bits back to bytes
  const allBytes = bitsToBytes(bits);

  // 3. Try each repetition
  // We need to figure out the frame size. First try reading the length header
  // from each possible repetition offset.
  for (let rep = 0; rep < SIGNATURE_REPEATS; rep++) {
    const offset = rep * 4; // minimum possible offset
    if (offset + 4 > allBytes.length) break;

    // Read candidate length from this offset
    const candidateLen = unpackUint32BE(allBytes.slice(offset, offset + 4));

    // Sanity check: length should be reasonable (at least RS_NSYM + 1, at most a few KB)
    if (
      candidateLen < RS_NSYM + 1 ||
      candidateLen > 4096 ||
      offset + 4 + candidateLen * SIGNATURE_REPEATS > allBytes.length
    ) {
      continue;
    }

    // Try to decode this repetition
    const frameOffset = offset + 4;
    const rsData = allBytes.slice(frameOffset, frameOffset + candidateLen);
    const decoded = rsDecode(rsData, RS_NSYM);

    if (decoded) {
      const payload = decodeSignature(decoded);
      if (payload) {
        return payload;
      }
    }
  }

  // Fallback: brute-force scan for any decodable frame
  return extractWatermarkBruteForce(allBytes);
}

/**
 * Brute-force extraction that tries sliding windows.
 * Used as fallback when the repetition alignment is unknown.
 */
function extractWatermarkBruteForce(allBytes: Uint8Array): SignaturePayload | null {
  // Try different offsets and frame sizes
  for (let offset = 0; offset < Math.min(allBytes.length, 64); offset++) {
    for (
      let frameLen = RS_NSYM + 1;
      frameLen <= Math.min(512, allBytes.length - offset);
      frameLen++
    ) {
      const candidate = allBytes.slice(offset, offset + frameLen);
      const decoded = rsDecode(candidate, RS_NSYM);
      if (decoded) {
        const payload = decodeSignature(decoded);
        if (payload) {
          return payload;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a watermark in an image.
 *
 * If `payload` is provided, verifies that the extracted payload matches.
 * Otherwise, just checks that a valid payload can be extracted.
 *
 * @param imageData - Canvas ImageData or compatible object
 * @param payload   - Optional expected payload to compare against
 * @returns VerifyResult with verification status
 */
export function verifyWatermark(
  imageData: ImageDataLike,
  payload?: SignaturePayload
): VerifyResult {
  const extracted = extractWatermark(imageData);

  if (!extracted) {
    return {
      verified: false,
      signature: null,
      integrity: "NONE",
      confidence: 0.0,
    };
  }

  // If no payload provided, just verify extraction succeeded
  if (!payload) {
    return {
      verified: true,
      signature: extracted,
      integrity: "FULL",
      confidence: 1.0,
    };
  }

  // Compare fields
  const fields: (keyof SignaturePayload)[] = [
    "hash",
    "nonce",
    "ntime",
    "version",
    "status",
    "creator_id",
    "timestamp",
  ];

  let matchingFields = 0;
  let totalFields = 0;

  for (const key of fields) {
    const expected = payload[key];
    const actual = extracted[key];
    if (expected !== undefined) {
      totalFields++;
      if (expected === actual) {
        matchingFields++;
      }
    }
  }

  const confidence = totalFields > 0 ? matchingFields / totalFields : 0;
  const verified = confidence >= 0.8; // 80% field match threshold

  return {
    verified,
    signature: extracted,
    integrity:
      confidence >= 0.95 ? "FULL" : confidence >= 0.5 ? "PARTIAL" : "NONE",
    confidence,
  };
}
