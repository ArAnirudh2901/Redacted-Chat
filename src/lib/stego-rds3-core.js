import { hexToBytes, bytesToHex } from "@/lib/stego-seeded-prng"

export const RDS3_MAGIC = "RDS3"
export const RDS3_VERSION = 1
export const RDS3_WIDTH = 1920
export const RDS3_HEIGHT = 1080
export const RDS3_CHANNELS_PER_PIXEL = 3
export const RDS3_HEADER_BYTES = 17 // magic(4) + version(1) + crc32(4) + metaLen(4) + cipherLen(4)

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const crcTable = new Uint32Array(256)

for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
        c = ((c & 1) !== 0) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crcTable[i] = c >>> 0
}

/**
 * @param {Uint8Array} bytes
 * @param {number} [seed]
 */
export function crc32(bytes, seed = 0) {
    let crc = (seed ^ 0xffffffff) >>> 0
    for (let i = 0; i < bytes.length; i += 1) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff]
    }
    return (crc ^ 0xffffffff) >>> 0
}

/**
 * @param {number} value
 */
function uint32beBytes(value) {
    const out = new Uint8Array(4)
    const view = new DataView(out.buffer)
    view.setUint32(0, value >>> 0, false)
    return out
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function readUint32BE(bytes, offset) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false) >>> 0
}

/**
 * @param {unknown} meta
 * @param {string} secretCipherHex
 */
export function buildRds3Payload(meta, secretCipherHex) {
    const metaJson = JSON.stringify(meta || {})
    const metaBytes = encoder.encode(metaJson)
    const cipherBytes = hexToBytes(secretCipherHex)

    const combined = new Uint8Array(metaBytes.length + cipherBytes.length)
    combined.set(metaBytes, 0)
    combined.set(cipherBytes, metaBytes.length)
    const checksum = crc32(combined)

    const out = new Uint8Array(RDS3_HEADER_BYTES + metaBytes.length + cipherBytes.length)
    out.set(encoder.encode(RDS3_MAGIC), 0)
    out[4] = RDS3_VERSION
    out.set(uint32beBytes(checksum), 5)
    out.set(uint32beBytes(metaBytes.length), 9)
    out.set(uint32beBytes(cipherBytes.length), 13)
    out.set(metaBytes, RDS3_HEADER_BYTES)
    out.set(cipherBytes, RDS3_HEADER_BYTES + metaBytes.length)

    return {
        payload: out,
        checksum,
        metaBytes,
        cipherBytes,
    }
}

/**
 * @param {Uint8Array} payload
 */
export function parseAndVerifyRds3Payload(payload) {
    if (!(payload instanceof Uint8Array) || payload.length < RDS3_HEADER_BYTES) {
        throw new Error("RDS3 payload too small")
    }

    const magic = decoder.decode(payload.subarray(0, 4))
    if (magic !== RDS3_MAGIC) {
        throw new Error("RDS3 magic mismatch")
    }

    const version = payload[4]
    if (version !== RDS3_VERSION) {
        throw new Error(`Unsupported RDS3 version: ${version}`)
    }

    const checksum = readUint32BE(payload, 5)
    const metaLen = readUint32BE(payload, 9)
    const cipherLen = readUint32BE(payload, 13)

    const totalLen = RDS3_HEADER_BYTES + metaLen + cipherLen
    if (totalLen !== payload.length) {
        throw new Error("RDS3 payload length mismatch")
    }

    const metaBytes = payload.subarray(RDS3_HEADER_BYTES, RDS3_HEADER_BYTES + metaLen)
    const cipherBytes = payload.subarray(RDS3_HEADER_BYTES + metaLen)

    const combined = new Uint8Array(metaBytes.length + cipherBytes.length)
    combined.set(metaBytes, 0)
    combined.set(cipherBytes, metaBytes.length)
    const computed = crc32(combined)

    if ((computed >>> 0) !== (checksum >>> 0)) {
        throw new Error("RDS3 checksum mismatch")
    }

    let secretMeta = {}
    try {
        secretMeta = JSON.parse(decoder.decode(metaBytes))
    } catch {
        throw new Error("RDS3 metadata parse failed")
    }

    return {
        version,
        checksum,
        metaLen,
        cipherLen,
        secretMeta,
        secretCipherHex: bytesToHex(cipherBytes),
    }
}

/**
 * @param {number} payloadBytes
 */
export function requiredPixelsForPayload(payloadBytes) {
    const bits = payloadBytes * 8
    return Math.ceil(bits / RDS3_CHANNELS_PER_PIXEL)
}

/**
 * @param {Uint8ClampedArray} pixels
 * @param {Uint32Array} pixelOrder
 * @param {Uint8Array} payload
 */
export function embedPayloadWithRgbLsb(pixels, pixelOrder, payload) {
    const totalBits = payload.length * 8
    if (pixelOrder.length * RDS3_CHANNELS_PER_PIXEL < totalBits) {
        throw new Error("Pixel order does not have enough capacity for payload")
    }

    for (let bitIndex = 0; bitIndex < totalBits; bitIndex += 1) {
        const byteIndex = (bitIndex / 8) | 0
        const bitInByte = 7 - (bitIndex % 8)
        const bit = (payload[byteIndex] >>> bitInByte) & 1

        const pixelSeqIndex = (bitIndex / RDS3_CHANNELS_PER_PIXEL) | 0
        const channel = bitIndex % RDS3_CHANNELS_PER_PIXEL // 0=R,1=G,2=B
        const pixel = pixelOrder[pixelSeqIndex]
        const offset = pixel * 4 + channel
        pixels[offset] = (pixels[offset] & 0xfe) | bit
    }
}

/**
 * @param {Uint8ClampedArray} pixels
 * @param {Uint32Array} pixelOrder
 * @param {number} byteLength
 */
export function extractPayloadWithRgbLsb(pixels, pixelOrder, byteLength) {
    const totalBits = byteLength * 8
    if (pixelOrder.length * RDS3_CHANNELS_PER_PIXEL < totalBits) {
        throw new Error("Pixel order does not have enough bits to extract payload")
    }

    const out = new Uint8Array(byteLength)
    for (let bitIndex = 0; bitIndex < totalBits; bitIndex += 1) {
        const pixelSeqIndex = (bitIndex / RDS3_CHANNELS_PER_PIXEL) | 0
        const channel = bitIndex % RDS3_CHANNELS_PER_PIXEL
        const pixel = pixelOrder[pixelSeqIndex]
        const offset = pixel * 4 + channel
        const bit = pixels[offset] & 1

        const byteIndex = (bitIndex / 8) | 0
        const bitInByte = 7 - (bitIndex % 8)
        out[byteIndex] |= bit << bitInByte
    }

    return out
}
