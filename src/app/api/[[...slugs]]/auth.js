import { redis } from "@/lib/redis"
import Elysia from "elysia"

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
        const roomId = query.roomId
        const token = cookie["x-auth-token"].value

        if (!roomId || !token) {
            throw new AuthError("Missing Room ID or Token")
        }

        const connected = await redis.hget(`meta:${roomId}`, "connected")

        if (!connected?.includes(token)) {
            throw new AuthError("Invalid Token")
        }

        return { auth: { roomId, token, connected } }
    })