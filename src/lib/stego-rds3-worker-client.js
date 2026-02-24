/**
 * @param {unknown} value
 */
function asError(value) {
    if (value instanceof Error) return value
    return new Error(typeof value === "string" ? value : "Unknown stego worker error")
}

export function isRds3WorkerSupported() {
    if (typeof window === "undefined") return false
    return (
        typeof Worker === "function"
        && typeof createImageBitmap === "function"
        && typeof OffscreenCanvas !== "undefined"
        && Boolean(crypto?.subtle)
    )
}

function failClosedSupportError() {
    return new Error(
        "Secure stego requires Worker + OffscreenCanvas + createImageBitmap + WebCrypto. Please use a modern browser.",
    )
}

/**
 * @param {"encode" | "decode"} op
 * @param {Record<string, any>} payload
 * @param {number} timeoutMs
 */
function runWorkerOp(op, payload, timeoutMs) {
    if (!isRds3WorkerSupported()) {
        return Promise.reject(failClosedSupportError())
    }

    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("../workers/stego-rds3.worker.js", import.meta.url), { type: "module" })
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

        const cleanup = () => {
            clearTimeout(timer)
            worker.onmessage = null
            worker.onerror = null
            worker.terminate()
        }

        const timer = setTimeout(() => {
            cleanup()
            reject(new Error(`RDS3 worker timed out during ${op}`))
        }, timeoutMs)

        worker.onmessage = (event) => {
            const msg = event.data || {}
            if (msg.id !== id) return

            cleanup()
            if (msg.ok) {
                resolve(msg.result)
                return
            }

            reject(new Error(msg?.error?.message || `RDS3 worker ${op} failed`))
        }

        worker.onerror = (event) => {
            cleanup()
            reject(new Error(event?.message || `RDS3 worker ${op} crashed`))
        }

        worker.postMessage({ id, op, payload })
    })
}

/**
 * @param {{ coverFile: Blob, roomKeyHex: string, secretMeta: Record<string, any>, secretCipherHex: string }} params
 */
export async function encodeRds3StegoPng(params) {
    try {
        const result = await runWorkerOp("encode", params, 45_000)
        return /** @type {{ pngBlob: Blob, width: number, height: number, bytesEmbedded: number }} */ (result)
    } catch (error) {
        throw asError(error)
    }
}

/**
 * @param {{ stegoFile: Blob, roomKeyHex: string }} params
 */
export async function decodeRds3StegoPng(params) {
    try {
        const result = await runWorkerOp("decode", params, 30_000)
        return /** @type {{ secretMeta: Record<string, any>, secretCipherHex: string, crcOk: boolean, width: number, height: number }} */ (result)
    } catch (error) {
        throw asError(error)
    }
}
