import { redis } from "@/lib/redis"
import Elysia from "elysia"

const SECURE_COOKIE_PREFIX = "room-secure-"

/**
 * @param {unknown} raw
 */
function parseConnected(raw) {
    if (!raw) return []
    if (Array.isArray(raw)) {
        return raw.filter((value) => typeof value === "string")
    }
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []
        } catch {
            return []
        }
    }
    return []
}

class AuthError extends Error {
    constructor(message) {
        super(message)
        this.name = "AuthError"
    }
}

export const authMiddleware = new Elysia({
    name: "auth"
})
    .error({ AuthError })
    .onError(({ code, set }) => {
        if (code === "AuthError") {
            set.status = 401
            return { error: "Unauthorized" }
        }
    })
    .derive({ as: "scoped" }, async ({ query, cookie }) => {
        try {
            const roomId = typeof query?.roomId === "string" ? query.roomId : undefined

            if (!roomId) {
                throw new AuthError("Missing Room ID")
            }

            const secureMetaKey = `meta:${roomId}:secure`
            const secureCookieName = `${SECURE_COOKIE_PREFIX}${roomId}`

            const [secureRaw, legacyRaw] = await Promise.all([
                redis.hget(secureMetaKey, "connected"),
                redis.hget(`meta:${roomId}`, "connected"),
            ])

            const isSecure = Boolean(secureRaw)
            const metaKey = isSecure ? secureMetaKey : `meta:${roomId}`
            const raw = secureRaw || legacyRaw
            const token = isSecure
                ? (typeof cookie?.[secureCookieName]?.value === "string"
                    ? cookie[secureCookieName].value
                    : (typeof cookie?.["x-auth-token"]?.value === "string" ? cookie["x-auth-token"].value : undefined))
                : (typeof cookie?.["x-auth-token"]?.value === "string" ? cookie["x-auth-token"].value : undefined)

            if (!raw) {
                throw new AuthError("Room not found or expired")
            }
            if (!token) {
                throw new AuthError("Missing token")
            }

            const connected = parseConnected(raw)

            if (!connected.includes(token)) {
                throw new AuthError("Invalid Token")
            }

            return { auth: { roomId, token, connected, isSecure, metaKey } }
        } catch (e) {
            if (e instanceof AuthError) throw e
            console.error("[Auth] Unexpected error:", e)
            throw new AuthError("Authentication failed")
        }
    })
