import { redis } from '@/lib/redis'
import { Elysia, t } from 'elysia'
import { nanoid } from 'nanoid'
import { authMiddleware } from './auth'
import z from 'zod'
import { realtime } from '@/lib/realtime'
import { createUser, authenticateUser, authenticateGoogleUser, createSession, getUserFromSession, deleteSession, addRoomToUser, getUserRooms, checkUsernameAvailable, updateUsername, updateAvatar } from '@/lib/auth-store'
import { timingSafeEqual } from 'node:crypto'

const DEFAULT_TTL_MINUTES = 10
const MIN_TTL_MINUTES = 0  // 0 = permanent (no expiry)
const MAX_TTL_MINUTES = 60
const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 10
const PERMANENT_ROOMS_KEY = "rooms:permanent"
const GOOGLE_STATE_COOKIE = "x-google-oauth-state"
const ROOM_LIFECYCLE_STREAM_TTL_SECONDS = 120
const SECURE_ROOM_TTL_SECONDS = 60 * 60
const SECURE_STREAM_MAXLEN = 50
const SECURE_ROOM_COOKIE_PREFIX = "room-secure-"
const GUEST_PARTICIPANT_COOKIE = "x-participant-id"
const ENV = /** @type {Record<string, string | undefined>} */ ((/** @type {any} */ (globalThis)).process?.env ?? {})
const GOOGLE_OAUTH_AUTHORIZE_URL = ENV.GOOGLE_OAUTH_AUTHORIZE_URL || "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_OAUTH_TOKEN_URL = ENV.GOOGLE_OAUTH_TOKEN_URL || "https://oauth2.googleapis.com/token"
const GOOGLE_OAUTH_USERINFO_URL = ENV.GOOGLE_OAUTH_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo"

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/

const createRoomSchema = z.object({
    maxParticipants: z.number().int().min(MIN_PARTICIPANTS).max(MAX_PARTICIPANTS).default(MIN_PARTICIPANTS),
    password: z.string().min(8).max(128).regex(PASSWORD_REGEX, {
        message: "Password must contain at least 1 uppercase, 1 lowercase, 1 digit, and 1 special character"
    }).optional(),
    panicPassword: z.string().min(4).max(128).optional(),
    ttlMinutes: z.number().int().min(MIN_TTL_MINUTES).max(MAX_TTL_MINUTES).default(DEFAULT_TTL_MINUTES),
    securityQuestion: z.string().max(500).optional(),
    securityAnswer: z.string().max(500).optional(),
}).refine(
    (data) => !data.securityQuestion || data.securityAnswer,
    { message: "Security answer is required when a security question is set" }
).refine(
    (data) => !data.panicPassword || !data.password || data.panicPassword !== data.password,
    { message: "Panic password must be different from room password" }
)

const verifyRoomSchema = z.object({
    roomId: z.string(),
    password: z.string().optional(),
    securityAnswer: z.string().optional(),
})

const createSecureRoomSchema = z.object({
    securityQuestion: z.string().min(1).max(500),
    roomSaltHex: z.string().regex(/^[0-9a-fA-F]{16,256}$/),
    kdfIterations: z.number().int().min(100_000).max(500_000).default(100_000),
    gatekeeperVerifierHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
    maxParticipants: z.number().int().min(MIN_PARTICIPANTS).max(MAX_PARTICIPANTS).default(MIN_PARTICIPANTS),
})

const verifyProofSchema = z.object({
    roomId: z.string().min(1).max(128),
    proofHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
})

const encryptedEnvelopeSchema = z.object({
    v: z.literal(1),
    kind: z.enum(["text", "stego.notice", "stego.payload"]),
    ivHex: z.string().regex(/^[0-9a-fA-F]{24}$/),
    cipherHex: z.string().regex(/^[0-9a-fA-F]+$/).max(1_500_000),
    aadHex: z.string().regex(/^[0-9a-fA-F]*$/).optional(),
    createdAt: z.number().int(),
}).refine((value) => value.cipherHex.length % 2 === 0, {
    message: "cipherHex must be even-length hex",
    path: ["cipherHex"],
})

const encryptedMessageSchema = z.object({
    roomId: z.string().optional(),
    envelope: encryptedEnvelopeSchema,
})

/** @param {unknown} value */
function asString(value) {
    return typeof value === "string" ? value : undefined
}

/** @param {unknown} value */
function parseStringArray(value) {
    if (!Array.isArray(value)) return []
    return value.filter((item) => typeof item === "string")
}

/** @param {unknown} rawValue */
function parseConnectedTokens(rawValue) {
    if (Array.isArray(rawValue)) return parseStringArray(rawValue)
    if (typeof rawValue !== "string") return []
    try {
        const parsed = JSON.parse(rawValue)
        return parseStringArray(parsed)
    } catch {
        return []
    }
}

/** @param {unknown} rawValue */
function parseParticipantIdentityMap(rawValue) {
    if (typeof rawValue !== "string") return {}
    try {
        const parsed = JSON.parse(rawValue)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
        return Object.fromEntries(
            Object.entries(parsed).filter(([key, value]) => typeof key === "string" && typeof value === "string")
        )
    } catch {
        return {}
    }
}

