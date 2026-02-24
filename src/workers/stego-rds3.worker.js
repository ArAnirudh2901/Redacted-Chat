import {
    RDS3_MAGIC,
    RDS3_VERSION,
    RDS3_WIDTH,
    RDS3_HEIGHT,
    RDS3_HEADER_BYTES,
    buildRds3Payload,
    parseAndVerifyRds3Payload,
    requiredPixelsForPayload,
    embedPayloadWithRgbLsb,
    extractPayloadWithRgbLsb,
} from "@/lib/stego-rds3-core"
import { createSeededPrng } from "@/lib/stego-seeded-prng"
import { generateSeededPixelOrder } from "@/lib/stego-seeded-walk"

/**
 * @param {unknown} value
 */
function asError(value) {
    if (value instanceof Error) return value
    return new Error(typeof value === "string" ? value : "Unknown worker failure")
}

function ensureCapabilities() {
    if (typeof createImageBitmap !== "function") {
        throw new Error("createImageBitmap is unavailable in this browser")
    }
    if (typeof OffscreenCanvas === "undefined") {
        throw new Error("OffscreenCanvas is unavailable in this browser")
    }
    if (!crypto?.subtle) {
        throw new Error("WebCrypto subtle API is unavailable in this browser")
    }
}

/**
 * @param {Blob} blob
 * @param {number} width
 * @param {number} height
 */
async function toImageData(blob, width, height) {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) {
        bitmap.close()
        throw new Error("2D canvas context unavailable")
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    return { bitmap, canvas, ctx, imageData }
}

/**
 * @param {{ coverFile: Blob, roomKeyHex: string, secretMeta: Record<string, any>, secretCipherHex: string }} payload
 */
async function encodeRds3(payload) {
    ensureCapabilities()

    let bitmap = null
    let canvas = null
    let imageData = null
    let encodedPayload = null
    let pixelOrder = null
    let prng = null

    try {
        const imageResult = await toImageData(payload.coverFile, RDS3_WIDTH, RDS3_HEIGHT)
        bitmap = imageResult.bitmap
        canvas = imageResult.canvas
        imageData = imageResult.imageData

        const built = buildRds3Payload(payload.secretMeta, payload.secretCipherHex)
        encodedPayload = built.payload

        const totalPixels = RDS3_WIDTH * RDS3_HEIGHT
        const maxBytes = Math.floor((totalPixels * 3) / 8)
        if (encodedPayload.length > maxBytes) {
            throw new Error(`Encrypted payload exceeds RDS3 capacity (${encodedPayload.length} > ${maxBytes} bytes at 1920x1080)`) 
        }

        const neededPixels = requiredPixelsForPayload(encodedPayload.length)
        prng = await createSeededPrng(payload.roomKeyHex)
        pixelOrder = await generateSeededPixelOrder(totalPixels, neededPixels, prng)

        embedPayloadWithRgbLsb(imageData.data, pixelOrder, encodedPayload)
        imageResult.ctx.putImageData(imageData, 0, 0)

        const pngBlob = await canvas.convertToBlob({ type: "image/png" })

        return {
            pngBlob,
            width: RDS3_WIDTH,
            height: RDS3_HEIGHT,
            bytesEmbedded: encodedPayload.length,
        }
    } finally {
        if (bitmap) bitmap.close()
        if (encodedPayload) encodedPayload.fill(0)
        if (pixelOrder) pixelOrder.fill(0)
        if (imageData?.data) imageData.data.fill(0)
        bitmap = null
        imageData = null
        canvas = null
        prng = null
        pixelOrder = null
        encodedPayload = null
    }
}

/**
 * @param {Uint8Array} headerBytes
 */
function parseHeader(headerBytes) {
    const magic = new TextDecoder().decode(headerBytes.subarray(0, 4))
    const version = headerBytes[4]
    const view = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength)
    const checksum = view.getUint32(5, false)
    const metaLen = view.getUint32(9, false)
    const cipherLen = view.getUint32(13, false)
    return { magic, version, checksum, metaLen, cipherLen }
}

/**
 * @param {{ stegoFile: Blob, roomKeyHex: string }} payload
 */
async function decodeRds3(payload) {
    ensureCapabilities()

    let bitmap = null
    let canvas = null
    let imageData = null
    let headerOrder = null
    let fullOrder = null
    let headerBytes = null
    let fullPayload = null

    try {
        const sourceBitmap = await createImageBitmap(payload.stegoFile)
        bitmap = sourceBitmap
        const width = bitmap.width
        const height = bitmap.height
        const totalPixels = width * height

        canvas = new OffscreenCanvas(width, height)
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) {
            throw new Error("2D canvas context unavailable")
        }

        ctx.drawImage(bitmap, 0, 0, width, height)
        imageData = ctx.getImageData(0, 0, width, height)

        const headerPixels = requiredPixelsForPayload(RDS3_HEADER_BYTES)
        const headerPrng = await createSeededPrng(payload.roomKeyHex)
        headerOrder = await generateSeededPixelOrder(totalPixels, headerPixels, headerPrng)
        headerBytes = extractPayloadWithRgbLsb(imageData.data, headerOrder, RDS3_HEADER_BYTES)

        const header = parseHeader(headerBytes)
        if (header.magic !== RDS3_MAGIC) {
            throw new Error("RDS3 magic mismatch")
        }
        if (header.version !== RDS3_VERSION) {
            throw new Error(`Unsupported RDS3 version: ${header.version}`)
        }

        const payloadBytes = RDS3_HEADER_BYTES + header.metaLen + header.cipherLen
        const maxBytes = Math.floor((totalPixels * 3) / 8)
        if (payloadBytes <= 0 || payloadBytes > maxBytes) {
            throw new Error("RDS3 payload size is invalid for this image")
        }

        const neededPixels = requiredPixelsForPayload(payloadBytes)
        const fullPrng = await createSeededPrng(payload.roomKeyHex)
        fullOrder = await generateSeededPixelOrder(totalPixels, neededPixels, fullPrng)
        fullPayload = extractPayloadWithRgbLsb(imageData.data, fullOrder, payloadBytes)

        const parsed = parseAndVerifyRds3Payload(fullPayload)

        return {
            secretMeta: parsed.secretMeta,
            secretCipherHex: parsed.secretCipherHex,
            crcOk: true,
            width,
            height,
        }
    } finally {
        if (bitmap) bitmap.close()
        if (headerOrder) headerOrder.fill(0)
        if (fullOrder) fullOrder.fill(0)
        if (headerBytes) headerBytes.fill(0)
        if (fullPayload) fullPayload.fill(0)
        if (imageData?.data) imageData.data.fill(0)

        bitmap = null
        canvas = null
        imageData = null
        headerOrder = null
        fullOrder = null
        headerBytes = null
        fullPayload = null
    }
}

self.onmessage = async (event) => {
    const data = event.data || {}
    const id = data.id
    const op = data.op

    try {
        if (op === "encode") {
            const result = await encodeRds3(data.payload)
            self.postMessage({ id, ok: true, result })
            return
        }

        if (op === "decode") {
            const result = await decodeRds3(data.payload)
            self.postMessage({ id, ok: true, result })
            return
        }

        throw new Error(`Unknown worker op: ${String(op)}`)
    } catch (rawError) {
        const error = asError(rawError)
        self.postMessage({
            id,
            ok: false,
            error: {
                code: "RDS3_WORKER_ERROR",
                message: error.message,
            },
        })
    }
}
