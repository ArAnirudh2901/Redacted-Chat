import sharp from "sharp"

const STEGO_WIDTH = 1920
const STEGO_HEIGHT = 1080
const STEGO_MAGIC = Buffer.from("RDS2")
const MAX_META_BYTES = 4 * 1024

/**
 * @param {string} input
 */
function decodeBase64Image(input) {
    const trimmed = (input || "").trim()
    if (!trimmed) {
        throw new Error("Cover image is required")
    }
    const idx = trimmed.indexOf("base64,")
    const base64 = idx >= 0 ? trimmed.slice(idx + "base64,".length) : trimmed
    return Buffer.from(base64, "base64")
}

/**
 * @param {string} hex
 */
function hexToBuffer(hex) {
    const clean = (hex || "").trim().toLowerCase()
    if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
        throw new Error("secretCipherHex must be a valid even-length hex string")
    }
    return Buffer.from(clean, "hex")
}

/**
 * @param {number} value
 */
function uint32be(value) {
    const out = Buffer.allocUnsafe(4)
    out.writeUInt32BE(value >>> 0, 0)
    return out
}

/**
 * @param {{
 *   coverBase64: string,
 *   secretCipherHex: string,
 *   secretMeta?: Record<string, any>,
 * }} params
 */
export async function encodeLosslessStegoPng(params) {
    const coverBuffer = decodeBase64Image(params.coverBase64)
    const cipherBuffer = hexToBuffer(params.secretCipherHex)
    const metaJson = JSON.stringify(params.secretMeta || {})
    const metaBuffer = Buffer.from(metaJson, "utf8")

    if (metaBuffer.byteLength > MAX_META_BYTES) {
        throw new Error(`secretMeta too large (${metaBuffer.byteLength} bytes). Max ${MAX_META_BYTES} bytes.`)
    }

    const payload = Buffer.concat([
        STEGO_MAGIC,
        uint32be(metaBuffer.byteLength),
        uint32be(cipherBuffer.byteLength),
        metaBuffer,
        cipherBuffer,
    ])

    const payloadBits = payload.byteLength * 8
    const maxBits = STEGO_WIDTH * STEGO_HEIGHT
    if (payloadBits > maxBits) {
        const maxBytes = Math.floor(maxBits / 8)
        throw new Error(`Encrypted payload exceeds stego capacity (${payload.byteLength} > ${maxBytes} bytes at 1920x1080).`)
    }

    const normalized = await sharp(coverBuffer)
        .rotate()
        .resize(STEGO_WIDTH, STEGO_HEIGHT, { fit: "fill", kernel: "lanczos3" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    const pixels = Buffer.from(normalized.data)

    let bitCursor = 0
    for (let i = 0; i < payload.length; i += 1) {
        const byte = payload[i]
        for (let bit = 7; bit >= 0; bit -= 1) {
            const value = (byte >>> bit) & 1
            const pixelOffset = bitCursor * 4 // Red channel at each pixel
            pixels[pixelOffset] = (pixels[pixelOffset] & 0xfe) | value
            bitCursor += 1
        }
    }

    return sharp(pixels, {
        raw: {
            width: STEGO_WIDTH,
            height: STEGO_HEIGHT,
            channels: 4,
        },
    }).png({ compressionLevel: 9 }).toBuffer()
}

