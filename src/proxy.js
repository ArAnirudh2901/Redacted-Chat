import { NextResponse } from "next/server"
import { redis } from "./lib/redis"
import { nanoid } from "nanoid"

const ENV = /** @type {Record<string, string | undefined>} */ ((/** @type {any} */ (globalThis)).process?.env ?? {})
const GUEST_PARTICIPANT_COOKIE = "x-participant-id"
const SECURE_ROOM_COOKIE_PREFIX = "room-secure-"

const parseConnectedUsers = (rawValue) => {
    if (Array.isArray(rawValue)) {
        return rawValue.filter((value) => typeof value === "string")
    }

    if (typeof rawValue === "string") {
        try {
            const parsed = JSON.parse(rawValue)
            if (Array.isArray(parsed)) {
                return parsed.filter((value) => typeof value === "string")
            }
        } catch {
            return []
        }
    }

    return []
}

const parseParticipantMap = (rawValue) => {
    if (!rawValue || typeof rawValue !== "string") return {}
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

const parseRevokedParticipantSet = (rawValue) => {
    if (!rawValue || typeof rawValue !== "string") return new Set()
    try {
        const parsed = JSON.parse(rawValue)
        if (!Array.isArray(parsed)) return new Set()
        return new Set(parsed.filter((item) => typeof item === "string"))
    } catch {
        return new Set()
    }
}

export const proxy = async (req) => {

    const pathname = req.nextUrl.pathname
    const roomMatch = pathname.match(/^\/room\/([^/]+)$/)

    if (!roomMatch)
        return NextResponse.redirect(new URL("/", req.url))

    const roomId = roomMatch[1] || ""
    const [legacyMeta, secureMeta] = await Promise.all([
        redis.hgetall(`meta:${roomId}`),
        redis.hgetall(`meta:${roomId}:secure`),
    ])
    const hasLegacyRoom = Boolean(legacyMeta && Object.keys(legacyMeta).length > 0)
    const hasSecureRoom = Boolean(secureMeta && Object.keys(secureMeta).length > 0)

    if (!hasLegacyRoom && !hasSecureRoom) {
        return NextResponse.redirect(new URL("/?error=room-not-found", req.url))
    }

    // Secure-room path: access is granted only after proof verification sets room-secure cookie.
    if (hasSecureRoom) {
        const secureCookieName = `${SECURE_ROOM_COOKIE_PREFIX}${roomId}`
        const secureToken = typeof req.cookies.get(secureCookieName)?.value === "string"
            ? req.cookies.get(secureCookieName).value
            : (typeof req.cookies.get("x-auth-token")?.value === "string" ? req.cookies.get("x-auth-token").value : "")
        const connected = parseConnectedUsers(secureMeta.connected)

        if (!secureToken || !connected.includes(secureToken)) {
            const url = new URL("/?error=room-auth-required", req.url)
            url.searchParams.set("roomId", roomId)
            return NextResponse.redirect(url)
        }

        const cookieOptions = {
            path: "/",
            httpOnly: true,
            secure: ENV.NODE_ENV === "production",
            sameSite: /** @type {"strict"} */ ("strict"),
            maxAge: 60 * 60,
        }
        const response = NextResponse.next()
        if (req.cookies.get("x-auth-token")?.value !== secureToken) {
            response.cookies.set("x-auth-token", secureToken, cookieOptions)
        }
        if (req.cookies.get(secureCookieName)?.value !== secureToken) {
            response.cookies.set(secureCookieName, secureToken, cookieOptions)
        }
        return response
    }

    const meta = legacyMeta

    // Check if the room requires verification (password or security question)
    const hasPassword = !!meta.password
    const hasSecurityQuestion = !!meta.securityQuestion
    const needsVerification = hasPassword || hasSecurityQuestion
    const verifiedCookie = req.cookies.get(`room-verified-${roomId}`)?.value

    if (needsVerification && verifiedCookie !== "true") {
        const url = new URL("/?error=room-auth-required", req.url)
        url.searchParams.set("roomId", roomId)
        return NextResponse.redirect(url)
    }

    const connected = parseConnectedUsers(meta.connected)
    const participants = parseParticipantMap(meta.participants)
    const revokedParticipants = parseRevokedParticipantSet(meta.revokedParticipants)
    const maxParticipantsRaw = typeof meta.maxParticipants === "string"
        ? meta.maxParticipants
        : `${meta.maxParticipants ?? ""}`
    const maxParticipants = parseInt(maxParticipantsRaw, 10) || 2

    const existingToken = typeof req.cookies.get("x-auth-token")?.value === "string"
        ? req.cookies.get("x-auth-token")?.value
        : ""
    const sessionId = typeof req.cookies.get("x-session")?.value === "string"
        ? req.cookies.get("x-session")?.value
        : ""
    let guestParticipantId = typeof req.cookies.get(GUEST_PARTICIPANT_COOKIE)?.value === "string"
        ? req.cookies.get(GUEST_PARTICIPANT_COOKIE)?.value
        : ""
    let shouldSetGuestParticipantCookie = false
    if (!sessionId && !guestParticipantId) {
        guestParticipantId = nanoid(16)
        shouldSetGuestParticipantCookie = true
    }
    const identityKey = sessionId ? `session:${sessionId}` : `guest:${guestParticipantId}`
    const mappedToken = participants[identityKey]

    if (identityKey && revokedParticipants.has(identityKey)) {
        return NextResponse.redirect(new URL("/?error=room-access-denied", req.url))
    }

    const response = NextResponse.next()
    const cookieOptions = {
        path: "/",
        httpOnly: true,
        secure: ENV.NODE_ENV === "production",
        sameSite: /** @type {"strict"} */ ("strict"),
        maxAge: 30 * 24 * 60 * 60,
    }

    if (shouldSetGuestParticipantCookie) {
        response.cookies.set(GUEST_PARTICIPANT_COOKIE, guestParticipantId, cookieOptions)
    }

    // Returning participant: restore previous room token and allow re-entry.
    if (mappedToken && connected.includes(mappedToken)) {
        if (existingToken !== mappedToken) {
            response.cookies.set("x-auth-token", mappedToken, cookieOptions)
        }
        return response
    }

    let token = mappedToken
    if (!token && existingToken && connected.includes(existingToken)) {
        token = existingToken
    }

    if (!token) {
        // New participant path: enforce capacity.
        if (connected.length >= maxParticipants) {
            let canRejoinFromHistory = false
            if (sessionId) {
                const session = await redis.hgetall(`session:${sessionId}`)
                const userId = typeof session?.userId === "string" ? session.userId : ""
                if (userId) {
                    const membershipScore = await redis.zscore(`user:${userId}:rooms`, roomId)
                    canRejoinFromHistory = membershipScore !== null && membershipScore !== undefined
                }
            }

            if (!canRejoinFromHistory) {
                return NextResponse.redirect(new URL("/?error=room-full", req.url))
            }
        }
        token = nanoid()
    }

    // First user to join becomes the room creator
    const isCreator = connected.length === 0
    const nextConnected = connected.includes(token) ? connected : [...connected, token]
    const nextParticipants = {
        ...participants,
        [identityKey]: token,
    }
    const updates = {
        connected: JSON.stringify(nextConnected),
        participants: JSON.stringify(nextParticipants),
    }
    if (isCreator && !meta.creatorToken) {
        updates.creatorToken = token
    }

    await redis.hset(`meta:${roomId}`, updates)
    if (existingToken !== token) {
        response.cookies.set("x-auth-token", token, cookieOptions)
    }

    return response
}

export const config = {
    matcher: "/room/:path*"
}