/** @param {unknown} rawValue */
function parseRevokedParticipants(rawValue) {
    if (typeof rawValue !== "string") return new Set()
    try {
        const parsed = JSON.parse(rawValue)
        return new Set(parseStringArray(parsed))
    } catch {
        return new Set()
    }
}

/** @param {Record<string, any>} cookie */
function getParticipantIdentityKey(cookie) {
    const sessionId = asString(cookie?.["x-session"]?.value)
    if (sessionId) return `session:${sessionId}`
    const guestId = asString(cookie?.["x-participant-id"]?.value)
    if (guestId) return `guest:${guestId}`
    return undefined
}

/** @param {string} roomId */
function secureMetaKey(roomId) {
    return `meta:${roomId}:secure`
}

/** @param {string} roomId */
function secureMessageStreamKey(roomId) {
    return `stream:room:${roomId}:msg`
}

/** @param {string} roomId */
function secureSignalStreamKey(roomId) {
    return `stream:room:${roomId}:signal`
}

/**
 * @param {string} roomId
 */
function secureRoomCookieName(roomId) {
    return `${SECURE_ROOM_COOKIE_PREFIX}${roomId}`
}

/**
 * @param {string} value
 */
function normalizeHex(value) {
    return value.trim().toLowerCase()
}

/**
 * Constant-time hex equality check.
 * @param {string} expectedHex
 * @param {string} receivedHex
 */
function timingSafeHexEquals(expectedHex, receivedHex) {
    const a = normalizeHex(expectedHex)
    const b = normalizeHex(receivedHex)
    if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b) || a.length !== b.length || a.length % 2 !== 0) {
        return false
    }
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
}

function buildSecureCookieOptions() {
    return {
        path: "/",
        httpOnly: true,
        secure: ENV.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: SECURE_ROOM_TTL_SECONDS,
    }
}

/**
 * @param {Record<string, any>} cookie
 */
function getOrCreateParticipantIdentity(cookie) {
    const sessionId = asString(cookie?.["x-session"]?.value)
    if (sessionId) {
        return { identityKey: `session:${sessionId}`, guestId: "", shouldSetGuestCookie: false }
    }
    const existingGuestId = asString(cookie?.[GUEST_PARTICIPANT_COOKIE]?.value)
    if (existingGuestId) {
        return { identityKey: `guest:${existingGuestId}`, guestId: existingGuestId, shouldSetGuestCookie: false }
    }
    const guestId = nanoid(16)
    return { identityKey: `guest:${guestId}`, guestId, shouldSetGuestCookie: true }
}

/**
 * @param {Record<string, any>} cookie
 * @param {string} roomId
 * @param {string} token
 */
function setSecureRoomTokenCookies(cookie, roomId, token) {
    const options = buildSecureCookieOptions()
    cookie[secureRoomCookieName(roomId)].set({ value: token, ...options })
    cookie["x-auth-token"].set({ value: token, ...options })
}

/**
 * @param {Record<string, any>} cookie
 * @param {string} roomId
 */
function clearSecureRoomTokenCookie(cookie, roomId) {
    cookie[secureRoomCookieName(roomId)].set({
        value: "",
        path: "/",
        maxAge: 0,
    })
}

/**
 * Keep secure keys aligned to secure room lifetime.
 * @param {string} roomId
 * @param {string[]} keys
 */
async function syncSecureKeyExpiry(roomId, keys) {
    const ttl = await redis.ttl(secureMetaKey(roomId))
    if (ttl > 0) {
        await Promise.all(keys.map((key) => redis.expire(key, ttl)))
        return ttl
    }
    if (ttl === -1) {
        await Promise.all(keys.map((key) => redis.expire(key, SECURE_ROOM_TTL_SECONDS)))
        return SECURE_ROOM_TTL_SECONDS
    }
    return ttl
}

/**
 * @param {string} roomId
 * @param {string} streamKey
 * @param {Record<string, unknown>} entries
 */
async function appendSecureStream(roomId, streamKey, entries) {
    const streamId = await redis.xadd(streamKey, "*", entries, {
        trim: {
            type: "MAXLEN",
            threshold: SECURE_STREAM_MAXLEN,
            comparison: "=",
        },
    })
    await syncSecureKeyExpiry(roomId, [secureMetaKey(roomId), streamKey, secureMessageStreamKey(roomId), secureSignalStreamKey(roomId)])
    return streamId
}

/** @param {string} requestUrl */
function getRequestOrigin(requestUrl) {
    return new URL(requestUrl).origin
}

/** @param {string} requestUrl */
function getGoogleRedirectUri(requestUrl) {
    const envRedirect = ENV.GOOGLE_REDIRECT_URI
    if (envRedirect) return envRedirect
    return `${getRequestOrigin(requestUrl)}/api/auth/google/callback`
}

/**
 * @param {string} target
 * @param {string} requestUrl
 */
function toAbsoluteRedirectUrl(target, requestUrl) {
    try {
        return new URL(target).toString()
    } catch {
        return new URL(target, getRequestOrigin(requestUrl)).toString()
    }
}

/**
 * @param {string} target
 * @param {string} requestUrl
 * @param {number} [status]
 */
function redirectResponse(target, requestUrl, status = 302) {
    return Response.redirect(toAbsoluteRedirectUrl(target, requestUrl), status)
}

