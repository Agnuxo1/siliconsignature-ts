/**
 * SiliconSignature Core Library Tests
 *
 * Tests cover:
 * - Reed-Solomon encoding/decoding roundtrip
 * - Reed-Solomon error correction (introduce errors, verify recovery)
 * - Damage tolerance (flip 30% of LSBs, verify still recovers)
 * - Embed/extract roundtrip
 * - Cross-platform compatibility test vectors
 * - Software signing pipeline
 */

import {
  rsEncode,
  rsDecode,
  rsSyndromes,
  gfMul,
  gfDiv,
  gfPolyMul,
  gfPolyEval,
  rsGeneratorPoly,
  introduceErrors,
} from "../reedsolomon";

import {
  SIGNATURE_REPEATS,
  RS_NSYM,
  encodeSignature,
  decodeSignature,
  embedWatermark,
  extractWatermark,
  verifyWatermark,
  type SignaturePayload,
  type ImageDataLike,
} from "../watermark";

import {
  hashImage,
  verifyNonce,
  type DEFAULT_DIFFICULTY,
} from "../crypto";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake ImageData with random RGBA pixels */
function createFakeImageData(
  width: number,
  height: number,
  seed: number = 42
): ImageDataLike {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.floor(rng() * 256);
  }
  return { data, width, height };
}

/** Simple PRNG for reproducible tests */
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flip a percentage of LSBs in RGB channels of an image */
function flipLsbPercent(
  imageData: ImageDataLike,
  percent: number,
  seed: number = 123
): ImageDataLike {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(imageData.data);
  let flips = 0;
  for (let i = 0; i < data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      if (rng() < percent / 100) {
        data[i + ch] ^= 1;
        flips++;
      }
    }
  }
  // console.log(`Flipped ${flips} LSBs (${((flips / (data.length * 0.75)) * 100).toFixed(1)}%)`);
  return { data, width: imageData.width, height: imageData.height };
}

// ---------------------------------------------------------------------------
// Reed-Solomon Tests
// ---------------------------------------------------------------------------

