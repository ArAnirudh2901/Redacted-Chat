import { redis } from '@/lib/redis'
import { Elysia, t } from 'elysia'
import { nanoid } from 'nanoid'
import { authMiddleware } from './auth'
import z from 'zod'

const ROOM_TTL_SECONDS = 60 * 10

const rooms = new Elysia({ prefix: "/room" })
    .post("/create", async () => {
        const roomId = nanoid()

        await redis.hset(`meta:${roomId}`, {
            connected: [],
            createdAt: Date.now(),
        })

        await redis.expire(`meta:${roomId}`, ROOM_TTL_SECONDS)

        return { roomId }
    })

const bodySchema = z.object({
    sender: z.string().max(1_000_000),
    text: z.string().max(1_000_000),
})

const messages = new Elysia({ prefix: "/messages" })
    .use(authMiddleware)
    .post("/", async ({ auth, body }) => {
        const { sender, text } = bodySchema.parse(body)
        const { roomId } = auth

        const roomExists = await redis.exists(`meta:${roomId}`)

        if (!roomExists)
            throw new Error("Room does not exist.")


    })

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