/**
 * Align the room stream key TTL with the room metadata TTL.
 * If metadata already disappeared, optionally apply a short fallback TTL.
 * @param {string} roomId
 * @param {number} [fallbackTtlSeconds]
 */
async function syncRoomStreamExpiry(roomId, fallbackTtlSeconds) {
    const roomTtl = await redis.ttl(`meta:${roomId}`)
    if (roomTtl > 0) {
        await redis.expire(roomId, roomTtl)
        return roomTtl
    }

    if (roomTtl === -2 && typeof fallbackTtlSeconds === "number" && fallbackTtlSeconds > 0) {
        await redis.expire(roomId, fallbackTtlSeconds)
        return fallbackTtlSeconds
    }

    return roomTtl
}

/**
 * Emit a lifecycle event and force a short TTL on the room stream key.
 * This prevents stale room stream keys from lingering forever after destroy/panic.
 * @param {string} roomId
 * @param {string} event
 * @param {Record<string, any>} data
 */
async function emitLifecycleEventWithStreamExpiry(roomId, event, data) {
    await realtime.channel(roomId).emit(/** @type {any} */(event), data)
    await syncRoomStreamExpiry(roomId, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)
}

/**
 * @param {string} roomId
 */
async function getRoomMode(roomId) {
    const [secureMeta, legacyMeta] = await Promise.all([
        redis.hgetall(secureMetaKey(roomId)),
        redis.hgetall(`meta:${roomId}`),
    ])
    if (secureMeta && Object.keys(secureMeta).length > 0) {
        return { mode: "secure", meta: secureMeta, metaKey: secureMetaKey(roomId) }
    }
    if (legacyMeta && Object.keys(legacyMeta).length > 0) {
        return { mode: "legacy", meta: legacyMeta, metaKey: `meta:${roomId}` }
    }
    return { mode: "missing", meta: null, metaKey: "" }
}

/**
 * @param {string} roomId
 * @param {string} [reason]
 */
async function nukeRoom(roomId, reason = "destroy") {
    await Promise.all([
        redis.del(roomId),
        redis.del(`meta:${roomId}`),
        redis.del(secureMetaKey(roomId)),
        redis.del(`messages:${roomId}`),
        redis.del(`history:${roomId}`),
        redis.del(secureMessageStreamKey(roomId)),
        redis.del(secureSignalStreamKey(roomId)),
        redis.zrem(PERMANENT_ROOMS_KEY, roomId),
    ])

    await realtime.channel(roomId).emit("chat.self_destruct", {
        roomId,
        reason,
        timestamp: Date.now(),
    })
    await realtime.channel(roomId).emit("chat.destroy", { isDestroyed: true })
}

/**
 * @param {Record<string, any>} cookie
 * @param {string} sessionId
 */
function setSessionCookie(cookie, sessionId) {
    cookie["x-session"].set({
        value: sessionId,
        path: "/",
        httpOnly: true,
        secure: ENV.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60,
    })
}

/** @param {Record<string, any>} cookie */
function clearSessionCookie(cookie) {
    cookie["x-session"].set({
        value: "",
        path: "/",
        maxAge: 0,
    })
}

