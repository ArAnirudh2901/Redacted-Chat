import { redis } from '@/lib/redis'
import { Elysia, t } from 'elysia'
import { nanoid } from 'nanoid'
import { authMiddleware } from './auth'
import z from 'zod'
import { realtime } from '@/lib/realtime'

const ROOM_TTL_SECONDS = 60 * 10

const rooms = new Elysia({ prefix: "/room" })
    .post("/create", async () => {
        const roomId = nanoid()

        await redis.hset(`meta:${roomId}`, {
            connected: JSON.stringify([]),
            createdAt: Date.now(),
        })

        await redis.expire(`meta:${roomId}`, ROOM_TTL_SECONDS)

        return { roomId }
    })
    .get("/ttl", async ({ query }) => {
        const { roomId } = query
        if (!roomId) return { ttl: -1 }

        const ttl = await redis.ttl(`meta:${roomId}`)
        return { ttl }
    })

const bodySchema = z.object({
    sender: z.string().max(1_000_000),
    text: z.string().max(1_000_000),
})

const messages = new Elysia({ prefix: "/messages" })
    .use(authMiddleware)
    .post("/", async ({ body, auth }) => {
        const { sender, text } = bodySchema.parse(body)
        const { roomId } = auth

        const roomExists = await redis.exists(`meta:${roomId}`)

        if (!roomExists)
            throw new Error("Room does not exist.")

        const message = {
            id: nanoid(),
            sender,
            text,
            timestamp: Date.now(),
            roomId
        }

        // Now we have the message that has been sent in the memory 
        // So we then add this message to the chat history to view it
        await redis.rpush(`messages:${roomId}`, {
            ...message,
            token: auth.token,
        })

        await realtime.channel(roomId).emit("chat.message", message)

        // Expiration of the room
        const remTime = await redis.ttl(`meta:${roomId}`)
        await redis.expire(`messages:${roomId}`, remTime)
        await redis.expire(`history:${roomId}`, remTime)
        await redis.expire(roomId, remTime)

        return { success: true }
    })
    .get("/", async ({ auth }) => {
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
    }, { query: z.object({ roomId: z.string() }) })

export const app = new Elysia({ prefix: '/api' })
    .onError(({ code, error, set }) => {
        if (code === "VALIDATION") {
            set.status = 422
            return {
                error: "Validation Error",
                details: JSON.parse(error.message)
            }
        }
    })
    .use(rooms)
    .use(messages)

export const GET = app.fetch
export const POST = app.fetch