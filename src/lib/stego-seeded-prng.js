/**
 * @param {string} hex
 */
export function hexToBytes(hex) {
    const clean = (hex || "").trim().toLowerCase()
    if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
        throw new Error("Invalid hex string")
    }
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < clean.length; i += 2) {
        out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
    }
    return out
}

/**
 * @param {Uint8Array} bytes
 */
export function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Deterministic HMAC-SHA256 counter-based PRNG keyed by RoomKey bytes.
 */
export class HmacCounterPrng {
    /**
     * @param {CryptoKey} key
     */
    constructor(key) {
        this.key = key
        this.counter = 0n
        this.buffer = new Uint8Array(0)
        this.offset = 0
    }

    async refill() {
        const counterBytes = new Uint8Array(8)
        new DataView(counterBytes.buffer).setBigUint64(0, this.counter, false)
        this.counter += 1n
        const sig = await crypto.subtle.sign("HMAC", this.key, counterBytes)
        this.buffer = new Uint8Array(sig)
        this.offset = 0
    }

    async randomUint32() {
        if (this.offset + 4 > this.buffer.length) {
            await this.refill()
        }
        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
        const out = view.getUint32(this.offset, false)
        this.offset += 4
        return out >>> 0
    }

    /**
     * Uniform random int in [0, maxExclusive)
     * @param {number} maxExclusive
     */
    async randomInt(maxExclusive) {
        if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
            throw new Error("maxExclusive must be a positive integer")
        }

        const zone = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive
        while (true) {
            const value = await this.randomUint32()
            if (value < zone) {
                return value % maxExclusive
            }
        }
    }
}

/**
 * @param {string} roomKeyHex
 */
export async function createSeededPrng(roomKeyHex) {
    const keyBytes = hexToBytes(roomKeyHex)
    const key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    )
    return new HmacCounterPrng(key)
}
