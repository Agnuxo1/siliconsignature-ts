/**
 * SiliconSignature Core Library
 *
 * A pure TypeScript implementation of the SiliconSignature watermarking system.
 * Provides Reed-Solomon error correction, LSB steganography, and software
 * signing capabilities.
 *
 * @example
 * ```typescript
 * import { softwareSign, verifyWatermark, extractWatermark } from "siliconsignature-ts";
 *
 * // Sign an image
 * const canvas = document.createElement("canvas");
 * const ctx = canvas.getContext("2d")!;
 * ctx.drawImage(sourceImage, 0, 0);
 * const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
 *
 * const result = await softwareSign(imageData, "my-creator-id");
 * ctx.putImageData(new ImageData(result.imageData, canvas.width, canvas.height), 0, 0);
 *
 * // Verify
 * const verifyResult = verifyWatermark(
 *   ctx.getImageData(0, 0, canvas.width, canvas.height)
 * );
 * console.log(verifyResult.verified); // true
 * ```
 */

// Reed-Solomon module
export {
  initGfTables,
  gfMul,
  gfDiv,
  gfPow,
  gfPolyScale,
  gfPolyAdd,
  gfPolyMul,
  gfPolyEval,
  rsGeneratorPoly,
  rsEncode,
  rsDecode,
  rsSyndromes,
  introduceErrors,
} from "./reedsolomon";

// Watermark / steganography module
export {
  SIGNATURE_REPEATS,
  RS_NSYM,
  encodeSignature,
  decodeSignature,
  embedWatermark,
  extractWatermark,
  verifyWatermark,
} from "./watermark";
export type {
  SignaturePayload,
  SignResult,
  VerifyResult,
  ImageDataLike,
} from "./watermark";

// Crypto / signing module
export {
  DEFAULT_DIFFICULTY,
  hashImage,
  searchNonce,
  verifyNonce,
  softwareSign,
} from "./crypto";