const rooms = new Elysia({ prefix: "/room" })
    .post("/create", async ({ body }) => {
        const config = createRoomSchema.parse(body ?? {})
        const roomId = nanoid()
        const createdAt = Date.now()
        const ttlSeconds = config.ttlMinutes * 60

        /** @type {Record<string, string | number>} */
        const meta = {
            connected: JSON.stringify([]),
            createdAt,
            maxParticipants: config.maxParticipants,
            ttlMinutes: config.ttlMinutes,
        }

        if (config.password) meta.password = config.password
        if (config.panicPassword) meta.panicPassword = config.panicPassword
        if (config.securityQuestion) meta.securityQuestion = config.securityQuestion
        if (config.securityAnswer) meta.securityAnswer = config.securityAnswer.toLowerCase().trim()

        await redis.hset(`meta:${roomId}`, meta)

        // ttlMinutes = 0 means permanent room (no expiry)
        if (ttlSeconds > 0) {
            await redis.expire(`meta:${roomId}`, ttlSeconds)
        } else {
            await redis.zadd(PERMANENT_ROOMS_KEY, { score: createdAt, member: roomId })
        }

        return { roomId }
    })
    .get("/ttl", async ({ query }) => {
        const { roomId } = query
        if (!roomId) return { ttl: -1 }

        const mode = await getRoomMode(roomId)
        if (mode.mode === "missing") return { ttl: -2 }

        if (mode.mode === "secure") {
            return { ttl: await redis.ttl(secureMetaKey(roomId)), secure: true }
        }
        return { ttl: await redis.ttl(`meta:${roomId}`), secure: false }
    })
    .get("/info", async ({ query }) => {
        const roomId = query.roomId
        if (!roomId) return { exists: false }

        const mode = await getRoomMode(roomId)
        if (mode.mode === "missing" || !mode.meta) return { exists: false }

        if (mode.mode === "secure") {
            return {
                exists: true,
                secure: true,
                securityQuestion: mode.meta.securityQuestion || null,
                roomSaltHex: mode.meta.roomSaltHex || null,
                kdfIterations: Number(mode.meta.kdfIterations || 100_000),
                maxParticipants: Number(mode.meta.maxParticipants || MIN_PARTICIPANTS),
                hasPassword: false,
            }
        }

        const meta = mode.meta
        return {
            exists: true,
            secure: false,
            hasPassword: !!meta.password,
            securityQuestion: meta.securityQuestion || null,
        }
    })
    .post("/create-secure", async ({ body, set }) => {
        const config = createSecureRoomSchema.parse(body ?? {})
        const roomId = nanoid()
        const createdAt = Date.now()
        const expiresAt = createdAt + SECURE_ROOM_TTL_SECONDS * 1000
        const verifierHex = normalizeHex(config.gatekeeperVerifierHex)
        const saltHex = normalizeHex(config.roomSaltHex)

        await redis.hset(secureMetaKey(roomId), {
            mode: "secure-v2",
            connected: JSON.stringify([]),
            participants: JSON.stringify({}),
            revokedParticipants: JSON.stringify([]),
            createdAt,
            expiresAt,
            maxParticipants: config.maxParticipants,
            securityQuestion: config.securityQuestion.trim(),
            roomSaltHex: saltHex,
            kdfIterations: config.kdfIterations,
            gatekeeperVerifierHex: verifierHex,
        })
        await redis.expire(secureMetaKey(roomId), SECURE_ROOM_TTL_SECONDS)

        set.status = 201
        return { roomId, expiresAt, ttlSeconds: SECURE_ROOM_TTL_SECONDS }
    })
    .post("/verify-proof", async ({ body, cookie, set }) => {
        const { roomId, proofHex } = verifyProofSchema.parse(body ?? {})
        const meta = await redis.hgetall(secureMetaKey(roomId))
        if (!meta || Object.keys(meta).length === 0) {
            set.status = 404
            return { error: "Secure room not found" }
        }

        if (!timingSafeHexEquals(asString(meta.gatekeeperVerifierHex) || "", proofHex)) {
            set.status = 403
            return { error: "Invalid proof" }
        }

        const { identityKey, guestId, shouldSetGuestCookie } = getOrCreateParticipantIdentity(cookie)
        const connected = parseConnectedTokens(meta.connected)
        const participants = parseParticipantIdentityMap(meta.participants)
        const revokedParticipants = parseRevokedParticipants(meta.revokedParticipants)

        if (revokedParticipants.has(identityKey)) {
            set.status = 403
            return { error: "Room access denied" }
        }

        const maxParticipants = parseInt(`${meta.maxParticipants ?? ""}`, 10) || MIN_PARTICIPANTS
        let joinToken = participants[identityKey]

        if (!joinToken && connected.length >= maxParticipants) {
            set.status = 403
            return { error: "Room is full" }
        }
        if (!joinToken) {
            joinToken = nanoid()
        }

        const nextConnected = connected.includes(joinToken) ? connected : [...connected, joinToken]
        const nextParticipants = {
            ...participants,
            [identityKey]: joinToken,
        }

        /** @type {Record<string, string>} */
        const updates = {
            connected: JSON.stringify(nextConnected),
            participants: JSON.stringify(nextParticipants),
        }
        if (!asString(meta.creatorToken)) {
            updates.creatorToken = joinToken
        }

        await redis.hset(secureMetaKey(roomId), updates)
        await syncSecureKeyExpiry(roomId, [secureMetaKey(roomId), secureMessageStreamKey(roomId), secureSignalStreamKey(roomId)])
        setSecureRoomTokenCookies(cookie, roomId, joinToken)

        if (shouldSetGuestCookie) {
            cookie[GUEST_PARTICIPANT_COOKIE].set({
                value: guestId,
                path: "/",
                httpOnly: true,
                secure: ENV.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 30 * 24 * 60 * 60,
            })
        }

        return { ok: true, joinToken, expiresAt: Number(meta.expiresAt || Date.now() + SECURE_ROOM_TTL_SECONDS * 1000) }
    })
    .post("/verify", async ({ body, set }) => {
        const { roomId, password, securityAnswer } = verifyRoomSchema.parse(body)

        const secureMeta = await redis.hgetall(secureMetaKey(roomId))
        if (secureMeta && Object.keys(secureMeta).length > 0) {
            set.status = 400
            return { error: "Use /api/room/verify-proof for secure rooms" }
        }

        const meta = await redis.hgetall(`meta:${roomId}`)
        if (!meta || Object.keys(meta).length === 0) {
            set.status = 404
            return { error: "Room not found" }
        }

        if (meta.password && meta.password !== password) {
            set.status = 403
            return { error: "Incorrect password" }
        }

        if (meta.securityAnswer && meta.securityAnswer !== securityAnswer?.toLowerCase()?.trim()) {
            set.status = 403
            return { error: "Incorrect security answer" }
        }

        return { success: true }
    })
    .use(authMiddleware)
    .post("/exit", async ({ auth, cookie, set }) => {
        const meta = await redis.hgetall(auth.metaKey)
        if (!meta || Object.keys(meta).length === 0) {
            set.status = 404
            return { error: "Room not found" }
        }

        const creatorToken = asString(meta.creatorToken)
        if (creatorToken && creatorToken === auth.token) {
            set.status = 403
            return { error: "Room creator cannot exit this room" }
        }

        const connected = parseConnectedTokens(meta.connected)
        const participants = parseParticipantIdentityMap(meta.participants)
        const revokedParticipants = parseRevokedParticipants(meta.revokedParticipants)
        const identityKey = getParticipantIdentityKey(cookie)
        const sessionId = asString(cookie?.["x-session"]?.value)

        const nextConnected = connected.filter((token) => token !== auth.token)
        const nextParticipants = Object.fromEntries(
            Object.entries(participants).filter(([, token]) => token !== auth.token)
        )
        if (identityKey) {
            revokedParticipants.add(identityKey)
            delete nextParticipants[identityKey]
        }

        await redis.hset(auth.metaKey, {
            connected: JSON.stringify(nextConnected),
            participants: JSON.stringify(nextParticipants),
            revokedParticipants: JSON.stringify(Array.from(revokedParticipants)),
        })

        if (sessionId) {
            const user = await getUserFromSession(sessionId)
            if (user?.userId) {
                await redis.zrem(`user:${user.userId}:rooms`, auth.roomId)
            }
        }

        cookie["x-auth-token"].set({
            value: "",
            path: "/",
            maxAge: 0,
        })
        if (auth.isSecure) {
            clearSecureRoomTokenCookie(cookie, auth.roomId)
        }

        return { success: true }
    }, { query: t.Object({ roomId: t.String() }) })
    .get("/role", async ({ auth }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        return { role: creatorToken === auth.token ? "creator" : "member" }
    }, { query: t.Object({ roomId: t.String() }) })
    .delete("/", async ({ auth, set }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        if (creatorToken !== auth.token) {
            set.status = 403
            return { error: "Only the room creator can destroy the room" }
        }

        if (auth.isSecure) {
            await nukeRoom(auth.roomId, "destroy")
        } else {
            await Promise.all([
                redis.del(auth.roomId),
                redis.del(`meta:${auth.roomId}`),
                redis.del(`messages:${auth.roomId}`),
                redis.zrem(PERMANENT_ROOMS_KEY, auth.roomId),
            ])
            await emitLifecycleEventWithStreamExpiry(auth.roomId, "chat.destroy", { isDestroyed: true })
        }

        return { success: true }
    }, {
        query: t.Object({
            roomId: t.String()
        })
    })
    .post("/request-destroy", async ({ auth, body, set }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        if (creatorToken === auth.token) {
            set.status = 400
            return { error: "Creator can destroy directly" }
        }

        const { requesterId, requesterName } = z.object({
            requesterId: z.string().min(1).max(128),
            requesterName: z.string().min(1).max(64).optional(),
        }).parse(body ?? {})

        await realtime.channel(auth.roomId).emit("chat.destroy-request", {
            requestedBy: auth.token,
            requesterId,
            requesterName: requesterName || "a participant",
        })
        if (auth.isSecure) {
            await appendSecureStream(auth.roomId, secureSignalStreamKey(auth.roomId), {
                event: "chat.destroy-request",
                payload: JSON.stringify({
                    requestedBy: auth.token,
                    requesterId,
                    requesterName: requesterName || "a participant",
                    timestamp: Date.now(),
                }),
            })
        } else {
            await syncRoomStreamExpiry(auth.roomId, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)
        }

        return { success: true }
    }, { query: t.Object({ roomId: t.String() }) })
    .post("/approve-destroy", async ({ auth, set }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        if (creatorToken !== auth.token) {
            set.status = 403
            return { error: "Only the room creator can approve destruction" }
        }

        if (auth.isSecure) {
            await nukeRoom(auth.roomId, "destroy-approved")
        } else {
            await Promise.all([
                redis.del(auth.roomId),
                redis.del(`meta:${auth.roomId}`),
                redis.del(`messages:${auth.roomId}`),
                redis.zrem(PERMANENT_ROOMS_KEY, auth.roomId),
            ])
            await emitLifecycleEventWithStreamExpiry(auth.roomId, "chat.destroy", { isDestroyed: true })
        }

        return { success: true }
    }, { query: t.Object({ roomId: t.String() }) })
    .post("/deny-destroy", async ({ auth, body, set }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        if (creatorToken !== auth.token) {
            set.status = 403
            return { error: "Only the room creator can deny destruction" }
        }

        const { requesterId } = z.object({
            requesterId: z.string().min(1).max(128),
        }).parse(body ?? {})

        await realtime.channel(auth.roomId).emit("chat.destroy-denied", {
            denied: true,
            requesterId,
        })
        if (auth.isSecure) {
            await appendSecureStream(auth.roomId, secureSignalStreamKey(auth.roomId), {
                event: "chat.destroy-denied",
                payload: JSON.stringify({
                    denied: true,
                    requesterId,
                    timestamp: Date.now(),
                }),
            })
        } else {
            await syncRoomStreamExpiry(auth.roomId, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)
        }

        return { success: true }
    }, { query: t.Object({ roomId: t.String() }) })
    .post("/extend-timer", async ({ body, auth, set }) => {
        const creatorToken = await redis.hget(auth.metaKey, "creatorToken")
        if (creatorToken !== auth.token) {
            set.status = 403
            return { error: "Only the room creator can extend the timer" }
        }
        if (auth.isSecure) {
            set.status = 400
            return { error: "Secure rooms have a fixed 1-hour TTL and cannot be extended" }
        }

        const { minutes } = z.object({ minutes: z.number().int().min(1).max(60) }).parse(body)
        const currentTtl = await redis.ttl(auth.metaKey)

        // If room is permanent (ttl = -1), can't extend
        if (currentTtl === -1) {
            set.status = 400
            return { error: "Permanent rooms don't have a timer to extend" }
        }

        const newTtl = Math.max(currentTtl, 0) + minutes * 60
        const keys = [auth.metaKey, `messages:${auth.roomId}`, `history:${auth.roomId}`, auth.roomId]
        await Promise.all(keys.map(k => redis.expire(k, newTtl)))

        await realtime.channel(auth.roomId).emit("chat.timer-extended", { newTtl })
        await syncRoomStreamExpiry(auth.roomId, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)

        return { success: true, newTtl }
    }, { query: t.Object({ roomId: t.String() }) })
    .post("/panic", async ({ body, auth, set }) => {
        if (auth.isSecure) {
            set.status = 403
            return { error: "Panic password is not available in secure mode" }
        }
        const { panicPassword } = z.object({ panicPassword: z.string() }).parse(body)
        const storedPanic = await redis.hget(auth.metaKey, "panicPassword")

        if (!storedPanic) {
            set.status = 400
            return { error: "This room has no panic password configured" }
        }

        if (storedPanic !== panicPassword) {
            set.status = 403
            return { error: "Incorrect panic password" }
        }

        // Destroy everything silently
        const roomId = auth.roomId
        await Promise.all([
            redis.del(roomId),
            redis.del(`meta:${roomId}`),
            redis.del(`messages:${roomId}`),
            redis.zrem(PERMANENT_ROOMS_KEY, roomId),
        ])

        await emitLifecycleEventWithStreamExpiry(roomId, "chat.panic", { triggered: true })

        return { success: true }
    }, { query: t.Object({ roomId: t.String() }) })

