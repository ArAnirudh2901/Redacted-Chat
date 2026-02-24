
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
        encrypted: z.object({
            id: z.string(),
            roomId: z.string(),
            envelope: z.object({
                v: z.number(),
                kind: z.string(),
                ivHex: z.string(),
                cipherHex: z.string(),
                aadHex: z.string().optional(),
                createdAt: z.number(),
            }),
            timestamp: z.number(),
        }),
        self_destruct: z.object({
            roomId: z.string(),
            reason: z.string().optional(),
            timestamp: z.number(),
        }),
        destroy: z.object({
            isDestroyed: z.literal(true),
        }),
        "destroy-request": z.object({
            requestedBy: z.string(),
            requesterId: z.string(),
            requesterName: z.string().optional(),
        }),
        "destroy-denied": z.object({
            denied: z.literal(true),
            requesterId: z.string(),
        }),
        "timer-extended": z.object({
            newTtl: z.number(),
        }),
        panic: z.object({
            triggered: z.literal(true),
        }),
    },
    presence: {
        request: z.object({
            clientId: z.string(),
            username: z.string(),
            timestamp: z.number(),
        }),
        announce: z.object({
            clientId: z.string(),
            username: z.string(),
            timestamp: z.number(),
        }),
        leave: z.object({
            clientId: z.string(),
            username: z.string(),
            timestamp: z.number(),
        }),
    },
    file: {
        offer: z.object({
            from: z.string(),
            to: z.string(),             // target username or "everyone"
            filename: z.string(),
            fileSize: z.number(),
            fileType: z.string(),
            offerId: z.string(),
        }),
        accepted: z.object({            // step 2: receiver acks
            offerId: z.string(),
            from: z.string(),
            to: z.string(),
        }),
        reject: z.object({
            offerId: z.string(),
            from: z.string(),
            to: z.string(),
        }),
        cancel: z.object({
            offerId: z.string(),
            from: z.string(),
            to: z.string(),
            reason: z.string().optional(),
        }),
        "sdp-offer": z.object({         // step 3: sender creates WebRTC
            offerId: z.string(),
            sdp: z.string(),
            from: z.string(),
            to: z.string(),
        }),
        "sdp-answer": z.object({        // step 4: receiver answers
            offerId: z.string(),
            sdp: z.string(),
            from: z.string(),
            to: z.string(),
        }),
        "ice-candidate": z.object({
            offerId: z.string(),
            candidate: z.string(),
            from: z.string(),
            to: z.string(),
        }),
    },
}

export const realtime = new Realtime({ schema, redis })
