import { redis } from "./redis"
import { nanoid } from "nanoid"

/**
 * Password hashing using Web Crypto API (PBKDF2)
 * No external dependencies needed
 */

const SALT_LENGTH = 16
const ITERATIONS = 100_000
const KEY_LENGTH = 32
const USERNAME_MIN_LENGTH = 3
const USERNAME_MAX_LENGTH = 30

/** @param {string} email */
function normalizeEmail(email) {
    return email.trim().toLowerCase()
}

/** @param {string} username */
function normalizeUsername(username) {
    return username.trim()
}

/** @param {string} seed */
function usernameSeedToSlug(seed) {
    const slug = seed
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, USERNAME_MAX_LENGTH)

    if (slug.length >= USERNAME_MIN_LENGTH) return slug
    return `user-${nanoid(6).toLowerCase()}`
}

/**
 * @param {ArrayBuffer} buffer
 */
function toHex(buffer) {
    const bytes = new Uint8Array(buffer)
    let hex = ""
    for (let i = 0; i < bytes.length; i += 1) {
        hex += bytes[i].toString(16).padStart(2, "0")
    }
    return hex
}

/** @param {string} baseName */
async function generateUniqueUsername(baseName) {
    const base = usernameSeedToSlug(baseName)
    let candidate = base
    let attempts = 0

    while (await redis.get(`user:name:${candidate.toLowerCase()}`)) {
        attempts += 1
        const suffix = `-${nanoid(4).toLowerCase()}`
        const maxBaseLength = Math.max(USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH - suffix.length)
        candidate = `${base.slice(0, maxBaseLength)}${suffix}`

        if (attempts > 20) {
            candidate = `user-${nanoid(8).toLowerCase()}`.slice(0, USERNAME_MAX_LENGTH)
        }
    }

    return candidate
}

/** @param {string} password @param {string} salt */
async function hashPassword(password, salt) {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    )
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: enc.encode(salt), iterations: ITERATIONS, hash: "SHA-256" },
        key,
        KEY_LENGTH * 8
    )
    return toHex(bits)
}

/** @param {string} password */
export async function createPasswordHash(password) {
    const salt = nanoid(SALT_LENGTH)
    const hash = await hashPassword(password, salt)
    return `${salt}:${hash}`
}

/** @param {string} password @param {string} storedHash */
export async function verifyPassword(password, storedHash) {
    const [salt, hash] = storedHash.split(":")
    if (!salt || !hash) return false
    const computed = await hashPassword(password, salt)
    return computed === hash
}

/**
 * Create a new user account
 * @param {{ username: string, email: string, password: string }} params
 * @returns {Promise<{ success: boolean, userId?: string, error?: string }>}
 */
export async function createUser({ username, email, password }) {
    const normalizedEmail = normalizeEmail(email)
    const normalizedUsername = normalizeUsername(username)

    if (
        normalizedUsername.length < USERNAME_MIN_LENGTH ||
        normalizedUsername.length > USERNAME_MAX_LENGTH
    ) {
        return { success: false, error: "Username must be 3-30 characters" }
    }

    // Check if email already exists
    const existingUserId = await redis.get(`user:email:${normalizedEmail}`)
    if (existingUserId) {
        return { success: false, error: "Email already registered" }
    }

    // Check if username is taken
    const existingUsername = await redis.get(`user:name:${normalizedUsername.toLowerCase()}`)
    if (existingUsername) {
        return { success: false, error: "Username already taken" }
    }

    const userId = nanoid()
    const passwordHash = await createPasswordHash(password)

    await Promise.all([
        redis.hset(`user:${userId}`, {
            username: normalizedUsername,
            email: normalizedEmail,
            passwordHash,
            createdAt: Date.now(),
        }),
        redis.set(`user:email:${normalizedEmail}`, userId),
        redis.set(`user:name:${normalizedUsername.toLowerCase()}`, userId),
    ])

    return { success: true, userId }
}

/**
 * Authenticate a user
 * @param {{ email: string, password: string }} params
 * @returns {Promise<{ success: boolean, userId?: string, username?: string, error?: string }>}
 */
export async function authenticateUser({ email, password }) {
    const normalizedEmail = normalizeEmail(email)
    const userId = await redis.get(`user:email:${normalizedEmail}`)
    if (!userId) {
        return { success: false, error: "Invalid email or password" }
    }

    const user = await redis.hgetall(`user:${userId}`)
    if (!user || !user.passwordHash) {
        return { success: false, error: "Invalid email or password" }
    }

    const valid = await verifyPassword(password, /** @type {string} */(user.passwordHash))
    if (!valid) {
        return { success: false, error: "Invalid email or password" }
    }

    return { success: true, userId: /** @type {string} */ (userId), username: /** @type {string} */ (user.username) }
}

/**
 * Authenticate or create a user from a Google profile
 * @param {{ googleId: string, email: string, name?: string }} params
 * @returns {Promise<{ success: boolean, userId?: string, username?: string, error?: string }>}
 */