const bodySchema = z.object({
    sender: z.string().max(1_000_000),
    text: z.string().max(1_000_000),
    vanishAfter: z.number().int().min(5).max(300).optional(),
    type: z.enum(["text", "stego", "audio"]).default("text"),
})

const messages = new Elysia({ prefix: "/messages" })
    .use(authMiddleware)
    .post("/", async ({ body, auth, set }) => {
        if (auth.isSecure) {
            set.status = 400
            return { error: "Use /api/messages/encrypted for secure rooms" }
        }
        const { sender, text, vanishAfter, type } = bodySchema.parse(body)
        const { roomId } = auth

        const roomExists = await redis.exists(auth.metaKey)

        if (!roomExists)
            throw new Error("Room does not exist.")

        const message = {
            id: nanoid(),
            sender,
            text,
            timestamp: Date.now(),
            roomId,
            ...(vanishAfter ? { vanishAfter } : {}),
            ...(type !== "text" ? { type } : {}),
        }

        // Now we have the message that has been sent in the memory 
        // So we then add this message to the chat history to view it
        await redis.rpush(`messages:${roomId}`, {
            ...message,
            token: auth.token,
        })

        await realtime.channel(roomId).emit("chat.message", message)

        // Expiration of the room (skip for permanent rooms)
        const remTime = await redis.ttl(`meta:${roomId}`)
        if (remTime > 0) {
            await redis.expire(`messages:${roomId}`, remTime)
            await redis.expire(`history:${roomId}`, remTime)
        }
        await syncRoomStreamExpiry(roomId, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)

        return { success: true }
    })
    .post("/encrypted", async ({ body, auth, set }) => {
        if (!auth.isSecure) {
            set.status = 400
            return { error: "Encrypted envelopes are only supported in secure rooms" }
        }

        const payload = encryptedMessageSchema.parse(body ?? {})
        if (payload.roomId && payload.roomId !== auth.roomId) {
            set.status = 400
            return { error: "roomId mismatch" }
        }

        const secureMeta = await redis.hgetall(auth.metaKey)
        if (!secureMeta || Object.keys(secureMeta).length === 0) {
            set.status = 404
            return { error: "Secure room not found" }
        }

        const messageId = nanoid()
        const acceptedAt = Date.now()

        await appendSecureStream(auth.roomId, secureMessageStreamKey(auth.roomId), {
            id: messageId,
            senderToken: auth.token,
            acceptedAt,
            envelope: JSON.stringify(payload.envelope),
        })

        await realtime.channel(auth.roomId).emit("chat.encrypted", {
            id: messageId,
            roomId: auth.roomId,
            envelope: payload.envelope,
            timestamp: acceptedAt,
        })

        return { id: messageId, acceptedAt }
    }, { query: t.Object({ roomId: t.String() }) })
    .get("/", async ({ auth }) => {
        if (auth.isSecure) {
            return { secure: true, messages: [] }
        }
        const messages = await redis.lrange(`messages:${auth.roomId}`, 0, -1)

        return {
            messages: messages.map((raw) => {
                const m = typeof raw === 'string' ? JSON.parse(raw) : raw
                return {
                    ...m,
                    token: m.token === auth.token ? auth.token : undefined
                }
            })
        }
    }, { query: t.Object({ roomId: t.String() }) })
    .get("/participants", async ({ auth }) => {
        if (auth.isSecure) {
            return { participants: [] }
        }
        const rawMessages = await redis.lrange(`messages:${auth.roomId}`, 0, -1)
        const senders = new Set()
        for (const raw of rawMessages) {
            const m = typeof raw === "string" ? JSON.parse(raw) : raw
            if (typeof m?.sender === "string" && m.sender.length > 0) {
                senders.add(m.sender)
            }
        }
        return { participants: Array.from(senders) }
    }, { query: t.Object({ roomId: t.String() }) })



