
// Two Scenarios
// Sending a message 
// Detroy the messages after the room is detroyed

import { Realtime } from "@upstash/realtime"
import z from "zod"
import { redis } from "@/lib/redis"

const message = z.object({
    id: z.string(),
    sender: z.string(),
    text: z.string(),
    timestamp: z.number(),
    roomId: z.string(),
    token: z.string().optional(),
})

const schema = {
    chat: {
        message,
        destroy: z.object({
            isDestroyed: z.literal(true),
        }),
    },
}

export const realtime = new Realtime({ schema, redis })
