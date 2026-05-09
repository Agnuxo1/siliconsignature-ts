/**
 * Software Signing (ASIC Simulation)
 *
 * Simulates the ASIC proof-of-work signing process using the CPU.
 * Uses the Web Crypto API for SHA-256 hashing.
 */

import {
  embedWatermark,
  type SignaturePayload,
  type SignResult,
  type ImageDataLike,
} from "./watermark";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default difficulty target for proof-of-work */
export const DEFAULT_DIFFICULTY =
  BigInt("0x0000ffff00000000000000000000000000000000000000000000000000000000");

// ---------------------------------------------------------------------------
// Image hashing
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of the raw pixel bytes (RGBA data).
 * Uses the Web Crypto API for browser/Node.js compatibility.
 *
 * @param imageData - Canvas ImageData or compatible object
 * @returns 64-character lowercase hex string
 */
export async function hashImage(imageData: ImageDataLike): Promise<string> {
  const pixels = imageData.data;
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    pixels as unknown as ArrayBuffer
  );
  return bufferToHex(hashBuffer);
}

/**
 * Compute double SHA-256 of data.
 */
async function doubleSha256(data: Uint8Array): Promise<ArrayBuffer> {
  const first = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as ArrayBuffer
  );
  return crypto.subtle.digest("SHA-256", first);
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer to a lowercase hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Convert a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Pack a 32-bit integer into a 4-byte Uint8Array (big-endian).
 */
function packUint32(n: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = (n >>> 24) & 0xff;
  bytes[1] = (n >>> 16) & 0xff;
  bytes[2] = (n >>> 8) & 0xff;
  bytes[3] = n & 0xff;
  return bytes;
}

// ---------------------------------------------------------------------------
// Nonce search (proof-of-work)
// ---------------------------------------------------------------------------

/**
 * Search for a nonce such that double SHA-256(hash || nonce) < target.
 *
 * @param hash       - 64-char hex string, the image hash
 * @param difficulty - Optional BigInt target (default: DEFAULT_DIFFICULTY)
 * @returns Object with nonce (hex string) and ntime (hex string)
 */
export async function searchNonce(
  hash: string,
  difficulty?: bigint
): Promise<{ nonce: string; ntime: string }> {
  const target = difficulty ?? DEFAULT_DIFFICULTY;
  const hashBytes = hexToBytes(hash);

  // Start from a random-ish value
  let nonceVal = Math.floor(Math.random() * 0x7fffffff);
  const startTime = Math.floor(Date.now() / 1000);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const nonceBytes = packUint32(nonceVal >>> 0);
    const data = new Uint8Array(hashBytes.length + nonceBytes.length);
    data.set(hashBytes);
    data.set(nonceBytes, hashBytes.length);

    const result = await doubleSha256(data);
    const resultBigInt = arrayBufferToBigInt(result);

    if (resultBigInt < target) {
      const nonceHex = (nonceVal >>> 0).toString(16).padStart(8, "0");
      const ntimeHex = startTime.toString(16).padStart(8, "0");
      return { nonce: nonceHex, ntime: ntimeHex };
    }

    nonceVal = ((nonceVal + 1) >>> 0);

    // Safety: wrap around after exhausting nonce space
    if (nonceVal === 0) {
      // Refresh timestamp and continue
      break;
    }
  }

  // Retry with new timestamp
  return searchNonce(hash, difficulty);
}

/**
 * Verify that a nonce satisfies the proof-of-work condition.
 *
 * @param hash       - 64-char hex image hash
 * @param nonce      - 8-char hex nonce
 * @param difficulty - Optional BigInt target (default: DEFAULT_DIFFICULTY)
 * @returns true if the nonce is valid
 */
export async function verifyNonce(
  hash: string,
  nonce: string,
  difficulty?: bigint
): Promise<boolean> {
  const target = difficulty ?? DEFAULT_DIFFICULTY;
  const hashBytes = hexToBytes(hash);
  const nonceBytes = hexToBytes(nonce);

  const data = new Uint8Array(hashBytes.length + nonceBytes.length);
  data.set(hashBytes);
  data.set(nonceBytes, hashBytes.length);

  const result = await doubleSha256(data);
  const resultBigInt = arrayBufferToBigInt(result);

  return resultBigInt < target;
}

// ---------------------------------------------------------------------------
// ArrayBuffer <-> BigInt
// ---------------------------------------------------------------------------

/**
 * Convert an ArrayBuffer (32 bytes) to a BigInt.
 */
function arrayBufferToBigInt(buffer: ArrayBuffer): bigint {
  const bytes = new Uint8Array(buffer);
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

// ---------------------------------------------------------------------------
// Full software signing pipeline
// ---------------------------------------------------------------------------

/**
 * Perform the full software signing pipeline on an image.
 *
 * 1. Hash the image (SHA-256)
 * 2. Search for a valid nonce (PoW)
 * 3. Construct the signature payload
 * 4. Embed the payload into the image via LSB steganography
 *
 * @param imageData - Canvas ImageData or compatible object
 * @param creatorId - Optional creator identifier string
 * @returns SignResult with modified pixels and signature payload
 */
export async function softwareSign(
  imageData: ImageDataLike,
  creatorId?: string
): Promise<SignResult> {
  // 1. Hash the image
  const hash = await hashImage(imageData);

  // 2. Search for nonce
  const { nonce, ntime } = await searchNonce(hash);

  // 3. Build signature payload
  const payload: SignaturePayload = {
    hash,
    nonce,
    ntime,
    version: "20000000",
    status: "AUTHENTICATED_BY_BM1387",
    ...(creatorId ? { creator_id: creatorId } : {}),
    timestamp: parseInt(ntime, 16),
  };

  // 4. Embed watermark
  return embedWatermark(imageData, payload);
}