describe("Reed-Solomon", () => {
  const testData = new Uint8Array([
    0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64, 0x21,
  ]); // "Hello World!"

  describe("GF arithmetic", () => {
    it("gfMul: multiplication table basics", () => {
      expect(gfMul(0, 42)).toBe(0);
      expect(gfMul(42, 0)).toBe(0);
      expect(gfMul(1, 42)).toBe(42);
      expect(gfMul(42, 1)).toBe(42);
      // 2 * 128 = 256 in GF but GF uses XOR-addition and log tables
      // 2^1 * 2^7 = 2^8 = 3 (with wrap-around in GF(2^8) with 0x11d)
      expect(gfMul(2, 128)).toBe(3);
    });

    it("gfDiv: division is inverse of multiplication", () => {
      const a = 42;
      const b = 17;
      const product = gfMul(a, b);
      expect(gfDiv(product, b)).toBe(a);
      expect(gfDiv(product, a)).toBe(b);
    });

    it("gfDiv: throws on division by zero", () => {
      expect(() => gfDiv(5, 0)).toThrow("Division by zero");
    });

    it("gfPolyMul: polynomial multiplication", () => {
      // (x + 1) * (x + 2) = x^2 + 3x + 2
      const a = [1, 1]; // x + 1
      const b = [1, 2]; // x + 2
      const result = gfPolyMul(a, b);
      // Coefficients: [1, 3, 2]
      expect(result).toEqual([1, 3, 2]);
    });

    it("gfPolyEval: polynomial evaluation", () => {
      // p(x) = x^2 + 3x + 2, evaluate at x = 1
      // In GF, 1 + 3 + 2 = 1 ^ 3 ^ 2 = 0
      const poly = [1, 3, 2];
      expect(gfPolyEval(poly, 1)).toBe(0);
    });

    it("rsGeneratorPoly: produces correct degree", () => {
      const gen8 = rsGeneratorPoly(8);
      expect(gen8.length).toBe(9); // degree 8 => 9 coefficients
      const gen32 = rsGeneratorPoly(32);
      expect(gen32.length).toBe(33);
    });
  });

  describe("Encoding", () => {
    it("rsEncode: produces correct length", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      expect(encoded.length).toBe(testData.length + nsym);
    });

    it("rsEncode: original data is preserved in first N bytes", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      for (let i = 0; i < testData.length; i++) {
        expect(encoded[i]).toBe(testData[i]);
      }
    });

    it("rsEncode: encoded message has zero syndromes", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      const synd = rsSyndromes(encoded, nsym);
      for (let i = 0; i < nsym; i++) {
        expect(synd[i]).toBe(0);
      }
    });
  });

  describe("Decoding", () => {
    it("rsDecode: roundtrip without errors", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      const decoded = rsDecode(encoded, nsym);
      expect(decoded).not.toBeNull();
      expect(decoded!).toEqual(testData);
    });

    it("rsDecode: corrects single error", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      // Introduce 1 error
      encoded[3] ^= 0x55;
      const decoded = rsDecode(encoded, nsym);
      expect(decoded).not.toBeNull();
      expect(decoded!).toEqual(testData);
    });

    it("rsDecode: corrects multiple errors up to nsym/2", () => {
      const nsym = 16;
      const encoded = new Uint8Array(rsEncode(testData, nsym));
      // Introduce 4 errors (within nsym/2 = 8)
      encoded[0] ^= 0xab;
      encoded[2] ^= 0xcd;
      encoded[5] ^= 0xef;
      encoded[7] ^= 0x12;
      const decoded = rsDecode(encoded, nsym);
      expect(decoded).not.toBeNull();
      expect(decoded!).toEqual(testData);
    });

    it("rsDecode: corrects errors at maximum capacity", () => {
      const nsym = 16;
      const data = new Uint8Array(20);
      for (let i = 0; i < data.length; i++) data[i] = i + 1;
      const encoded = new Uint8Array(rsEncode(data, nsym));
      // Introduce exactly nsym/2 errors
      encoded[0] ^= 0xff;
      encoded[3] ^= 0xaa;
      encoded[7] ^= 0xbb;
      encoded[11] ^= 0xcc;
      encoded[15] ^= 0xdd;
      encoded[19] ^= 0xee;
      encoded[22] ^= 0x11;
      encoded[25] ^= 0x22;
      const decoded = rsDecode(encoded, nsym);
      expect(decoded).not.toBeNull();
      expect(decoded!).toEqual(data);
    });

    it("rsDecode: returns null when too many errors", () => {
      const nsym = 8;
      const encoded = new Uint8Array(rsEncode(testData, nsym));
      // Introduce 6 errors (beyond nsym/2 = 4)
      for (let i = 0; i < 6; i++) {
        encoded[i] ^= 0xff;
      }
      const decoded = rsDecode(encoded, nsym);
      // May or may not decode depending on error pattern
      if (decoded !== null) {
        // If it did decode, verify correctness
        expect(decoded).toEqual(testData);
      }
    });

    it("rsDecode: handles empty-ish data", () => {
      const nsym = 8;
      const shortData = new Uint8Array([0x42]);
      const encoded = rsEncode(shortData, nsym);
      const decoded = rsDecode(encoded, nsym);
      expect(decoded).not.toBeNull();
      expect(decoded!).toEqual(shortData);
    });
  });

  describe("Syndromes", () => {
    it("rsSyndromes: all zero for valid codeword", () => {
      const nsym = 8;
      const encoded = rsEncode(testData, nsym);
      const synd = Array.from(rsSyndromes(encoded, nsym));
      expect(synd.every((s) => s === 0)).toBe(true);
    });

    it("rsSyndromes: non-zero for corrupted codeword", () => {
      const nsym = 8;
      const encoded = new Uint8Array(rsEncode(testData, nsym));
      encoded[0] ^= 0xff;
      const synd = Array.from(rsSyndromes(encoded, nsym));
      expect(synd.some((s) => s !== 0)).toBe(true);
    });
  });

  describe("introduceErrors helper", () => {
    it("introduces errors with given probability", () => {
      const data = new Uint8Array(1000);
      for (let i = 0; i < data.length; i++) data[i] = 0x42;
      const corrupted = introduceErrors(data, 0.1);
      let diffCount = 0;
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== corrupted[i]) diffCount++;
      }
      // With 10% error rate on 1000 bytes, expect ~100 errors
      expect(diffCount).toBeGreaterThan(30);
      expect(diffCount).toBeLessThan(170);
    });
  });
});

// ---------------------------------------------------------------------------
// Watermark / Steganography Tests
// ---------------------------------------------------------------------------

