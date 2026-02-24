/**
 * Steganography — hide/reveal secret text in images using LSB encoding.
 *
 * Protocol:
 *   Bytes 0-3:   Magic marker (0x53 0x54 0x45 0x47 = "STEG")
 *   Bytes 4-7:   Message length (uint32, big-endian)
 *   Bytes 8+:    UTF-8 encoded message bytes
 *
 * Each bit is stored in the Red channel of consecutive pixels.
 *
 * Robustness note:
 * - New encoding writes replicated 2-LSB symbols across RGB channels.
 *   (00 for 0, 11 for 1) on R, G, and B for each payload bit.
 * - Decoder first tries RGB-majority robust mode, then falls back to
 *   older red-channel-only robust mode, then legacy 1-LSB mode.
 */

const MAGIC = [0x53, 0x54, 0x45, 0x47] // "STEG"

/**
 * Encode a secret message into an image.
 * @param {string} imageDataUrl — image source URL (blob or data URL)
 * @param {string} secretText   — the text to hide
 * @returns {Promise<string>}   — modified image as data URL
 */
export async function encodeMessage(imageDataUrl, secretText) {
    if (typeof imageDataUrl !== "string" || imageDataUrl.length === 0) {
        throw new Error("No image selected for stego encoding.")
    }

    const img = await loadImage(imageDataUrl)
    const canvas = document.createElement("canvas")
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("Unable to initialize image processing canvas.")
    ctx.drawImage(img, 0, 0)

    let imageData
    try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    } catch {
        throw new Error("Unable to read image data. Please use PNG, JPG, or WebP.")
    }
    const pixels = imageData.data // RGBA flat array

    const encoder = new TextEncoder()
    const msgBytes = encoder.encode(secretText)

    // Header: 4 magic bytes + 4 length bytes + message bytes
    const header = new Uint8Array(8 + msgBytes.length)
    header[0] = MAGIC[0]
    header[1] = MAGIC[1]
    header[2] = MAGIC[2]
    header[3] = MAGIC[3]
    // Big-endian uint32 length
    header[4] = (msgBytes.length >>> 24) & 0xff
    header[5] = (msgBytes.length >>> 16) & 0xff
    header[6] = (msgBytes.length >>> 8) & 0xff
    header[7] = msgBytes.length & 0xff
    header.set(msgBytes, 8)

    const totalBits = header.length * 8
    const availablePixels = (pixels.length / 4) | 0

    if (totalBits > availablePixels) {
        throw new Error(
            `Image too small to hold message. Need ${totalBits} pixels, have ${availablePixels}.`
        )
    }

    // Embed each bit with a replicated RGB 2-bit symbol:
    // 0 -> 00, 1 -> 11 on R/G/B channels.
    // This is more resilient to small channel-level perturbations.
    for (let i = 0; i < totalBits; i++) {
        const byteIndex = (i / 8) | 0
        const bitIndex = 7 - (i % 8)
        const bit = (header[byteIndex] >>> bitIndex) & 1
        const pixelOffset = i * 4 // Red channel of pixel i
        const symbol = bit ? 0x03 : 0x00
        pixels[pixelOffset] = (pixels[pixelOffset] & 0xfc) | symbol
        pixels[pixelOffset + 1] = (pixels[pixelOffset + 1] & 0xfc) | symbol
        pixels[pixelOffset + 2] = (pixels[pixelOffset + 2] & 0xfc) | symbol
    }

    ctx.putImageData(imageData, 0, 0)
    try {
        return canvas.toDataURL("image/png")
    } catch {
        throw new Error("Unable to encode image. Try a smaller image file.")
    }
}

/**
 * Decode a hidden message from an image.
 * @param {string} imageDataUrl — base64 data URL of the encoded image
 * @returns {Promise<string|null>} — the hidden text, or null if none found
 */
export async function decodeMessage(imageDataUrl) {
    const img = await loadImage(imageDataUrl)
    const canvas = document.createElement("canvas")
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext("2d")
    ctx.drawImage(img, 0, 0)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data

    /**
     * Try decoding with a specific bit-extraction mode.
     * @param {"rgb-robust" | "robust" | "legacy"} mode
     * @returns {string | null}
     */
    function decodeWithMode(mode) {
        /**
         * Read `count` bytes starting at bit offset.
         * @param {number} startBit
         * @param {number} count
         * @returns {Uint8Array | null}
         */
        function readBytes(startBit, count) {
            const totalBits = count * 8
            const endPixel = startBit + totalBits
            if (endPixel * 4 > pixels.length) return null

            const result = new Uint8Array(count)
            for (let i = 0; i < totalBits; i++) {
                const pixelIndex = startBit + i
                const red = pixels[pixelIndex * 4]
                const green = pixels[pixelIndex * 4 + 1]
                const blue = pixels[pixelIndex * 4 + 2]
                let bit
                if (mode === "rgb-robust") {
                    const r = ((red & 0x03) >= 0x02) ? 1 : 0
                    const g = ((green & 0x03) >= 0x02) ? 1 : 0
                    const b = ((blue & 0x03) >= 0x02) ? 1 : 0
                    bit = (r + g + b) >= 2 ? 1 : 0
                } else if (mode === "robust") {
                    bit = ((red & 0x03) >= 0x02 ? 1 : 0)
                } else {
                    bit = (red & 0x01)
                }
                const byteIdx = (i / 8) | 0
                const bitIdx = 7 - (i % 8)
                result[byteIdx] |= bit << bitIdx
            }
            return result
        }

        // Read magic bytes
        const magic = readBytes(0, 4)
        if (
            !magic ||
            magic[0] !== MAGIC[0] ||
            magic[1] !== MAGIC[1] ||
            magic[2] !== MAGIC[2] ||
            magic[3] !== MAGIC[3]
        ) {
            return null
        }

        // Read length (big-endian uint32)
        const lenBytes = readBytes(32, 4)
        if (!lenBytes) return null
        const msgLength = (
            ((lenBytes[0] << 24) >>> 0) |
            (lenBytes[1] << 16) |
            (lenBytes[2] << 8) |
            lenBytes[3]
        ) >>> 0

        if (msgLength <= 0 || msgLength > 10_000_000) return null

        const msgBytes = readBytes(64, msgLength)
        if (!msgBytes) return null
        const decoder = new TextDecoder()
        return decoder.decode(msgBytes)
    }

    // Prefer current RGB-robust mode, then older red-only robust mode, then legacy mode.
    return decodeWithMode("rgb-robust") ?? decodeWithMode("robust") ?? decodeWithMode("legacy")
}

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = "async"
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Unable to load the selected image. Please use PNG, JPG, or WebP."))
        img.src = src
    })
}