export async function authenticateGoogleUser({ googleId, email, name }) {
    const normalizedEmail = normalizeEmail(email)
    if (!googleId || !normalizedEmail) {
        return { success: false, error: "Invalid Google account data" }
    }

    const existingGoogleUserId = await redis.get(`user:google:${googleId}`)
    if (existingGoogleUserId) {
        const existingUser = await redis.hgetall(`user:${existingGoogleUserId}`)
        if (existingUser && existingUser.username) {
            return {
                success: true,
                userId: /** @type {string} */ (existingGoogleUserId),
                username: /** @type {string} */ (existingUser.username),
            }
        }

        // Remove stale google mapping if the linked user no longer exists
        await redis.del(`user:google:${googleId}`)
    }

    const existingEmailUserId = await redis.get(`user:email:${normalizedEmail}`)
    if (existingEmailUserId) {
        const user = await redis.hgetall(`user:${existingEmailUserId}`)
        if (!user || !user.username) {
            return { success: false, error: "Failed to load account" }
        }

        await Promise.all([
            redis.set(`user:google:${googleId}`, existingEmailUserId),
            redis.hset(`user:${existingEmailUserId}`, {
                googleId,
                authProvider: user.passwordHash ? "hybrid" : "google",
            }),
        ])

        return {
            success: true,
            userId: /** @type {string} */ (existingEmailUserId),
            username: /** @type {string} */ (user.username),
        }
    }

    const usernameSeed = (name?.trim() || normalizedEmail.split("@")[0] || "user")
    const username = await generateUniqueUsername(usernameSeed)
    const userId = nanoid()

    await Promise.all([
        redis.hset(`user:${userId}`, {
            username,
            email: normalizedEmail,
            googleId,
            authProvider: "google",
            createdAt: Date.now(),
        }),
        redis.set(`user:email:${normalizedEmail}`, userId),
        redis.set(`user:name:${username.toLowerCase()}`, userId),
        redis.set(`user:google:${googleId}`, userId),
    ])

    return { success: true, userId, username }
}

/**
 * Create a session for a user
 * @param {string} userId
 * @param {string} username
 * @returns {Promise<string>} sessionId
 */
export async function createSession(userId, username) {
    const sessionId = nanoid(32)
    await redis.hset(`session:${sessionId}`, {
        userId,
        username,
        createdAt: Date.now(),
    })
    // Sessions expire after 30 days
    await redis.expire(`session:${sessionId}`, 30 * 24 * 60 * 60)
    return sessionId
}

/**
 * Get user from session
 * @param {string | undefined} sessionId
 * @returns {Promise<{ userId: string, username: string } | null>}
 */
export async function getUserFromSession(sessionId) {
    if (!sessionId) return null
    const session = await redis.hgetall(`session:${sessionId}`)
    if (!session || !session.userId) return null
    return {
        userId: /** @type {string} */ (session.userId),
        username: /** @type {string} */ (session.username),
    }
}

/**
 * Delete a session
 * @param {string} sessionId
 */
export async function deleteSession(sessionId) {
    await redis.del(`session:${sessionId}`)
}

/**
 * Add a room to user's room list (for permanent rooms)
 * @param {string} userId
 * @param {string} roomId
 */
export async function addRoomToUser(userId, roomId) {
    await redis.zadd(`user:${userId}:rooms`, { score: Date.now(), member: roomId })
}

/**
 * Get user's permanent rooms
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getUserRooms(userId) {
    const rooms = await redis.zrange(`user:${userId}:rooms`, 0, -1, { rev: true })
    return /** @type {string[]} */ (rooms)
}

/**
 * Check if a username is available
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function checkUsernameAvailable(username) {
    const normalized = username.trim().toLowerCase()
    if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) return false
    const existing = await redis.get(`user:name:${normalized}`)
    return !existing
}

/**
 * Update a user's username (atomically swap name keys)
 * @param {string} userId
 * @param {string} oldUsername
 * @param {string} newUsername
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateUsername(userId, oldUsername, newUsername) {
    const normalizedNew = newUsername.trim()
    const normalizedOld = oldUsername.trim()

    if (normalizedNew.length < USERNAME_MIN_LENGTH || normalizedNew.length > USERNAME_MAX_LENGTH) {
        return { success: false, error: "Username must be 3-30 characters" }
    }

    // Check if new username is taken (by someone else)
    const existingUserId = await redis.get(`user:name:${normalizedNew.toLowerCase()}`)
    if (existingUserId && existingUserId !== userId) {
        return { success: false, error: "Username already taken" }
    }

    // Atomically swap
    await Promise.all([
        redis.del(`user:name:${normalizedOld.toLowerCase()}`),
        redis.set(`user:name:${normalizedNew.toLowerCase()}`, userId),
        redis.hset(`user:${userId}`, { username: normalizedNew }),
    ])

    return { success: true }
}

/**
 * Update a user's avatar (base64 data URL)
 * @param {string} userId
 * @param {string} avatarDataUrl
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateAvatar(userId, avatarDataUrl) {
    // Limit to ~500KB
    if (avatarDataUrl.length > 700_000) {
        return { success: false, error: "Avatar image is too large (max 500KB)" }
    }
    await redis.hset(`user:${userId}`, { avatar: avatarDataUrl })
    return { success: true }
}
