const STEGO_MAGIC = "RDS2"
const decoder = new TextDecoder()

/**
 * @param {Uint8Array} bytes
 */
function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * @param {Uint8ClampedArray} pixels
 * @param {number} startBit
 * @param {number} byteCount
 */
function readBytesFromPixels(pixels, startBit, byteCount) {
    const totalBits = byteCount * 8
    const maxBits = Math.floor(pixels.length / 4)
    if (startBit + totalBits > maxBits) {
        throw new Error("Stego payload truncated")
    }

    const out = new Uint8Array(byteCount)
    for (let i = 0; i < totalBits; i += 1) {
        const pixelIdx = startBit + i
        const bit = pixels[pixelIdx * 4] & 1
        const byteIdx = (i / 8) | 0
        const bitIdx = 7 - (i % 8)
        out[byteIdx] |= bit << bitIdx
    }
    return out
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 */
function readUint32BE(bytes, offset) {
    return (
        ((bytes[offset] << 24) >>> 0) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
    ) >>> 0
}

/**
 * @param {Blob | string} imageInput
 */
async function imageToPixels(imageInput) {
    const url = typeof imageInput === "string" ? imageInput : URL.createObjectURL(imageInput)
    const image = await new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = "async"
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Failed to load stego image"))
        img.src = url
    })

    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) {
        throw new Error("Canvas unavailable")
    }
    ctx.drawImage(image, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    if (typeof imageInput !== "string") {
        URL.revokeObjectURL(url)
    }
    return imageData.data
}

/**
 * Extract deterministic lossless stego payload from PNG.
 * @param {Blob | string} imageInput
 */
export async function extractLosslessStegoPayload(imageInput) {
    const pixels = await imageToPixels(imageInput)

    const header = readBytesFromPixels(pixels, 0, 12)
    const magic = decoder.decode(header.slice(0, 4))
    if (magic !== STEGO_MAGIC) {
        throw new Error("No secure stego payload found")
    }

    const metaLen = readUint32BE(header, 4)
    const cipherLen = readUint32BE(header, 8)
    if (metaLen > 16_384) {
        throw new Error("Invalid stego metadata length")
    }
    if (cipherLen <= 0 || cipherLen > 300_000) {
        throw new Error("Invalid stego cipher length")
    }

    const payloadBytes = readBytesFromPixels(pixels, 12 * 8, metaLen + cipherLen)
    const metaBytes = payloadBytes.slice(0, metaLen)
    const cipherBytes = payloadBytes.slice(metaLen)

    let secretMeta = {}
    try {
        secretMeta = JSON.parse(decoder.decode(metaBytes))
    } catch {
        throw new Error("Stego metadata parse failed")
    }

    return {
        secretMeta,
        secretCipherHex: bytesToHex(cipherBytes),
    }
}

