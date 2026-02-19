import { NextResponse } from "next/server"
import { redis } from "./lib/redis"
import { nanoid } from "nanoid"

export const proxy = async (req) => {

    const pathname = req.nextUrl.pathname
    const roomMatch = pathname.match(/^\/room\/([^/]+)$/)

    if (!roomMatch)
        return NextResponse.redirect(new URL("/", req.url))

    const roomId = roomMatch[1]
    const meta = await redis.hgetall(`meta:${roomId}`)

    if (!meta) {
        return NextResponse.redirect(new URL("/?error=room-not-found", req.url))
    }

    let connected = []
    try {
        connected = JSON.parse(/** @type {string} */(meta.connected))
    } catch {
        // fallback to empty array if data is malformed
    }

    const existingToken = req.cookies.get("x-auth-token")?.value
    // If the user was in the chat room previosly and just refreshed the browser, the user is allowed to join the room
    if (existingToken && connected.includes(existingToken)) {
        return NextResponse.next()
    }

    // User is not allowed to join if the size of the room is exceeded
    if (connected.length >= 2)
        return NextResponse.redirect(new URL("/?error=room-full", req.url))

    const response = NextResponse.next()
    const token = nanoid()

    response.cookies.set("x-auth-token", token,
        {
            path: "/",
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
        }
    )

    await redis.hset(`meta:${roomId}`, {
        connected: JSON.stringify([...connected, token]),
    })

    return response

    // OVERVIEW: Check if the use is allowed to join the room 
    // if they are: Let them Pass
    // if there are not: Send them back to the lobby

    // TODO: Add your room validation logic here
    // For now, let all valid room requests pass through
}

export const config = {
    matcher: "/room/:path*"
}