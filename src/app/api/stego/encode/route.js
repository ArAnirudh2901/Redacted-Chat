import { NextResponse } from "next/server"
import z from "zod"
import { redis } from "@/lib/redis"
import { encodeLosslessStegoPng } from "@/lib/server/stego-lossless"

const schema = z.object({
    roomId: z.string().min(1).max(128),
    coverBase64: z.string().min(32),
    secretCipherHex: z.string().min(2).max(600_000),
    secretMeta: z.record(z.string(), z.any()).optional(),
})

const WORKER_TIMEOUT_MS = 8_500
const DEFAULT_WORKER_PATH = "/v1/stego/encode-lossless"

/** @type {{ limit: (key: string) => Promise<{ success: boolean, reset: number }> } | null | undefined} */
let cachedRatelimit

async function getRatelimit() {
    if (typeof cachedRatelimit !== "undefined") {
        return cachedRatelimit
    }
    try {
        const specifier = "@upstash/ratelimit"
        const mod = await import(specifier)
        const Ratelimit = mod.Ratelimit
        cachedRatelimit = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(5, "1 h"),
            analytics: false,
            prefix: "rl:stego:encode",
        })
        return cachedRatelimit
    } catch {
        cachedRatelimit = null
        return null
    }
}

/**
 * Fallback limiter if @upstash/ratelimit is unavailable.
 * @param {string} key
 */
async function fallbackRateLimit(key) {
    const windowMs = 60 * 60 * 1000
    const now = Date.now()
    const bucket = Math.floor(now / windowMs)
    const redisKey = `rl:stego:encode:fallback:${key}:${bucket}`
    const count = await redis.incr(redisKey)
    if (count === 1) {
        await redis.expire(redisKey, 60 * 60)
    }
    return {
        success: count <= 5,
        reset: (bucket + 1) * windowMs,
    }
}

/**
 * @param {Request} req
 */
function getClientIp(req) {
    const forwarded = req.headers.get("x-forwarded-for")
    if (forwarded) {
        const first = forwarded.split(",")[0]?.trim()
        if (first) return first
    }
    const real = req.headers.get("x-real-ip")
    if (real) return real
    return "unknown"
}

/**
 * @param {string} workerBaseUrl
 * @param {Record<string, any>} payload
 */
async function forwardToWorker(workerBaseUrl, payload) {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), WORKER_TIMEOUT_MS)
    try {
        const workerPath = process.env.STEGO_WORKER_LOSSLESS_PATH || DEFAULT_WORKER_PATH
        const url = `${workerBaseUrl.replace(/\/+$/, "")}${workerPath}`
        const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
            signal: ctrl.signal,
        })
        if (!response.ok) {
            const text = await response.text()
            throw new Error(`Worker encode failed (${response.status}): ${text.slice(0, 160)}`)
        }
        const ab = await response.arrayBuffer()
        return Buffer.from(ab)
    } finally {
        clearTimeout(timeout)
    }
}

export async function POST(req) {
    try {
        const ip = getClientIp(req)
        const limiter = await getRatelimit()
        const rate = limiter ? await limiter.limit(ip) : await fallbackRateLimit(ip)
        if (!rate.success) {
            return NextResponse.json(
                {
                    error: "Rate limit exceeded",
                    retryAfterSeconds: Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000)),
                },
                { status: 429 },
            )
        }

        const body = schema.parse(await req.json())
        const secureRoomExists = await redis.exists(`meta:${body.roomId}:secure`)
        if (!secureRoomExists) {
            return NextResponse.json({ error: "Secure room not found" }, { status: 404 })
        }

        const workerBaseUrl = process.env.STEGO_WORKER_URL
        const pngBuffer = workerBaseUrl
            ? await forwardToWorker(workerBaseUrl, body)
            : await encodeLosslessStegoPng(body)

        return new Response(pngBuffer, {
            status: 200,
            headers: {
                "content-type": "image/png",
                "cache-control": "no-store",
                "x-stego-engine": workerBaseUrl ? "worker" : "local",
            },
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid stego encode request", details: error.issues }, { status: 422 })
        }
        if (error instanceof Error && error.name === "AbortError") {
            return NextResponse.json({ error: "Stego encoding timed out" }, { status: 504 })
        }
        console.error("[Stego Encode] failed:", error instanceof Error ? error.message : String(error))
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Stego encode failed" },
            { status: 500 },
        )
    }
}