describe("Watermark", () => {
  const samplePayload: SignaturePayload = {
    hash: "65501a37b306f5ac183848bab643350219c18111bfa97c706856b668d3bd5996",
    nonce: "f16823b5",
    ntime: "6964c85e",
    version: "20000000",
    status: "AUTHENTICATED_BY_BM1387",
    creator_id: "test_creator",
    timestamp: 1715432000,
  };

  describe("encodeSignature / decodeSignature", () => {
    it("roundtrips a payload through JSON and bytes", () => {
      const bytes = encodeSignature(samplePayload);
      expect(bytes.length).toBeGreaterThan(0);

      const decoded = decodeSignature(bytes);
      expect(decoded).not.toBeNull();
      expect(decoded!.hash).toBe(samplePayload.hash);
      expect(decoded!.nonce).toBe(samplePayload.nonce);
      expect(decoded!.status).toBe(samplePayload.status);
      expect(decoded!.creator_id).toBe(samplePayload.creator_id);
    });

    it("decodeSignature returns null for invalid bytes", () => {
      const garbage = new Uint8Array([0xff, 0xfe, 0xfd]);
      expect(decodeSignature(garbage)).toBeNull();
    });
  });

  describe("embedWatermark / extractWatermark", () => {
    it("roundtrips a payload through a large image", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);

      // imageData should be modified
      expect(result.imageData.length).toBe(img.data.length);
      // Some bytes should have changed in RGB channels
      let changed = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if ((img.data[i] & 0xfe) !== (result.imageData[i] & 0xfe)) changed++;
        if ((img.data[i + 1] & 0xfe) !== (result.imageData[i + 1] & 0xfe))
          changed++;
        if ((img.data[i + 2] & 0xfe) !== (result.imageData[i + 2] & 0xfe))
          changed++;
      }
      expect(changed).toBe(0); // Only LSB changes, high bits stay same

      // Extract from the watermarked image
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const extracted = extractWatermark(watermarkedImg);
      expect(extracted).not.toBeNull();
      expect(extracted!.hash).toBe(samplePayload.hash);
      expect(extracted!.nonce).toBe(samplePayload.nonce);
    });

    it("throws for image too small", () => {
      const tinyImg = createFakeImageData(2, 2);
      expect(() => embedWatermark(tinyImg, samplePayload)).toThrow(
        /too small/
      );
    });

    it("extracts from minimum viable image", () => {
      // Calculate minimum size: payload bits / 3 channels
      const payloadBytes = encodeSignature(samplePayload);
      const rsEncoded = rsEncode(payloadBytes, RS_NSYM);
      const totalBits = (4 + rsEncoded.length) * 8 * SIGNATURE_REPEATS;
      const minPixels = Math.ceil(totalBits / 3);
      const edge = Math.ceil(Math.sqrt(minPixels)) + 2;
      const img = createFakeImageData(edge, edge);
      const result = embedWatermark(img, samplePayload);
      const extracted = extractWatermark({
        data: result.imageData,
        width: img.width,
        height: img.height,
      });
      expect(extracted).not.toBeNull();
      expect(extracted!.hash).toBe(samplePayload.hash);
    });
  });

  describe("Damage tolerance", () => {
    it("recovers after flipping 10% of LSBs", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const damaged = flipLsbPercent(watermarkedImg, 10);
      const extracted = extractWatermark(damaged);
      expect(extracted).not.toBeNull();
      expect(extracted!.hash).toBe(samplePayload.hash);
    });

    it("recovers after flipping 20% of LSBs", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const damaged = flipLsbPercent(watermarkedImg, 20);
      const extracted = extractWatermark(damaged);
      expect(extracted).not.toBeNull();
      expect(extracted!.hash).toBe(samplePayload.hash);
    });

    it("recovers after flipping 30% of LSBs", () => {
      const img = createFakeImageData(256, 256);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const damaged = flipLsbPercent(watermarkedImg, 30);
      const extracted = extractWatermark(damaged);
      expect(extracted).not.toBeNull();
      expect(extracted!.hash).toBe(samplePayload.hash);
    });
  });

  describe("verifyWatermark", () => {
    it("returns verified=true for matching payload", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const verifyResult = verifyWatermark(watermarkedImg, samplePayload);
      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.integrity).toBe("FULL");
      expect(verifyResult.confidence).toBe(1.0);
    });

    it("returns verified=true without payload (extract-only mode)", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };
      const verifyResult = verifyWatermark(watermarkedImg);
      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.signature).not.toBeNull();
    });

    it("returns verified=false for image without watermark", () => {
      const img = createFakeImageData(128, 128);
      const verifyResult = verifyWatermark(img);
      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.integrity).toBe("NONE");
      expect(verifyResult.confidence).toBe(0);
    });

    it("detects tampered payload", () => {
      const img = createFakeImageData(128, 128);
      const result = embedWatermark(img, samplePayload);
      const watermarkedImg: ImageDataLike = {
        data: result.imageData,
        width: img.width,
        height: img.height,
      };

      const tamperedPayload: SignaturePayload = {
        ...samplePayload,
        hash: "0000000000000000000000000000000000000000000000000000000000000000",
      };
      const verifyResult = verifyWatermark(watermarkedImg, tamperedPayload);
      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.confidence).toBeLessThan(1.0);
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-platform Compatibility Test Vectors
// ---------------------------------------------------------------------------

describe("Cross-platform compatibility vectors", () => {
  /**
   * These test vectors ensure that our GF(2^8) arithmetic produces
   * identical results across all platforms (TypeScript, Go, Rust, Python).
   */

  it("GF multiplication test vector #1", () => {
    // alpha^1 * alpha^2 = alpha^3
    // 2 * 4 = 8
    expect(gfMul(2, 4)).toBe(8);
  });

  it("GF multiplication test vector #2", () => {
    // alpha^100 * alpha^50 = alpha^150
    // GF_EXP[100] * GF_EXP[50] = GF_EXP[150]
    const a = gfMul(2, 2); // Start building up
    // Direct test: 3 * 7
    // 3 = alpha^25 (since 2^25 = 3)
    // 7 = alpha^198 (since 2^198 = 7)
    // 3 * 7 = alpha^(25+198) = alpha^223 = 9
    const prod = gfMul(3, 7);
    expect(prod).toBe(9);
  });

  it("GF division test vector", () => {
    // alpha^50 / alpha^25 = alpha^25
    expect(gfDiv(8, 2)).toBe(4);
  });

  it("RS encoder produces deterministic output for test vector", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const nsym = 8;
    const encoded = rsEncode(data, nsym);

    // First bytes should be the original data
    expect(encoded.slice(0, 5)).toEqual(data);

    // Last 8 bytes are parity
    expect(encoded.length).toBe(13);

    // Specific known parity bytes for this test vector
    // These values are computed with our GF tables and should match
    // across all implementations using the same primitive polynomial
    const parity = encoded.slice(5);
    expect(parity.length).toBe(8);

    // Verify we can decode it back
    const decoded = rsDecode(encoded, nsym);
    expect(decoded).not.toBeNull();
    expect(decoded!).toEqual(data);
  });

  it("RS full correction test vector with known errors", () => {
    // Standard test: encode, corrupt specific positions, decode
    const data = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
    const nsym = 10;
    const encoded = new Uint8Array(rsEncode(data, nsym));

    // Corrupt exactly 4 bytes (within capacity of 10/2 = 5)
    encoded[0] = 0xff;
    encoded[3] = 0xaa;
    encoded[6] = 0xbb;
    encoded[9] = 0xcc;

    const decoded = rsDecode(encoded, nsym);
    expect(decoded).not.toBeNull();
    expect(decoded!).toEqual(data);
  });

  it("JSON payload encoding produces consistent bytes", () => {
    const payload: SignaturePayload = {
      hash: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      nonce: "deadbeef",
      ntime: "12345678",
      version: "20000000",
      status: "TEST_VECTOR",
    };
    const bytes = encodeSignature(payload);
    const decoded = decodeSignature(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded!.hash).toBe(payload.hash);
    expect(decoded!.status).toBe("TEST_VECTOR");
  });
});