class AuthError extends Error {
    constructor(message = "Unauthorized") {
        super(message)
        this.name = "AuthError"
    }
}

const auth = new Elysia({ prefix: "/auth" })
    .post("/signup", async ({ body, set, cookie }) => {
        const { username, email, password } = z.object({
            username: z.string().min(3).max(30),
            email: z.email(),
            password: z.string().min(8).max(128),
        }).parse(body)
        const normalizedUsername = username.trim()

        const result = await createUser({ username, email, password })
        if (!result.success) {
            set.status = 400
            return { error: result.error }
        }

        const sessionId = await createSession(result.userId, normalizedUsername)
        setSessionCookie(cookie, sessionId)

        return { success: true, username: normalizedUsername }
    })
    .post("/login", async ({ body, set, cookie }) => {
        const { email, password } = z.object({
            email: z.email(),
            password: z.string(),
        }).parse(body)

        const result = await authenticateUser({ email, password })
        if (!result.success) {
            set.status = 401
            return { error: result.error }
        }

        const sessionId = await createSession(result.userId, result.username)
        setSessionCookie(cookie, sessionId)

        return { success: true, username: result.username }
    })
    .get("/google", async ({ cookie, request }) => {
        try {
            const clientId = ENV.GOOGLE_CLIENT_ID || ENV.NEXT_PUBLIC_GOOGLE_CLIENT_ID
            if (!clientId) {
                return redirectResponse("/auth?google=config", request.url)
            }

            const state = nanoid(24)
            cookie[GOOGLE_STATE_COOKIE].set({
                value: state,
                path: "/",
                httpOnly: true,
                secure: ENV.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 10 * 60,
            })

            const redirectUri = getGoogleRedirectUri(request.url)
            const params = new URLSearchParams({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: "code",
                scope: "openid email profile",
                prompt: "select_account",
                state,
            })

            return redirectResponse(`${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`, request.url)
        } catch (error) {
            console.error("[Google OAuth] start failure", error)
            return redirectResponse("/auth?google=oauth_failed", request.url)
        }
    })
    .get("/google/callback", async ({ query, cookie, request }) => {
        const code = asString(query.code)
        const state = asString(query.state)
        const expectedState = /** @type {string | undefined} */ (cookie?.[GOOGLE_STATE_COOKIE]?.value)

        cookie[GOOGLE_STATE_COOKIE].set({
            value: "",
            path: "/",
            httpOnly: true,
            secure: ENV.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 0,
        })

        if (!code || !state || !expectedState || state !== expectedState) {
            return redirectResponse("/auth?google=state_mismatch", request.url)
        }

        const clientId = ENV.GOOGLE_CLIENT_ID || ENV.NEXT_PUBLIC_GOOGLE_CLIENT_ID
        const clientSecret = ENV.GOOGLE_CLIENT_SECRET
        const redirectUri = getGoogleRedirectUri(request.url)
        if (!clientId || !clientSecret) {
            return redirectResponse("/auth?google=config", request.url)
        }

        try {
            const tokenResponse = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: "authorization_code",
                }).toString(),
            })

            if (!tokenResponse.ok) {
                return redirectResponse("/auth?google=oauth_failed", request.url)
            }

            const tokenData = /** @type {any} */ (await tokenResponse.json())
            const accessToken = asString(tokenData?.access_token)
            if (!accessToken) {
                return redirectResponse("/auth?google=oauth_failed", request.url)
            }

            const profileResponse = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            })

            if (!profileResponse.ok) {
                return redirectResponse("/auth?google=profile_failed", request.url)
            }

            const profile = /** @type {any} */ (await profileResponse.json())
            const googleId = asString(profile?.sub)
            const email = asString(profile?.email)
            const name = asString(profile?.name) || asString(profile?.given_name) || undefined
            const emailVerified = profile?.email_verified === true || profile?.email_verified === "true"
            if (!googleId || !email || !emailVerified) {
                return redirectResponse("/auth?google=invalid_profile", request.url)
            }

            const result = await authenticateGoogleUser({ googleId, email, name })
            if (!result.success) {
                return redirectResponse("/auth?google=account_failed", request.url)
            }

            const sessionId = await createSession(result.userId, result.username)
            setSessionCookie(cookie, sessionId)

            return redirectResponse("/", request.url)
        } catch (error) {
            console.error("[Google OAuth] callback failure", error)
            return redirectResponse("/auth?google=oauth_failed", request.url)
        }
    })
    .post("/logout", async ({ cookie }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        if (sessionId) {
            await deleteSession(sessionId)
            clearSessionCookie(cookie)
        }
        return { success: true }
    })
    .get("/me", async ({ cookie }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) return { authenticated: false }
        // Fetch avatar from user data
        const userData = await redis.hgetall(`user:${user.userId}`)
        return { authenticated: true, username: user.username, userId: user.userId, avatar: userData?.avatar || null }
    })
    .get("/check-username", async ({ query }) => {
        const username = typeof query?.username === "string" ? query.username.trim() : ""
        if (!username || username.length < 3 || username.length > 30) {
            return { available: false }
        }
        const available = await checkUsernameAvailable(username)
        return { available }
    })
    .post("/update-username", async ({ body, cookie, set }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) { set.status = 401; return { error: "Not authenticated" } }

        const { username: newUsername } = z.object({ username: z.string().min(3).max(30) }).parse(body)
        const result = await updateUsername(user.userId, user.username, newUsername)
        if (!result.success) { set.status = 400; return { error: result.error } }

        // Update current session with new username
        await redis.hset(`session:${sessionId}`, { username: newUsername.trim() })
        return { success: true, username: newUsername.trim() }
    })
    .post("/update-avatar", async ({ body, cookie, set }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) { set.status = 401; return { error: "Not authenticated" } }

        const { avatar } = z.object({ avatar: z.string().max(700_000) }).parse(body)
        const result = await updateAvatar(user.userId, avatar)
        if (!result.success) { set.status = 400; return { error: result.error } }

        return { success: true }
    })
    .get("/rooms", async ({ cookie, set }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) {
            set.status = 401
            return { error: "Not authenticated" }
        }

        const roomIds = await getUserRooms(user.userId)
        // Fetch metadata for each room to check if it still exists
        const rooms = []
        for (const roomId of roomIds) {
            const meta = await redis.hgetall(`meta:${roomId}`)
            if (meta && Object.keys(meta).length > 0) {
                rooms.push({
                    roomId,
                    createdAt: meta.createdAt,
                    maxParticipants: meta.maxParticipants,
                    hasPassword: !!meta.password,
                })
            }
        }
        return { rooms }
    })
    .get("/permanent-rooms", async ({ cookie, set }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) {
            set.status = 401
            return { error: "Not authenticated" }
        }

        const roomIds = await getUserRooms(user.userId)
        const rooms = []
        const staleTrackedRoomIds = []
        const staleGlobalRoomIds = []

        for (const roomId of roomIds) {
            const meta = await redis.hgetall(`meta:${roomId}`)
            if (!meta || Object.keys(meta).length === 0) {
                staleTrackedRoomIds.push(roomId)
                staleGlobalRoomIds.push(roomId)
                continue
            }
            if (`${meta.ttlMinutes}` !== "0") {
                staleTrackedRoomIds.push(roomId)
                continue
            }

            rooms.push({
                roomId,
                createdAt: meta.createdAt,
                maxParticipants: meta.maxParticipants,
                hasPassword: !!meta.password,
            })
        }

        if (staleTrackedRoomIds.length > 0) {
            await Promise.all(staleTrackedRoomIds.map((roomId) => redis.zrem(`user:${user.userId}:rooms`, roomId)))
        }
        if (staleGlobalRoomIds.length > 0) {
            await Promise.all(staleGlobalRoomIds.map((roomId) => redis.zrem(PERMANENT_ROOMS_KEY, roomId)))
        }

        return { rooms }
    })
    .post("/track-room", async ({ body, cookie, set }) => {
        const sessionId = /** @type {string | undefined} */ (cookie?.["x-session"]?.value)
        const user = await getUserFromSession(sessionId)
        if (!user) {
            set.status = 401
            return { error: "Not authenticated" }
        }
        const { roomId } = z.object({ roomId: z.string() }).parse(body)
        await addRoomToUser(user.userId, roomId)
        return { success: true }
    })

