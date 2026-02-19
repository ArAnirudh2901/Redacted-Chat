"use client"

import { useUsername } from "@/hooks/use-username"
import { client } from "@/lib/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { useParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"


const STORAGE_KEY = "chat_username"

const formatTimeRemaining = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60

    return `${mins}:${secs.toString().padStart(2, "0")}`
}

const Page = () => {
    const params = useParams()
    const roomIdParam = params?.roomId
    const roomId = Array.isArray(roomIdParam) ? (roomIdParam[0] ?? "") : (roomIdParam ?? "")
    const [input, setInput] = useState("")
    const inputRef = useRef(null)

    const { username } = useUsername()
    const [copyStatus, setStatus] = useState("COPY")
    const endTimeRef = useRef(null)
    const [timeRemaining, setTimeRemaining] = useState(null)

    useEffect(() => {
        // Fetch the actual TTL from the server
        const fetchTTL = async () => {
            try {
                const res = await fetch(`/api/room/ttl?roomId=${roomId}`)
                const data = await res.json()
                const ttl = data?.ttl ?? -1
                if (ttl > 0) {
                    endTimeRef.current = Date.now() + ttl * 1000
                    setTimeRemaining(ttl)
                } else {
                    setTimeRemaining(0)
                }
            } catch {
                setTimeRemaining(0)
            }
        }

        if (roomId) fetchTTL()
    }, [roomId])

    useEffect(() => {
        if (endTimeRef.current === null) return

        const tick = () => {
            const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000))
            setTimeRemaining(remaining)
        }

        const timer = setInterval(tick, 1000)
        return () => clearInterval(timer)
    }, [timeRemaining !== null])

    const { data: messages } = useQuery({
        queryKey: ["messages", roomId],

        queryFn: async () => {
            const res = await client.messages.get({ query: { roomId } })
            return res.data
        },
    })

    /** @type {{ messages: { post: (body: { sender: string, text: string }, options: { query: { roomId: string } }) => Promise<unknown> } }} */
    const api = /** @type {any} */ (client)

    const queryClient = useQueryClient()

    const { mutate, isPending } = useMutation(
        ({
            mutationFn: async (/** @type {{ text: string }} */{ text }) => {
                await api.messages.post({ sender: username, text }, { query: { roomId } })
            },
            onSettled: () => {
                queryClient.invalidateQueries({ queryKey: ["messages", roomId] })
            },
        })
    )

    const copyLink = () => {
        if (!roomId) return
        navigator.clipboard.writeText(roomId)
        setStatus("COPIED")
        setTimeout(() => setStatus("COPY"), 2000)
    }

    const sendMessage = () => {
        const text = input.trim()
        if (!text || !roomId) return

        mutate({ text })
        setInput("")
        inputRef.current?.focus()
    }


    return (
        <main className="flex flex-col h-screen max-h-screen overflow-hidden">
            <header
                className="w-full border-b border-zinc-800 p-4 pb-3 grid items-center gap-4 bg-zinc-900/30"
                style={{ gridTemplateColumns: "1fr auto 1fr" }}
            >
                {/* Timer - Left */}
                <div className="justify-self-start">
                    <div className="flex flex-col w-fit">
                        <span className="text-xs text-zinc-500 uppercase">Self-Destruct</span>
                        <span className={`ml-7 pt-2 pb-0 text-sm font-bold flex items-center gap-2 ${timeRemaining !== null && timeRemaining < 60 ? "text-red-500" : "text-amber-500"}`}>
                            {timeRemaining !== null ? formatTimeRemaining(timeRemaining) : "--:--"}
                        </span>
                    </div>
                </div>

                {/* Room ID - Center */}
                <div className="flex flex-col items-center justify-self-center">
                    <span className="text-xs text-zinc-500 uppercase">Room ID</span>
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-green-500">{roomId}</span>
                        <button onClick={copyLink} className="text-[10px] bg-zinc-800 hover:bg-zinc-700 w-20 py-0.5 rounded text-zinc-200 transition-colors text-center shrink-0">{copyStatus}</button>
                    </div>
                </div>

                {/* Destroy Button - Right */}
                <div className="justify-self-end mb-1">
                    <button className="text-xs bg-zinc-800 hover:bg-red-600 px-3 py-1.5 rounded text-zinc-400 hover:text-white font-bold transition-all group flex items-center gap-2 disabled:opacity-50">
                        <span className="group-hover:animate-pulse">💣</span>
                        DESTROY NOW
                    </button>
                </div>
            </header>

            {/* Messages / Chat History */}

            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
                {messages?.messages.length === 0 && (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-zinc-500 text-sm font-mono">No messages yet, start a conversation.</p>
                    </div>
                )}

                {messages?.messages.map((msg) => (
                    <div key={msg.id} className="flex flex-col items-start">
                        <div className="max-w-[80%] group">
                            <div className="flex items-baseline gap-3 mb-1">
                                <span className={`text-xs font-bold ${msg.sender === username ? "text-green-500" : "text-blue-500"}`}>
                                    {msg.sender === username ? "YOU" : msg.sender}
                                </span>
                                <span className="text-[10px] text-zinc-400">{format(msg.timestamp, "hh:mm a")}</span>
                            </div>

                            <p className="text-sm text-zinc-300 leading-relaxed break-all">
                                {msg.text}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-900/30">
                <div className="flex gap-4 ">
                    <div className="flex-1 relative group">
                        <span className="absolute left-4 top-1/2  -translate-y-1/2 text-green-500 animate-pulse">{">"}</span>
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && input.trim()) {
                                    sendMessage()
                                }
                            }}
                            placeholder=" Type message..."
                            autoFocus type="text"
                            className="w-full bg-black border border-zinc-800 focus:border-zinc-700 focus:outline-none transition-colors text-zinc-100 placeholder:text-zinc-700 py-3 pl-8 pr-4 text-sm" />
                    </div>
                    <button
                        onClick={sendMessage}
                        disabled={!input.trim() || isPending}
                        className="bg-zinc-800 text-zinc-400 w-28 py-3 text-sm font-bold hover:text-zinc-200 hover:bg-zinc-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >SEND</button>
                </div>
            </div>
        </main>
    )

}

export default Page
