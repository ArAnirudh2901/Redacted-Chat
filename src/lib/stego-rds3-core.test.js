import { describe, expect, test } from "bun:test"
import { buildRds3Payload, parseAndVerifyRds3Payload, requiredPixelsForPayload } from "./stego-rds3-core"
import { createSeededPrng } from "./stego-seeded-prng"
import { generateSeededPixelOrder } from "./stego-seeded-walk"

describe("RDS3 seeded primitives", () => {
    test("HMAC PRNG is deterministic for same room key", async () => {
        const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        const a = await createSeededPrng(key)
        const b = await createSeededPrng(key)

        const seqA = []
        const seqB = []
        for (let i = 0; i < 10; i += 1) {
            seqA.push(await a.randomInt(1_000_000))
            seqB.push(await b.randomInt(1_000_000))
        }

        expect(seqA).toEqual(seqB)
    })

    test("seeded walk has no repeated pixel indices", async () => {
        const key = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        const prng = await createSeededPrng(key)
        const order = await generateSeededPixelOrder(250_000, 10_000, prng)

        const seen = new Set(order)
        expect(seen.size).toBe(order.length)
    })

    test("RDS3 payload passes CRC and fails after tamper", () => {
        const meta = { ivHex: "00112233445566778899aabb", kind: "stego.payload", v: 1 }
        const cipherHex = "aabbccddeeff00112233445566778899"

        const built = buildRds3Payload(meta, cipherHex)
        const parsed = parseAndVerifyRds3Payload(built.payload)

        expect(parsed.secretMeta.ivHex).toBe(meta.ivHex)
        expect(parsed.secretCipherHex).toBe(cipherHex)

        const tampered = new Uint8Array(built.payload)
        tampered[tampered.length - 1] ^= 1
        expect(() => parseAndVerifyRds3Payload(tampered)).toThrow(/checksum/i)
    })

    test("rejects malformed payloads", () => {
        expect(() => parseAndVerifyRds3Payload(new Uint8Array(4))).toThrow(/too small/i)
        expect(requiredPixelsForPayload(17)).toBe(Math.ceil((17 * 8) / 3))
    })
})