const signaling = new Elysia({ prefix: "/realtime" })
    .post("/emit", async ({ body, set }) => {
        const { channel, event, data } = z.object({
            channel: z.string(),
            event: z.string(),
            data: z.any(),
        }).parse(body)

        const room = await getRoomMode(channel)
        if (room.mode === "missing") {
            set.status = 404
            return { error: "Room not found" }
        }

        // Parse event name into namespace.event format for realtime
        const [ns, ...evParts] = event.split(".")
        const ev = evParts.join(".")
        if (ns && ev) {
            const eventName = `${ns}.${ev}`
            await realtime.channel(channel).emit(/** @type {any} */(eventName), data)
            if (room.mode === "secure") {
                await appendSecureStream(channel, secureSignalStreamKey(channel), {
                    event: eventName,
                    timestamp: Date.now(),
                    payload: JSON.stringify(data),
                })
            } else {
                await syncRoomStreamExpiry(channel, ROOM_LIFECYCLE_STREAM_TTL_SECONDS)
            }
        }

        return { success: true }
    })

export const app = new Elysia({ prefix: '/api' })
    .error({ AuthError })
    .onError(({ code, error, set }) => {
        if (code === "AuthError") {
            set.status = 401
            return { error: "Unauthorized" }
        }
        if (code === "VALIDATION") {
            set.status = 422
            return {
                error: "Validation Error",
                details: JSON.parse(error.message)
            }
        }
        console.error(`[API Error] code=${code}`, error)
    })
    .use(rooms)
    .use(messages)
    .use(auth)
    .use(signaling)

export const GET = app.fetch
export const POST = app.fetch
export const DELETE = app.fetch