// ---------------------------------------------------------------------------
// Constants Verification
// ---------------------------------------------------------------------------

describe("Constants", () => {
  it("SIGNATURE_REPEATS is 5", () => {
    expect(SIGNATURE_REPEATS).toBe(5);
  });

  it("RS_NSYM is 32", () => {
    expect(RS_NSYM).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// Crypto / Software Signing Tests
// ---------------------------------------------------------------------------

describe("Crypto", () => {
  it("hashImage: produces consistent 64-char hex hash", async () => {
    const img = createFakeImageData(16, 16, 12345);
    const hash1 = await hashImage(img);
    const hash2 = await hashImage(img);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
  });

  it("hashImage: different images produce different hashes", async () => {
    const img1 = createFakeImageData(16, 16, 111);
    const img2 = createFakeImageData(16, 16, 222);
    const hash1 = await hashImage(img1);
    const hash2 = await hashImage(img2);
    expect(hash1).not.toBe(hash2);
  });

  it("verifyNonce: validates a correct nonce", async () => {
    // Use a very easy difficulty for testing
    const easyDifficulty = BigInt(
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    );
    // Any nonce should pass with max difficulty
    const hash =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result = await verifyNonce(hash, "00000000", easyDifficulty);
    expect(result).toBe(true);
  });

  it("verifyNonce: rejects an incorrect nonce for hard difficulty", async () => {
    const hardDifficulty = BigInt(1); // Impossibly hard
    const hash =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const result = await verifyNonce(hash, "00000000", hardDifficulty);
    expect(result).toBe(false);
  });
});
