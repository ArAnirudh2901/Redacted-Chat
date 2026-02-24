const KDF_DEFAULT_ITERATIONS = 100_000
const ROOM_KEY_BYTES = 32
const GATEKEEPER_TAG = "redacted:gatekeeper:v1"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * @param {Uint8Array} bytes
 */
function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * @param {string} hex
 */
export function hexToBytes(hex) {
    const clean = (hex || "").trim().toLowerCase()
    if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
        throw new Error("Invalid hex string")
    }
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < clean.length; i += 2) {
        out[i / 2] = parseInt(clean.slice(i, i + 2), 16)
    }
    return out
}

/**
 * @param {number} byteLength
 */
export function randomHex(byteLength) {
    const bytes = new Uint8Array(byteLength)
    crypto.getRandomValues(bytes)
    return bytesToHex(bytes)
}

/**
 * PBKDF2-SHA256 room key derivation (client-side only).
 * @param {string} answer
 * @param {string} saltHex
 * @param {number} [iterations]
 */
export async function deriveRoomKeyHex(answer, saltHex, iterations = KDF_DEFAULT_ITERATIONS) {
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(answer),
        "PBKDF2",
        false,
        ["deriveBits"],
    )
    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: hexToBytes(saltHex),
            iterations,
        },
        keyMaterial,
        ROOM_KEY_BYTES * 8,
    )
    return bytesToHex(new Uint8Array(bits))
}

/**
 * Deterministic gatekeeper proof derived from room key.
 * @param {string} roomKeyHex
 */
export async function deriveGatekeeperProofHex(roomKeyHex) {
    const keyBytes = hexToBytes(roomKeyHex)
    const tagBytes = encoder.encode(GATEKEEPER_TAG)
    const combined = new Uint8Array(keyBytes.length + tagBytes.length)
    combined.set(keyBytes, 0)
    combined.set(tagBytes, keyBytes.length)
    const digest = await crypto.subtle.digest("SHA-256", combined)
    return bytesToHex(new Uint8Array(digest))
}

/**
 * @param {string} roomKeyHex
 */
async function importAesKey(roomKeyHex) {
    return crypto.subtle.importKey(
        "raw",
        hexToBytes(roomKeyHex),
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
    )
}

/**
 * @param {string} roomKeyHex
 * @param {unknown} payload
 * @param {string} kind
 */
export async function encryptJsonEnvelope(roomKeyHex, payload, kind) {
    const key = await importAesKey(roomKeyHex)
    const iv = new Uint8Array(12)
    crypto.getRandomValues(iv)
    const plain = encoder.encode(JSON.stringify(payload))
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain)

    return {
        v: 1,
        kind,
        ivHex: bytesToHex(iv),
        cipherHex: bytesToHex(new Uint8Array(cipher)),
        createdAt: Date.now(),
    }
}

/**
 * @param {string} roomKeyHex
 * @param {{ ivHex: string, cipherHex: string }} envelope
 */
export async function decryptJsonEnvelope(roomKeyHex, envelope) {
    const key = await importAesKey(roomKeyHex)
    const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: hexToBytes(envelope.ivHex) },
        key,
        hexToBytes(envelope.cipherHex),
    )
    return JSON.parse(decoder.decode(new Uint8Array(plain)))
}

/**
 * @param {string} roomId
 */
function keySlot(roomId) {
    return `secure-room-key:${roomId}`
}

/**
 * @param {string} roomId
 * @param {string} roomKeyHex
 */
export function persistRoomKey(roomId, roomKeyHex) {
    if (typeof window === "undefined") return
    sessionStorage.setItem(keySlot(roomId), roomKeyHex)
}

/**
 * @param {string} roomId
 */
export function readRoomKey(roomId) {
    if (typeof window === "undefined") return ""
    return sessionStorage.getItem(keySlot(roomId)) || ""
}

/**
 * @param {string} roomId
 */
export function clearRoomKey(roomId) {
    if (typeof window === "undefined") return
    sessionStorage.removeItem(keySlot(roomId))
}

