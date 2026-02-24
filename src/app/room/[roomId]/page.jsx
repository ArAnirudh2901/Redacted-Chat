"use client"

import { useUsername } from "@/hooks/use-username"
import { useAuth } from "@/hooks/use-auth"
import { client } from "@/lib/client"
import { useRealtime } from "@/lib/realtime-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { motion, AnimatePresence } from "framer-motion"
import toast, { Toaster } from "react-hot-toast"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { List, useListRef } from "react-window"
import { nanoid } from "nanoid"
import { FileSender, FileReceiver } from "@/lib/file-transfer"
import { FileSendModal, TransferProgress, FileOfferToast } from "@/components/file-share-modal"
import { NukeController } from "@/components/nuke/nuke-controller"
import { useNukeCapabilities } from "@/hooks/use-nuke-capabilities"
import { CyberCanvas } from "@/components/cyber-canvas"
import { clearRoomKey, decryptJsonEnvelope, encryptJsonEnvelope, readRoomKey } from "@/lib/secure-crypto"
import { extractLosslessStegoPayload } from "@/lib/stego-lossless-client"
import { decodeRds3StegoPng, encodeRds3StegoPng, isRds3WorkerSupported } from "@/lib/stego-rds3-worker-client"

/* ── Shared easing ── */
const ease = /** @type {[number,number,number,number]} */ ([0.22, 1, 0.36, 1])
const PRESENCE_TTL_MS = 25000
const PRESENCE_HEARTBEAT_MS = 8000
const DISK_STREAM_THRESHOLD_BYTES = 100 * 1024 * 1024

const SECURE_CACHE_MAX = 50

const formatTimeRemaining = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
}

/**
 * @param {string} roomId
 */
function secureEnvelopeCacheKey(roomId) {
    return `secure-room-cache:${roomId}`
}

/**
 * @param {string} roomId
 */
function loadSecureEnvelopeCache(roomId) {
    if (typeof window === "undefined") return []
    try {
        const raw = sessionStorage.getItem(secureEnvelopeCacheKey(roomId))
        if (!raw) return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed
            .filter((item) => item && typeof item.id === "string" && item.envelope && typeof item.envelope === "object")
            .slice(-SECURE_CACHE_MAX)
    } catch {
        return []
    }
}

/**
 * @param {string} roomId
 * @param {Array<{ id: string, envelope: any, timestamp: number }>} entries
 */
function saveSecureEnvelopeCache(roomId, entries) {
    if (typeof window === "undefined") return
    const next = entries.slice(-SECURE_CACHE_MAX)
    sessionStorage.setItem(secureEnvelopeCacheKey(roomId), JSON.stringify(next))
}

function AudioBubble({ src, isOwn }) {
    const audioRef = useRef(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [progress, setProgress] = useState(0)
    const [duration, setDuration] = useState(0)

    const fmtTime = (s) => {
        if (!s || !isFinite(s)) return "0:00"
        const m = Math.floor(s / 60)
        const sec = Math.floor(s % 60)
        return `${m}:${sec.toString().padStart(2, "0")}`
    }

    const toggle = () => {
        const a = audioRef.current
        if (!a) return
        if (a.paused) {
            a.play().catch(() => { })
        } else {
            a.pause()
        }
    }

    return (
        <div className={`flex items-center gap-3 px-3.5 py-2.5 rounded-sm border min-w-[200px] max-w-[280px] ${isOwn
            ? "bg-green-950/20 border-green-900/30"
            : "bg-zinc-800/30 border-zinc-700/30"
            }`}>
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
                onTimeUpdate={() => {
                    const a = audioRef.current
                    if (a && a.duration) setProgress(a.currentTime / a.duration)
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => { setIsPlaying(false); setProgress(0) }}
            />
            <button
                onClick={toggle}
                className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${isOwn
                    ? "bg-green-600/30 text-green-400 hover:bg-green-600/40"
                    : "bg-teal-600/30 text-teal-400 hover:bg-teal-600/40"
                    }`}
            >
                {isPlaying ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="6,4 20,12 6,20" />
                    </svg>
                )}
            </button>
            <div className="flex-1 min-w-0">
                {/* Waveform-style progress bar */}
                <div className="flex items-center gap-[2px] h-4">
                    {Array.from({ length: 20 }, (_, i) => {
                        const barProgress = (i + 1) / 20
                        const filled = progress >= barProgress
                        // Pseudo-random heights for waveform look
                        const heights = [40, 70, 55, 85, 65, 90, 50, 75, 60, 95, 45, 80, 55, 70, 85, 50, 65, 90, 60, 75]
                        return (
                            <div
                                key={i}
                                className={`w-[3px] rounded-full transition-colors duration-150 ${filled
                                    ? (isOwn ? "bg-green-400" : "bg-teal-400")
                                    : "bg-zinc-600/50"
                                    }`}
                                style={{ height: `${heights[i]}%` }}
                            />
                        )
                    })}
                </div>
                <div className="flex justify-between mt-0.5">
                    <span className="text-[9px] text-zinc-500 font-mono">
                        {isPlaying ? fmtTime((audioRef.current?.currentTime ?? 0)) : fmtTime(duration)}
                    </span>
                    <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-wider">Voice</span>
                </div>
            </div>
        </div>
    )
}

function MessageRow({ index, style, messages, username, onVanish }) {
    const msg = messages?.[index]
    const vanishDuration = msg?.vanishAfter ? Number(msg.vanishAfter) : 0
    const [vanishRemaining, setVanishRemaining] = useState(null)
    const [isVanished, setIsVanished] = useState(false)
    const [stegoRevealed, setStegoRevealed] = useState(false)
    const [stegoText, setStegoText] = useState(null)
    const [stegoDecoding, setStegoDecoding] = useState(false)

    // Start vanish countdown based on message timestamp (survives react-window re-mounts)
    useEffect(() => {
        if (!vanishDuration || !msg?.timestamp) return

        const msgTime = typeof msg.timestamp === "number" ? msg.timestamp : new Date(msg.timestamp).getTime()
        const expiresAt = msgTime + vanishDuration * 1000

        const tick = () => {
            const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
            setVanishRemaining(remaining)
            if (remaining <= 0) {
                clearInterval(interval)
                setIsVanished(true)
                setTimeout(() => onVanish?.(msg.id), 600)
            }
        }

        tick() // immediate first tick
        const interval = setInterval(tick, 1000)
        return () => clearInterval(interval)
    }, [vanishDuration, msg?.timestamp, msg?.id, onVanish])

    if (!msg || isVanished) return <div style={style} />

    const isOwn = msg.sender === username
    const isStegoMsg = msg.type === "stego"
    const isAudioMsg = msg.type === "audio"

    const handleReveal = async () => {
        if (stegoDecoding) return
        setStegoDecoding(true)
        try {
            const { decodeMessage } = await import("@/lib/stego")
            const hidden = await decodeMessage(msg.text)
            setStegoText(hidden || "(no hidden message found)")
            setStegoRevealed(true)
        } catch {
            setStegoText("Failed to decode")
            setStegoRevealed(true)
        } finally {
            setStegoDecoding(false)
        }
    }

    return (
        <div style={{ ...style, transition: isVanished ? "opacity 0.5s" : undefined, opacity: isVanished ? 0 : 1 }}>
            <div className={`flex px-3 sm:px-4 py-1.5 ${isOwn ? "justify-end pr-4 sm:pr-6" : "justify-start"}`}>
                <div className={`max-w-[88%] sm:max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
                    <div className={`flex items-baseline gap-3 mb-1 ${isOwn ? "flex-row-reverse" : ""}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isOwn ? "text-green-500" : "text-teal-400"}`}>
                            {isOwn ? "YOU" : msg.sender}
                        </span>
                        <span className="text-[9px] text-zinc-600">{format(msg.timestamp, "hh:mm a")}</span>
                        {vanishDuration > 0 && vanishRemaining !== null && (
                            <span className="text-[9px] text-orange-400 font-bold flex items-center gap-0.5" title="Vanishing message">
                                🔥 {vanishRemaining}s
                            </span>
                        )}
                    </div>
                    {isStegoMsg ? (
                        /* Stego message: image + reveal */
                        <div className={`rounded-sm border overflow-hidden ${isOwn ? "border-green-900/30" : "border-zinc-700/30"}`}>
                            <img
                                src={msg.text}
                                alt="Image"
                                className="max-w-full max-h-[300px] object-contain bg-black"
                                loading="lazy"
                            />
                            <div className="px-3 py-2 bg-zinc-900/50">
                                {stegoRevealed ? (
                                    <div className="space-y-1">
                                        <p className="text-[9px] text-purple-400 font-bold uppercase tracking-wider">
                                            {stegoText?.startsWith("data:image/") ? "Hidden Image" : "Hidden Message"}
                                        </p>
                                        {stegoText?.startsWith("data:image/") ? (
                                            <img
                                                src={stegoText}
                                                alt="Hidden"
                                                className="max-w-full max-h-[300px] object-contain rounded-sm border border-purple-900/30"
                                            />
                                        ) : (
                                            <p className="text-sm text-zinc-200 font-mono break-all">{stegoText}</p>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleReveal}
                                        disabled={stegoDecoding}
                                        className="text-[10px] font-bold uppercase tracking-wider text-purple-400 hover:text-purple-300 transition-colors cursor-pointer disabled:opacity-50"
                                    >
                                        {stegoDecoding ? "Decoding..." : "Reveal 🔍"}
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : isAudioMsg ? (
                        /* Audio message: voice note player */
                        <AudioBubble src={msg.text} isOwn={isOwn} />
                    ) : (
                        /* Normal text message */
                        <div className={`message-bubble px-3.5 py-2.5 rounded-sm text-sm leading-relaxed break-all border ${isOwn
                            ? "bg-green-950/20 border-green-900/30 text-zinc-200"
                            : "bg-zinc-800/30 border-zinc-700/30 text-zinc-300"
                            }`}>
                            {msg.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

const Page = () => {
    const params = useParams()
    const roomIdParam = params?.roomId
    const roomId = Array.isArray(roomIdParam) ? (roomIdParam[0] ?? "") : (roomIdParam ?? "")
    const [input, setInput] = useState("")
    const [isSecureRoom, setIsSecureRoom] = useState(false)
    const [secureRoomKey, setSecureRoomKey] = useState("")
    const [secureMessages, setSecureMessages] = useState([])
    const inputRef = useRef(null)

    const router = useRouter()

    const { username } = useUsername()
    const { user: authUser } = useAuth()
    const [isCopied, setIsCopied] = useState(false)
    const endTimeRef = useRef(null)
    const [timeRemaining, setTimeRemaining] = useState(null)
    const hasRedirectedForExpiryRef = useRef(false)
    const expiredFromServerRef = useRef(false)
    const copyResetTimeoutRef = useRef(null)
    const sendFxTimeoutRef = useRef(null)
    const [sendFxId, setSendFxId] = useState(0)
    const [isSendFxActive, setIsSendFxActive] = useState(false)
    const isDestroyingRef = useRef(false)
    const [userRole, setUserRole] = useState(null) // "creator" | "member"
    const [showDestroyRequest, setShowDestroyRequest] = useState(false)
    const [pendingDestroyRequester, setPendingDestroyRequester] = useState(null)
    const [destroyRequestPending, setDestroyRequestPending] = useState(false)
    const [showExtendPopover, setShowExtendPopover] = useState(false)
    const [showPanicModal, setShowPanicModal] = useState(false)
    const [panicInput, setPanicInput] = useState("")
    const [showFileSendModal, setShowFileSendModal] = useState(false)
    const [transferState, setTransferState] = useState({ status: "idle", progress: 0, filename: "", direction: "" })
    // Vanish timer state
    const [vanishAfter, setVanishAfter] = useState(0) // 0 = off, else seconds
    const [showVanishPicker, setShowVanishPicker] = useState(false)
    const [showInputMenu, setShowInputMenu] = useState(false)
    const VANISH_OPTIONS = [0, 5, 10, 30, 60, 300]
    // Stego modal state
    const [showStegoModal, setShowStegoModal] = useState(false)
    const [stegoImage, setStegoImage] = useState(null) // preview URL (blob/data URL)
    const [stegoSecret, setStegoSecret] = useState("")
    const [stegoEncoding, setStegoEncoding] = useState(false)
    const stegoFileRef = useRef(null)
    const stegoObjectUrlRef = useRef("")
    const [stegoMode, setStegoMode] = useState("text") // "text" | "image"
    const [stegoSecretImage, setStegoSecretImage] = useState(null) // data URL of secret image
    const stegoSecretFileRef = useRef(null)
    const stegoDecodeFileRef = useRef(null)
    const [stegoDecodeResult, setStegoDecodeResult] = useState(null)
    // Audio recording state
    const [isRecording, setIsRecording] = useState(false)
    const [recordingDuration, setRecordingDuration] = useState(0)
    const mediaRecorderRef = useRef(/** @type {MediaRecorder | null} */(null))
    const audioChunksRef = useRef(/** @type {Blob[]} */([]))
    const recordingTimerRef = useRef(/** @type {ReturnType<typeof setInterval> | null} */(null))
    const audioStreamRef = useRef(/** @type {MediaStream | null} */(null))
    // Vanished messages (local removal)
    const [vanishedIds, setVanishedIds] = useState(new Set())
    const activeSendersRef = useRef(new Map())
    const activeReceiversRef = useRef(new Map())
    const pendingOfferToastIdsRef = useRef(new Map())
    const cancelledOfferIdsRef = useRef(new Set())
    const trackedPermanentRoomRef = useRef("")
    const requesterClientIdRef = useRef(`requester_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
    const presenceClientIdRef = useRef(`presence_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
    const [presenceMap, setPresenceMap] = useState({})
    const [nukeState, setNukeState] = useState("idle")
    const nukeTargetPathRef = useRef("")
    const nukeRunningRef = useRef(false)
    const nukeReasonRef = useRef("destroy")
    const nukeOriginRef = useRef(null)
    const secureSeenMessageIdsRef = useRef(new Set())
    const { reduced } = useNukeCapabilities()
    const isNukeRunning = nukeState === "running"

    useEffect(() => {
        hasRedirectedForExpiryRef.current = false
        expiredFromServerRef.current = false
        endTimeRef.current = null
        setPresenceMap({})
        setSecureMessages([])
        secureSeenMessageIdsRef.current = new Set()

        const fetchTTL = async () => {
            try {
                const res = await fetch(`/api/room/ttl?roomId=${roomId}`)
                const data = await res.json()
                const ttl = data?.ttl ?? -1
                if (ttl > 0) {
                    endTimeRef.current = Date.now() + ttl * 1000
                    setTimeRemaining(ttl)
                } else if (ttl === -1) {
                    // Permanent room (no expiry set)
                    setTimeRemaining(-1)
                } else {
                    expiredFromServerRef.current = true
                    setTimeRemaining(0)
                }
            } catch {
                setTimeRemaining(null)
            }
        }

        const fetchRoomInfo = async () => {
            try {
                const res = await fetch(`/api/room/info?roomId=${roomId}`)
                const data = await res.json()
                const secure = data?.secure === true
                setIsSecureRoom(secure)
                if (!secure) {
                    setSecureRoomKey("")
                    return
                }

                const roomKeyHex = readRoomKey(roomId)
                if (!roomKeyHex) {
                    toast.error("Security proof missing. Re-verify to enter this secure room.", {
                        style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
                    })
                    router.replace(`/?error=room-auth-required&roomId=${encodeURIComponent(roomId)}`)
                    return
                }
                setSecureRoomKey(roomKeyHex)
            } catch {
                setIsSecureRoom(false)
                setSecureRoomKey("")
            }
        }

        const fetchRole = async () => {
            try {
                const res = await client.room.role.get({ query: { roomId } })
                setUserRole(res?.data?.role ?? "member")
            } catch {
                setUserRole("member")
            }
        }

        if (roomId) {
            fetchRoomInfo()
            fetchTTL()
            fetchRole()
        }
    }, [roomId, router])

    useEffect(() => {
        if (endTimeRef.current === null) return

        const tick = () => {
            const remaining = Math.max(0, Math.round((endTimeRef.current - Date.now()) / 1000))
            setTimeRemaining(remaining)
        }

        const timer = setInterval(tick, 1000)
        return () => clearInterval(timer)
    }, [timeRemaining !== null])

    useEffect(() => {
        if (isDestroyingRef.current) return
        const hasExpired = timeRemaining === 0 && (expiredFromServerRef.current || endTimeRef.current !== null)
        if (!hasExpired || hasRedirectedForExpiryRef.current) return

        hasRedirectedForExpiryRef.current = true
        router.replace("/?error=room-expired")
    }, [timeRemaining, router])

    useEffect(() => {
        if (!roomId || timeRemaining !== -1 || !authUser?.userId) return

        const marker = `${authUser.userId}:${roomId}`
        if (trackedPermanentRoomRef.current === marker) return
        trackedPermanentRoomRef.current = marker

        fetch("/api/auth/track-room", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ roomId }),
        }).catch(() => {
            // No user-facing interruption; sidebar can recover on future visits.
        })
    }, [authUser?.userId, roomId, timeRemaining])

    const getCenterFromElement = useCallback((element) => {
        if (!element || typeof element.getBoundingClientRect !== "function") return null
        const rect = element.getBoundingClientRect()
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        }
    }, [])

    const setNukeOriginFromTrigger = useCallback((target) => {
        const center = getCenterFromElement(target)
        if (center) {
            nukeOriginRef.current = center
        }
    }, [getCenterFromElement])

    const startNukeThenNavigate = useCallback((targetPath, source = "remote", reason = "destroy") => {
        if (nukeRunningRef.current) return
        nukeRunningRef.current = true
        isDestroyingRef.current = true
        nukeTargetPathRef.current = targetPath
        nukeReasonRef.current = reason
        setNukeState("running")
    }, [])

    const handleNukeComplete = useCallback(() => {
        const target = nukeTargetPathRef.current || "/"
        if (isSecureRoom) {
            clearRoomKey(roomId)
            if (typeof window !== "undefined") {
                sessionStorage.removeItem(secureEnvelopeCacheKey(roomId))
            }
        }
        nukeRunningRef.current = false
        setNukeState("idle")
        nukeTargetPathRef.current = ""
        nukeReasonRef.current = "destroy"
        router.push(target)
    }, [isSecureRoom, roomId, router])

    useEffect(() => {
        return () => {
            if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current)
            if (sendFxTimeoutRef.current) clearTimeout(sendFxTimeoutRef.current)
            for (const toastId of pendingOfferToastIdsRef.current.values()) {
                toast.dismiss(toastId)
            }
            pendingOfferToastIdsRef.current.clear()
            cancelledOfferIdsRef.current.clear()
            for (const sender of activeSendersRef.current.values()) {
                const senderInternal = /** @type {any} */ (sender)
                if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
                sender.cleanup()
            }
            for (const receiver of activeReceiversRef.current.values()) receiver.cleanup()
            activeSendersRef.current.clear()
            activeReceiversRef.current.clear()
            nukeRunningRef.current = false
            if (stegoObjectUrlRef.current && typeof window !== "undefined") {
                URL.revokeObjectURL(stegoObjectUrlRef.current)
                stegoObjectUrlRef.current = ""
            }
        }
    }, [])

    const appendSecureMessage = useCallback((message, cacheEntry) => {
        if (!message?.id) return
        if (secureSeenMessageIdsRef.current.has(message.id)) return
        secureSeenMessageIdsRef.current.add(message.id)
        setSecureMessages((prev) => {
            const next = [...prev, message].sort((a, b) => {
                const aTs = typeof a.timestamp === "number" ? a.timestamp : 0
                const bTs = typeof b.timestamp === "number" ? b.timestamp : 0
                return aTs - bTs
            })
            return next.slice(-SECURE_CACHE_MAX)
        })
        if (cacheEntry) {
            const existing = loadSecureEnvelopeCache(roomId).filter((entry) => entry.id !== cacheEntry.id)
            saveSecureEnvelopeCache(roomId, [...existing, cacheEntry])
        }
    }, [roomId])

    const handleEncryptedEnvelope = useCallback(async (payload) => {
        if (!isSecureRoom || !secureRoomKey) return
        const envelope = payload?.envelope
        const id = typeof payload?.id === "string" ? payload.id : nanoid()
        if (!envelope || typeof envelope !== "object") return
        if (secureSeenMessageIdsRef.current.has(id)) return

        try {
            const decrypted = await decryptJsonEnvelope(secureRoomKey, envelope)
            const sender = typeof decrypted?.sender === "string" ? decrypted.sender : "anonymous"
            const text = typeof decrypted?.text === "string" ? decrypted.text : ""
            const timestamp = typeof decrypted?.timestamp === "number"
                ? decrypted.timestamp
                : (typeof payload?.timestamp === "number" ? payload.timestamp : Date.now())
            const type = typeof decrypted?.type === "string" ? decrypted.type : "text"
            const vanishAfter = typeof decrypted?.vanishAfter === "number" ? decrypted.vanishAfter : undefined

            appendSecureMessage({
                id,
                sender,
                text,
                timestamp,
                roomId,
                ...(vanishAfter ? { vanishAfter } : {}),
                ...(type !== "text" ? { type } : {}),
            }, {
                id,
                envelope,
                timestamp,
            })
        } catch {
            // Ignore malformed or undecryptable envelopes.
        }
    }, [appendSecureMessage, isSecureRoom, roomId, secureRoomKey])

    useEffect(() => {
        if (!isSecureRoom || !secureRoomKey || !roomId) return
        const cached = loadSecureEnvelopeCache(roomId)
        if (cached.length === 0) return

        let cancelled = false
        const hydrate = async () => {
            for (const entry of cached) {
                if (cancelled) break
                await handleEncryptedEnvelope(entry)
            }
        }
        void hydrate()

        return () => {
            cancelled = true
        }
    }, [handleEncryptedEnvelope, isSecureRoom, roomId, secureRoomKey])

    // Focus input on any key press
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if we're already focused on an input/textarea
            if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
                return
            }

            // Ignore modifier shortcuts (like Cmd+R, Ctrl+C, etc)
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return
            }

            // If it's a printable character (length 1 means it's not Shift, Enter, Backspace, etc)
            // or Backspace, focus the input
            if (e.key.length === 1 || e.key === "Backspace") {
                inputRef.current?.focus()
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [])

    const { data: messages, refetch } = useQuery({
        queryKey: ["messages", roomId],
        retry: 2,
        enabled: Boolean(roomId) && !isSecureRoom,
        queryFn: async () => {
            const res = await client.messages.get({ query: { roomId } })
            if (res.error) throw new Error("Failed to fetch messages")
            return res.data
        },
    })

    /** @type {{ messages: { post: (body: { sender: string, text: string, vanishAfter?: number, type?: string }, options: { query: { roomId: string } }) => Promise<unknown> } }} */
    const api = /** @type {any} */ (client)

    const queryClient = useQueryClient()

    const { mutate, isPending } = useMutation({
        mutationFn: async (/** @type {{ text: string, vanishAfter?: number, type?: string }} */{ text, vanishAfter: va, type: t }) => {
            if (isSecureRoom) {
                if (!secureRoomKey) {
                    throw new Error("Secure room key is unavailable")
                }

                const decryptedPayload = {
                    sender: username,
                    text,
                    type: t || "text",
                    timestamp: Date.now(),
                    ...(va ? { vanishAfter: va } : {}),
                }
                const envelope = await encryptJsonEnvelope(secureRoomKey, decryptedPayload, "text")
                const response = await fetch(`/api/messages/encrypted?roomId=${encodeURIComponent(roomId)}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ roomId, envelope }),
                })
                const data = await response.json()
                if (!response.ok) {
                    throw new Error(data?.error || "Failed to send encrypted message")
                }
                await handleEncryptedEnvelope({
                    id: data?.id || nanoid(),
                    envelope,
                    timestamp: data?.acceptedAt || Date.now(),
                })
                return
            }

            await api.messages.post({ sender: username, text, ...(va ? { vanishAfter: va } : {}), ...(t ? { type: t } : {}) }, { query: { roomId } })
        },
        onSettled: () => {
            if (!isSecureRoom) {
                queryClient.invalidateQueries({ queryKey: ["messages", roomId] })
            }
        },
        onError: (error) => {
            const message = error instanceof Error ? error.message : "Failed to send message"
            toast.error(message, {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        },
    })

    const currentMessages = useMemo(() => {
        if (isSecureRoom) return secureMessages
        return messages?.messages || []
    }, [isSecureRoom, messages?.messages, secureMessages])

    const messageParticipants = useMemo(() => {
        if (!currentMessages || currentMessages.length === 0) return []
        const senders = new Set()
        for (const m of /** @type {any[]} */ (currentMessages)) {
            if (m?.sender) senders.add(m.sender)
        }
        return Array.from(senders)
    }, [currentMessages])

    // Poll server for participants (reliable fallback for presence discovery)
    const { data: serverParticipants } = useQuery({
        queryKey: ["participants", roomId],
        queryFn: async () => {
            const res = await fetch(`/api/messages/participants?roomId=${encodeURIComponent(roomId)}`, { credentials: "include" })
            if (!res.ok) return []
            const data = await res.json()
            return Array.isArray(data?.participants) ? data.participants : []
        },
        refetchInterval: 10_000,
        enabled: Boolean(roomId) && !isSecureRoom,
        staleTime: 8_000,
    })

    // Merge message history + server poll + live presence so recipients are selectable immediately.
    const participants = useMemo(() => {
        const merged = new Set(messageParticipants)
        if (serverParticipants) {
            for (const p of serverParticipants) merged.add(p)
        }
        const presenceEntries = Object.values(presenceMap)
        for (const entry of presenceEntries) {
            if (entry?.username) merged.add(entry.username)
        }
        if (username) merged.add(username)

        return Array.from(merged).sort((a, b) => a.localeCompare(b))
    }, [messageParticipants, serverParticipants, presenceMap, username])

    useRealtime({
        channels: [roomId],
        // @ts-ignore — file.* events are defined in realtime schema but TS can't infer them
        events: [
            "chat.message",
            "chat.encrypted",
            "chat.destroy",
            "chat.self_destruct",
            "chat.destroy-request",
            "chat.destroy-denied",
            "chat.timer-extended",
            "chat.panic",
            "presence.request",
            "presence.announce",
            "presence.leave",
            "file.offer",
            "file.accepted",
            "file.reject",
            "file.cancel",
            "file.sdp-offer",
            "file.sdp-answer",
            "file.ice-candidate",
        ],
        onData: ({ event, data }) => {
            if (event === "chat.message" && !isSecureRoom) refetch()
            if (event === "chat.encrypted") {
                void handleEncryptedEnvelope(data)
                return
            }
            if (event === "chat.self_destruct") {
                if (nukeRunningRef.current) return
                clearRoomKey(roomId)
                startNukeThenNavigate("/?destroyed=true", "remote", "destroy")
                return
            }
            if (event === "chat.destroy") {
                if (nukeRunningRef.current) return
                if (isSecureRoom) clearRoomKey(roomId)
                startNukeThenNavigate("/?destroyed=true", "remote", "destroy")
                return
            }
            if (event === "chat.destroy-request" && userRole === "creator") {
                const requesterId = typeof /** @type {any} */ (data)?.requesterId === "string"
                    ? /** @type {any} */ (data).requesterId
                    : null
                const requesterName = typeof /** @type {any} */ (data)?.requesterName === "string"
                    ? /** @type {any} */ (data).requesterName
                    : "a participant"
                setPendingDestroyRequester(requesterId ? { requesterId, requesterName } : null)
                setShowDestroyRequest(true)
            }
            if (event === "chat.destroy-denied") {
                const requesterId = typeof /** @type {any} */ (data)?.requesterId === "string"
                    ? /** @type {any} */ (data).requesterId
                    : null
                if (!requesterId || requesterId !== requesterClientIdRef.current) return
                setDestroyRequestPending(false)
                toast.error("The room creator denied your destroy request", {
                    style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
                    duration: 4000,
                })
            }
            if (event === "chat.timer-extended") {
                const newTtl = /** @type {any} */ (data)?.newTtl
                if (typeof newTtl === "number" && newTtl > 0) {
                    endTimeRef.current = Date.now() + newTtl * 1000
                    setTimeRemaining(newTtl)
                    toast.success(`Timer extended! ${Math.ceil(newTtl / 60)} min remaining`, {
                        style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
                        duration: 3000,
                    })
                }
            }
            if (event === "chat.panic") {
                if (nukeRunningRef.current) return
                if (userRole === "creator") {
                    if (isSecureRoom) clearRoomKey(roomId)
                    startNukeThenNavigate("/?error=room-not-found", "remote", "panic")
                    return
                }
                if (isSecureRoom) clearRoomKey(roomId)
                router.push("/?error=room-not-found")
            }

            const evt = /** @type {string} */ (event)
            const d = /** @type {any} */ (data)

            if (evt === "presence.request") {
                const requesterId = typeof d?.clientId === "string" ? d.clientId : ""
                if (!username || !requesterId || requesterId === presenceClientIdRef.current) return
                emitSignal("presence.announce", {
                    clientId: presenceClientIdRef.current,
                    username,
                    timestamp: Date.now(),
                })
                return
            }

            if (evt === "presence.announce") {
                const clientId = typeof d?.clientId === "string" ? d.clientId : ""
                const announcedUsername = typeof d?.username === "string" ? d.username.trim() : ""
                if (!clientId || !announcedUsername) return
                const lastSeen = typeof d?.timestamp === "number" ? d.timestamp : Date.now()
                setPresenceMap((prev) => {
                    const current = prev[clientId]
                    if (
                        current?.username === announcedUsername &&
                        typeof current?.lastSeen === "number" &&
                        Math.abs(current.lastSeen - lastSeen) < 1000
                    ) {
                        return prev
                    }
                    return {
                        ...prev,
                        [clientId]: { username: announcedUsername, lastSeen },
                    }
                })
                return
            }

            if (evt === "presence.leave") {
                const clientId = typeof d?.clientId === "string" ? d.clientId : ""
                if (!clientId) return
                setPresenceMap((prev) => {
                    if (!prev[clientId]) return prev
                    const next = { ...prev }
                    delete next[clientId]
                    return next
                })
                return
            }

            // ─── File transfer signaling (4-step flow) ───
            if (evt.startsWith("file.") && d?.to && d.to !== username) return

            if (evt === "file.offer") {
                if (d.from === username) return
                // Check targeting — only show if addressed to us or everyone
                if (d.to !== "everyone" && d.to !== username) return
                if (cancelledOfferIdsRef.current.has(d.offerId)) return

                const toastId = toast(
                    (t) => (
                        <FileOfferToast
                            filename={d.filename}
                            fileSize={d.fileSize}
                            from={d.from}
                            onAccept={() => {
                                pendingOfferToastIdsRef.current.delete(d.offerId)
                                toast.dismiss(t.id)
                                if (cancelledOfferIdsRef.current.has(d.offerId)) {
                                    toast.error("Sender cancelled this transfer", {
                                        style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
                                    })
                                    return
                                }
                                handleAcceptFile(d)
                            }}
                            onReject={() => {
                                pendingOfferToastIdsRef.current.delete(d.offerId)
                                toast.dismiss(t.id)
                                emitSignal("file.reject", {
                                    offerId: d.offerId,
                                    from: username,
                                    to: d.from,
                                })
                            }}
                        />
                    ),
                    { duration: 30000, style: { background: "#09090b", border: "1px solid #3f3f46", padding: "12px" } }
                )
                pendingOfferToastIdsRef.current.set(d.offerId, toastId)
            }

            // Step 2b: sender receives acceptance → creates WebRTC connection
            if (evt === "file.accepted") {
                const sender = activeSendersRef.current.get(d.offerId)
                if (sender) {
                    if (sender._offerTimeout) clearTimeout(sender._offerTimeout)
                    sender._offerTimeout = null
                    sender.handleAccepted()
                }
            }

            // Step 3b: receiver gets SDP offer → creates answer
            if (evt === "file.sdp-offer") {
                if (d.from === username) return
                const receiver = activeReceiversRef.current.get(d.offerId)
                if (receiver) receiver.acceptOffer(d.sdp)
            }

            // Step 4b: sender gets SDP answer → sets remote description
            if (evt === "file.sdp-answer") {
                const sender = activeSendersRef.current.get(d.offerId)
                if (sender) sender.handleAnswer(d.sdp)
            }

            if (evt === "file.ice-candidate") {
                if (d.from === username) return
                const sender = activeSendersRef.current.get(d.offerId)
                const receiver = activeReceiversRef.current.get(d.offerId)
                if (sender) sender.handleIceCandidate(d.candidate)
                if (receiver) receiver.handleIceCandidate(d.candidate)
            }

            if (evt === "file.reject") {
                const sender = activeSendersRef.current.get(d.offerId)
                if (!sender) return
                sender.cleanup()
                if (sender._offerTimeout) clearTimeout(sender._offerTimeout)
                sender._offerTimeout = null
                activeSendersRef.current.delete(d.offerId)
                if (activeSendersRef.current.size === 0) {
                    setTransferState({ status: "idle", progress: 0, filename: "", direction: "" })
                }
                toast.error(`File transfer rejected by ${d.from || "recipient"}`, {
                    style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
                })
            }

            if (evt === "file.cancel") {
                const reason = typeof d.reason === "string" ? d.reason : "Transfer cancelled"
                cancelledOfferIdsRef.current.add(d.offerId)
                setTimeout(() => cancelledOfferIdsRef.current.delete(d.offerId), 60000)
                const pendingToastId = pendingOfferToastIdsRef.current.get(d.offerId)
                if (pendingToastId) {
                    toast.dismiss(pendingToastId)
                    pendingOfferToastIdsRef.current.delete(d.offerId)
                }

                let wasHandled = false
                const sender = activeSendersRef.current.get(d.offerId)
                if (sender) {
                    const senderInternal = /** @type {any} */ (sender)
                    if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
                    senderInternal._offerTimeout = null
                    void sender.cancel(reason, { notifyPeer: false })
                    activeSendersRef.current.delete(d.offerId)
                    if (activeSendersRef.current.size === 0) {
                        setTransferState((s) => ({ ...s, status: "cancelled" }))
                        setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 2000)
                    }
                    wasHandled = true
                }

                const receiver = activeReceiversRef.current.get(d.offerId)
                if (receiver) {
                    void receiver.cancel(reason, { notifyPeer: false })
                    activeReceiversRef.current.delete(d.offerId)
                    setTransferState((s) => ({ ...s, status: "cancelled" }))
                    setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 2000)
                    wasHandled = true
                }

                if (wasHandled || pendingToastId) {
                    toast(reason, {
                        icon: "⏹",
                        style: { background: "#18181b", color: "#fbbf24", border: "1px solid #78350f" },
                    })
                }
            }
        }
    })

    const { mutate: destroyRoom } = useMutation({
        mutationFn: async () => {
            isDestroyingRef.current = true
            await client.room.delete(null, {
                query: { roomId }
            })
        },
        onSuccess: () => {
            if (isSecureRoom) clearRoomKey(roomId)
            startNukeThenNavigate("/?destroyed=true", "local", "destroy")
        },
        onError: () => {
            isDestroyingRef.current = false
        }
    })

    const { mutate: requestDestroy } = useMutation({
        mutationFn: async () => {
            setDestroyRequestPending(true)
            await client.room["request-destroy"].post({
                requesterId: requesterClientIdRef.current,
                requesterName: username,
            }, { query: { roomId } })
        },
        onSuccess: () => {
            toast.success("Destroy request sent to room creator", {
                style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
                duration: 3000,
            })
        },
        onError: () => {
            setDestroyRequestPending(false)
            toast.error("Failed to send destroy request", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        }
    })

    const { mutate: approveDestroy } = useMutation({
        mutationFn: async () => {
            isDestroyingRef.current = true
            setShowDestroyRequest(false)
            setPendingDestroyRequester(null)
            await client.room["approve-destroy"].post(null, { query: { roomId } })
        },
        onSuccess: () => {
            if (isSecureRoom) clearRoomKey(roomId)
            startNukeThenNavigate("/?destroyed=true", "local", "destroy")
        },
        onError: () => {
            isDestroyingRef.current = false
        }
    })

    const { mutate: denyDestroy } = useMutation({
        mutationFn: async (/** @type {string} */ requesterId) => {
            setShowDestroyRequest(false)
            setPendingDestroyRequester(null)
            await client.room["deny-destroy"].post({ requesterId }, { query: { roomId } })
        },
    })

    const { mutate: extendTimer } = useMutation({
        mutationFn: async (/** @type {number} */ minutes) => {
            setShowExtendPopover(false)
            await client.room["extend-timer"].post({ minutes }, { query: { roomId } })
        },
        onError: () => {
            toast.error("Failed to extend timer", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        }
    })

    const { mutate: triggerPanic } = useMutation({
        mutationFn: async (/** @type {string} */ panicPassword) => {
            isDestroyingRef.current = true
            setShowPanicModal(false)
            setPanicInput("")
            await client.room.panic.post({ panicPassword }, { query: { roomId } })
        },
        onSuccess: () => {
            if (userRole === "creator") {
                if (isSecureRoom) clearRoomKey(roomId)
                startNukeThenNavigate("/?error=room-not-found", "local", "panic")
                return
            }
            if (isSecureRoom) clearRoomKey(roomId)
            router.push("/?error=room-not-found")
        },
        onError: () => {
            isDestroyingRef.current = false
            toast.error("Invalid panic password", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        }
    })

    const { mutate: leaveRoom, isPending: isLeavingRoom } = useMutation({
        mutationFn: async () => {
            await client.room.exit.post(null, { query: { roomId } })
        },
        onSuccess: () => {
            if (isSecureRoom) clearRoomKey(roomId)
            startNukeThenNavigate("/", "local", "exit")
        },
        onError: () => {
            toast.error("Failed to exit room", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        },
    })

    /** Emit a signaling event via the relay API */
    const emitSignal = useCallback(async (/** @type {string} */ evt, /** @type {any} */ payload) => {
        try {
            await fetch(`/api/realtime/emit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel: roomId, event: evt, data: payload }),
            })
        } catch { /* ignore relay errors */ }
    }, [roomId])

    const cancelOutgoingTransfers = useCallback(async () => {
        const senders = Array.from(activeSendersRef.current.values())
        if (senders.length === 0) return

        await Promise.allSettled(senders.map(async (sender) => {
            const senderInternal = /** @type {any} */ (sender)
            if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
            senderInternal._offerTimeout = null
            await sender.cancel("Transfer cancelled by sender")
        }))

        activeSendersRef.current.clear()
        setTransferState((s) => ({ ...s, status: "cancelled" }))
        setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 2000)
        toast("File transfer cancelled", {
            icon: "⏹",
            style: { background: "#18181b", color: "#fbbf24", border: "1px solid #78350f" },
            duration: 2500,
        })
    }, [])

    useEffect(() => {
        if (!roomId || !username) return

        const clientId = presenceClientIdRef.current
        const announce = () => {
            emitSignal("presence.announce", {
                clientId,
                username,
                timestamp: Date.now(),
            })
        }
        const requestSync = () => {
            emitSignal("presence.request", {
                clientId,
                username,
                timestamp: Date.now(),
            })
        }

        setPresenceMap((prev) => ({
            ...prev,
            [clientId]: { username, lastSeen: Date.now() },
        }))

        announce()
        requestSync()

        // Retry presence discovery for late joiners (realtime subscription may not be ready yet)
        const retry1 = setTimeout(requestSync, 1000)
        const retry2 = setTimeout(requestSync, 3000)

        const heartbeatTimer = setInterval(announce, PRESENCE_HEARTBEAT_MS)
        const pruneTimer = setInterval(() => {
            const cutoff = Date.now() - PRESENCE_TTL_MS
            setPresenceMap((prev) => {
                let changed = false
                const next = {}
                for (const [id, participant] of Object.entries(prev)) {
                    const isSelf = id === clientId
                    if (isSelf || (participant?.lastSeen ?? 0) >= cutoff) {
                        next[id] = participant
                    } else {
                        changed = true
                    }
                }
                return changed ? next : prev
            })
        }, 5000)

        const onBeforeUnload = () => {
            try {
                if (typeof navigator.sendBeacon !== "function") return
                const payload = JSON.stringify({
                    channel: roomId,
                    event: "presence.leave",
                    data: { clientId, username, timestamp: Date.now() },
                })
                navigator.sendBeacon("/api/realtime/emit", new Blob([payload], { type: "application/json" }))
            } catch {
                // Ignore unload transport failures.
            }
        }

        window.addEventListener("beforeunload", onBeforeUnload)
        return () => {
            clearTimeout(retry1)
            clearTimeout(retry2)
            clearInterval(heartbeatTimer)
            clearInterval(pruneTimer)
            window.removeEventListener("beforeunload", onBeforeUnload)
            emitSignal("presence.leave", {
                clientId,
                username,
                timestamp: Date.now(),
            })
            setPresenceMap((prev) => {
                if (!prev[clientId]) return prev
                const next = { ...prev }
                delete next[clientId]
                return next
            })
        }
    }, [emitSignal, roomId, username])

    /** Send a file to selected peers via WebRTC */
    const handleSendFile = useCallback(async (/** @type {File} */ file, /** @type {string[]} */ targets) => {
        const uniqueTargets = Array.from(new Set((targets || []).filter((target) => target && target !== username)))
        if (uniqueTargets.length === 0) {
            toast.error("No recipients selected", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }

        setTransferState({ status: "waiting", progress: 0, filename: file.name, direction: "send" })
        toast.success(`File offer sent to ${uniqueTargets.length} participant${uniqueTargets.length === 1 ? "" : "s"}`, {
            style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
            duration: 2500,
        })

        for (const target of uniqueTargets) {
            const sender = new FileSender({ file, roomId, username, to: target, emitSignal })
            const senderInternal = /** @type {any} */ (sender)
            activeSendersRef.current.set(sender.offerId, sender)

            sender.onProgress = (p) => setTransferState((s) => ({ ...s, progress: p, status: "active" }))
            sender.onComplete = () => {
                if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
                senderInternal._offerTimeout = null
                activeSendersRef.current.delete(sender.offerId)
                toast.success(`Delivered to ${target}`, {
                    style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
                    duration: 2500,
                })
                if (activeSendersRef.current.size === 0) {
                    setTransferState({ status: "complete", progress: 1, filename: file.name, direction: "send" })
                    setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 3000)
                }
            }
            sender.onCancel = () => {
                if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
                senderInternal._offerTimeout = null
                activeSendersRef.current.delete(sender.offerId)
            }
            sender.onError = () => {
                if (senderInternal._offerTimeout) clearTimeout(senderInternal._offerTimeout)
                senderInternal._offerTimeout = null
                activeSendersRef.current.delete(sender.offerId)
                setTransferState((s) => ({ ...s, status: "error" }))
                if (activeSendersRef.current.size === 0) {
                    setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 3000)
                }
            }

            senderInternal._offerTimeout = setTimeout(() => {
                if (!activeSendersRef.current.has(sender.offerId)) return
                sender.cleanup()
                activeSendersRef.current.delete(sender.offerId)
                toast.error(`No response from ${target}`, {
                    style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
                    duration: 3500,
                })
                if (activeSendersRef.current.size === 0) {
                    setTransferState({ status: "idle", progress: 0, filename: "", direction: "" })
                }
            }, 45000)

            // Step 1: Send metadata offer only — connection starts on receiver acceptance
            await sender.sendOffer()
        }
    }, [roomId, username, emitSignal])

    /** Accept an incoming file offer */
    const handleAcceptFile = useCallback(async (/** @type {any} */ offer) => {
        if (activeReceiversRef.current.has(offer.offerId)) return
        if (cancelledOfferIdsRef.current.has(offer.offerId)) {
            toast.error("Sender cancelled this transfer", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }
        cancelledOfferIdsRef.current.delete(offer.offerId)
        pendingOfferToastIdsRef.current.delete(offer.offerId)

        const receiver = new FileReceiver({
            offerId: offer.offerId,
            filename: offer.filename,
            fileSize: offer.fileSize,
            fileType: offer.fileType,
            username,
            from: offer.from,
            emitSignal,
        })

        const shouldStreamToDisk = (offer.fileSize || 0) >= DISK_STREAM_THRESHOLD_BYTES
        if (shouldStreamToDisk) {
            try {
                const usesDiskStream = await receiver.prepareWritableTarget()
                if (usesDiskStream) {
                    toast.success("Large file will stream directly to disk", {
                        style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
                        duration: 3000,
                    })
                }
            } catch {
                // User dismissed the save dialog for this large transfer.
                await emitSignal("file.reject", {
                    offerId: offer.offerId,
                    from: username,
                    to: offer.from,
                })
                return
            }
        }

        activeReceiversRef.current.set(offer.offerId, receiver)
        setTransferState({ status: "waiting", progress: 0, filename: offer.filename, direction: "receive" })

        receiver.onProgress = (p) => setTransferState(s => ({ ...s, progress: p, status: "active" }))
        receiver.onComplete = () => {
            setTransferState(s => ({ ...s, progress: 1, status: "complete" }))
            setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 3000)
            activeReceiversRef.current.delete(offer.offerId)
        }
        receiver.onError = () => {
            setTransferState(s => ({ ...s, status: "error" }))
            setTimeout(() => setTransferState({ status: "idle", progress: 0, filename: "", direction: "" }), 3000)
            activeReceiversRef.current.delete(offer.offerId)
        }
        receiver.onCancel = () => {
            activeReceiversRef.current.delete(offer.offerId)
        }

        // Step 2: Tell the sender "I accept — go ahead and create your connection"
        await receiver.sendAccepted()
    }, [username, emitSignal])

    const copyLink = () => {
        if (!roomId) return
        navigator.clipboard.writeText(roomId)
        setIsCopied(true)

        if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current)

        copyResetTimeoutRef.current = setTimeout(() => {
            setIsCopied(false)
        }, 3000)
    }

    const sendMessage = () => {
        const text = input.trim()
        if (!text || !roomId) return

        mutate({ text, ...(vanishAfter > 0 ? { vanishAfter } : {}) })
        setSendFxId((prev) => prev + 1)
        setIsSendFxActive(true)
        if (sendFxTimeoutRef.current) clearTimeout(sendFxTimeoutRef.current)
        sendFxTimeoutRef.current = setTimeout(() => {
            setIsSendFxActive(false)
        }, 980)
        setInput("")
        inputRef.current?.focus()
    }

    const cleanupRecording = useCallback(() => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(t => t.stop())
            audioStreamRef.current = null
        }
        mediaRecorderRef.current = null
        audioChunksRef.current = []
        setRecordingDuration(0)
        setIsRecording(false)
    }, [])

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            audioStreamRef.current = stream
            audioChunksRef.current = []

            // Prefer webm/opus, fall back to whatever the browser supports
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/webm")
                    ? "audio/webm"
                    : ""
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            mediaRecorderRef.current = recorder

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data)
            }

            recorder.onstop = () => {
                const chunks = audioChunksRef.current
                if (chunks.length === 0) {
                    cleanupRecording()
                    return
                }
                const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" })
                const reader = new FileReader()
                reader.onloadend = () => {
                    const dataUrl = /** @type {string} */ (reader.result)
                    if (dataUrl && typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
                        mutate({ text: dataUrl, type: "audio", ...(vanishAfter > 0 ? { vanishAfter } : {}) })
                        setSendFxId((prev) => prev + 1)
                        setIsSendFxActive(true)
                        if (sendFxTimeoutRef.current) clearTimeout(sendFxTimeoutRef.current)
                        sendFxTimeoutRef.current = setTimeout(() => setIsSendFxActive(false), 980)
                    }
                    cleanupRecording()
                }
                reader.onerror = () => {
                    toast.error("Failed to encode audio", { duration: 2500 })
                    cleanupRecording()
                }
                reader.readAsDataURL(blob)
            }

            recorder.onerror = () => {
                toast.error("Recording error", { duration: 2500 })
                cleanupRecording()
            }

            recorder.start(250) // collect chunks every 250ms
            setIsRecording(true)
            setRecordingDuration(0)
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration(d => d + 1)
            }, 1000)
        } catch (err) {
            const message = err instanceof Error ? err.message : "Microphone access denied"
            toast.error(message, { duration: 3000 })
            cleanupRecording()
        }
    }, [cleanupRecording, mutate, vanishAfter])

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop()
        }
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current)
            recordingTimerRef.current = null
        }
        if (audioStreamRef.current) {
            audioStreamRef.current.getTracks().forEach(t => t.stop())
            audioStreamRef.current = null
        }
    }, [])

    const cancelRecording = useCallback(() => {
        if (mediaRecorderRef.current) {
            // Detach onstop so it doesn't send
            mediaRecorderRef.current.onstop = null
            if (mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop()
            }
        }
        cleanupRecording()
    }, [cleanupRecording])

    const handleVanishMessage = useCallback((msgId) => {
        setVanishedIds(prev => {
            const next = new Set(prev)
            next.add(msgId)
            return next
        })
    }, [])

    const clearStegoImage = useCallback(() => {
        if (stegoObjectUrlRef.current && typeof window !== "undefined") {
            URL.revokeObjectURL(stegoObjectUrlRef.current)
            stegoObjectUrlRef.current = ""
        }
        setStegoImage(null)
        if (stegoFileRef.current) stegoFileRef.current.value = ""
    }, [])

    const closeStegoModal = useCallback(() => {
        setShowStegoModal(false)
        clearStegoImage()
        setStegoSecret("")
        setStegoSecretImage(null)
        setStegoMode("text")
        setStegoDecodeResult(null)
    }, [clearStegoImage])

    // Compress secret image: resize to max 400px, JPEG 60%
    const compressImage = useCallback((dataUrl) => {
        return new Promise((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
                const maxDim = 400
                let w = img.width, h = img.height
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round(h * maxDim / w); w = maxDim }
                    else { w = Math.round(w * maxDim / h); h = maxDim }
                }
                const canvas = document.createElement("canvas")
                canvas.width = w
                canvas.height = h
                const ctx = canvas.getContext("2d")
                ctx.drawImage(img, 0, 0, w, h)
                resolve(canvas.toDataURL("image/jpeg", 0.6))
            }
            img.onerror = () => reject(new Error("Failed to compress image"))
            img.src = dataUrl
        })
    }, [])

    const blobToDataUrl = useCallback((blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => reject(new Error("Failed to read image data"))
            reader.readAsDataURL(blob)
        })
    }, [])

    const sendStegoMessage = useCallback(async () => {
        const secretPayload = stegoMode === "image" ? stegoSecretImage : stegoSecret.trim()
        if (!stegoImage || !secretPayload || stegoEncoding) return
        setStegoEncoding(true)
        try {
            if (isSecureRoom) {
                if (!secureRoomKey) {
                    throw new Error("Secure room key is missing")
                }

                const recipients = participants.filter((p) => p && p !== username)
                if (recipients.length === 0) {
                    throw new Error("Recipient unavailable for WebRTC transfer")
                }

                if (!isRds3WorkerSupported()) {
                    throw new Error("Secure stego requires Worker + OffscreenCanvas + createImageBitmap + WebCrypto support.")
                }

                const coverBlob = await fetch(stegoImage).then((res) => res.blob())
                const encryptedSecretEnvelope = await encryptJsonEnvelope(secureRoomKey, {
                    mode: stegoMode,
                    payload: secretPayload,
                    timestamp: Date.now(),
                }, "stego.payload")

                const encoded = await encodeRds3StegoPng({
                    coverFile: coverBlob,
                    roomKeyHex: secureRoomKey,
                    secretMeta: {
                        codec: "rds3",
                        v: encryptedSecretEnvelope.v,
                        kind: encryptedSecretEnvelope.kind,
                        ivHex: encryptedSecretEnvelope.ivHex,
                        aadHex: encryptedSecretEnvelope.aadHex || "",
                        createdAt: encryptedSecretEnvelope.createdAt,
                    },
                    secretCipherHex: encryptedSecretEnvelope.cipherHex,
                })
                const pngBlob = encoded.pngBlob
                if (!pngBlob || pngBlob.size <= 0) {
                    throw new Error("Stego encoding failed")
                }

                const stegoFile = new File([pngBlob], `stego-${Date.now()}.png`, { type: "image/png" })
                await handleSendFile(stegoFile, recipients)
                mutate({
                    text: `[secure stego sent via p2p to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}]`,
                    ...(vanishAfter > 0 ? { vanishAfter } : {}),
                })

                setSendFxId((prev) => prev + 1)
                setIsSendFxActive(true)
                if (sendFxTimeoutRef.current) clearTimeout(sendFxTimeoutRef.current)
                sendFxTimeoutRef.current = setTimeout(() => setIsSendFxActive(false), 980)
                closeStegoModal()
                toast.success("Stego PNG encoded and sent via P2P", { duration: 2500 })
                return
            }

            const { encodeMessage, decodeMessage } = await import("@/lib/stego")
            const encoded = await encodeMessage(stegoImage, secretPayload)
            const verified = await decodeMessage(encoded)
            if (verified !== secretPayload) {
                throw new Error("Stego verification failed. Try a larger PNG cover image or smaller secret payload.")
            }
            mutate({ text: encoded, type: "stego", ...(vanishAfter > 0 ? { vanishAfter } : {}) })
            setSendFxId((prev) => prev + 1)
            setIsSendFxActive(true)
            if (sendFxTimeoutRef.current) clearTimeout(sendFxTimeoutRef.current)
            sendFxTimeoutRef.current = setTimeout(() => setIsSendFxActive(false), 980)
            closeStegoModal()
            toast.success("Stego image sent!", { duration: 2000 })
        } catch (err) {
            const message = err instanceof Error && err.message
                ? err.message
                : "Failed to encode stego image"
            toast.error(message, { duration: 3000 })
        } finally {
            setStegoEncoding(false)
        }
    }, [stegoImage, stegoSecret, stegoSecretImage, stegoMode, stegoEncoding, isSecureRoom, secureRoomKey, participants, username, handleSendFile, vanishAfter, mutate, closeStegoModal])

    const handleDecodeStegoFile = useCallback(async (event) => {
        const file = event.target.files?.[0]
        if (!file) return
        if (!isSecureRoom || !secureRoomKey) {
            toast.error("Secure room key is unavailable", { duration: 2500 })
            if (stegoDecodeFileRef.current) stegoDecodeFileRef.current.value = ""
            return
        }
        try {
            /** @type {any | null} */
            let decrypted = null
            /** @type {Error | null} */
            let latestError = null

            // 1) RDS3 seeded-lossless decode (current format)
            try {
                const extractedRds3 = await decodeRds3StegoPng({
                    stegoFile: file,
                    roomKeyHex: secureRoomKey,
                })
                if (!extractedRds3.crcOk) {
                    throw new Error("RDS3 integrity check failed")
                }
                const ivHex = typeof extractedRds3.secretMeta?.ivHex === "string" ? extractedRds3.secretMeta.ivHex : ""
                if (!ivHex) {
                    throw new Error("RDS3 payload metadata missing ivHex")
                }
                decrypted = await decryptJsonEnvelope(secureRoomKey, {
                    ivHex,
                    cipherHex: extractedRds3.secretCipherHex,
                })
            } catch (error) {
                latestError = error instanceof Error ? error : new Error("RDS3 decode failed")
            }

            // 2) RDS2 deterministic-lossless decode (legacy secure format)
            if (!decrypted) {
                try {
                    const extracted = await extractLosslessStegoPayload(file)
                    const ivHex = typeof extracted.secretMeta?.ivHex === "string" ? extracted.secretMeta.ivHex : ""
                    if (!ivHex) {
                        throw new Error("Stego payload metadata missing ivHex")
                    }
                    decrypted = await decryptJsonEnvelope(secureRoomKey, {
                        ivHex,
                        cipherHex: extracted.secretCipherHex,
                    })
                } catch (error) {
                    latestError = error instanceof Error ? error : new Error("RDS2 decode failed")
                }
            }

            // 3) Legacy inline STEG decode (historical compatibility)
            if (!decrypted) {
                try {
                    const imageDataUrl = /** @type {string} */ (await blobToDataUrl(file))
                    const { decodeMessage } = await import("@/lib/stego")
                    const hidden = await decodeMessage(imageDataUrl)
                    if (hidden && hidden.length > 0) {
                        decrypted = {
                            mode: "text",
                            payload: hidden,
                            legacy: true,
                        }
                    }
                } catch (error) {
                    latestError = error instanceof Error ? error : new Error("Legacy decode failed")
                }
            }

            if (!decrypted) {
                throw latestError || new Error("No hidden payload found")
            }

            setStegoDecodeResult(decrypted)
            toast.success("Stego payload decoded", { duration: 2200 })
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to decode stego file"
            toast.error(message, { duration: 3000 })
        } finally {
            if (stegoDecodeFileRef.current) stegoDecodeFileRef.current.value = ""
        }
    }, [blobToDataUrl, isSecureRoom, secureRoomKey])

    const handleStegoSecretImageSelect = useCallback(async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file", { duration: 2000 })
            return
        }
        try {
            const reader = new FileReader()
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result)
                reader.onerror = reject
                reader.readAsDataURL(file)
            })
            const compressed = await compressImage(dataUrl)
            setStegoSecretImage(compressed)
        } catch {
            toast.error("Failed to load secret image", { duration: 2000 })
        }
        if (stegoSecretFileRef.current) stegoSecretFileRef.current.value = ""
    }, [compressImage])

    const handleStegoImageSelect = useCallback((e) => {
        const file = e.target.files?.[0]
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file", { duration: 2000 })
            if (stegoFileRef.current) stegoFileRef.current.value = ""
            return
        }
        const objectUrl = URL.createObjectURL(file)
        const img = new Image()
        img.decoding = "async"
        img.onload = () => {
            clearStegoImage()
            stegoObjectUrlRef.current = objectUrl
            setStegoImage(objectUrl)
        }
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl)
            toast.error("Unable to load image. Please use PNG, JPG, or WebP.", { duration: 3000 })
        }
        img.src = objectUrl
        if (stegoFileRef.current) stegoFileRef.current.value = ""
    }, [clearStegoImage])

    const listRef = useListRef(null)
    const hasInput = input.trim().length > 0

    // Filter out vanished messages
    const visibleMessages = useMemo(() => {
        if (!currentMessages || vanishedIds.size === 0) return currentMessages || []
        return currentMessages.filter(m => !vanishedIds.has(m.id))
    }, [currentMessages, vanishedIds])

    // Estimate row height based on message text length
    const getRowHeight = useCallback((index) => {
        const msg = visibleMessages?.[index]
        if (!msg) return 72
        if (msg.type === "stego") return 360 // image + reveal area
        if (msg.type === "audio") return 80 // voice note player
        const charsPerLine = 60
        const lineCount = Math.ceil(msg.text.length / charsPerLine)
        return Math.max(72, 48 + lineCount * 22)
    }, [visibleMessages])

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        const count = visibleMessages?.length ?? 0
        if (count > 0 && listRef.current) {
            listRef.current.scrollToRow({ index: count - 1, align: "end" })
        }
    }, [visibleMessages, listRef])


    return (
        <main data-nuke-source="room" className="scanline-bg flex flex-col h-screen max-h-screen overflow-hidden bg-black relative">

            {/* Particle grid background */}
            <CyberCanvas opacity={0.42} density={0.6} />

            {/* ═══════════════════ HEADER ═══════════════════ */}
            <motion.header
                data-nuke-el="header"
                className="w-full border-b border-zinc-700/30 glass relative z-10"
                initial={{ opacity: 0, y: -24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease }}
            >

                {/* ── Top Row: Identity | Title | Timer ── */}
                <div className="w-full px-3 py-2 sm:px-5 sm:py-3">
                    <div className="flex flex-col gap-2 md:gap-0 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">

                        {/* Mobile: Title first row */}
                        <div className="flex items-center justify-between md:hidden">
                            <motion.div
                                className="text-center flex-1"
                                initial={{ opacity: 0, scale: 0.92 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.5, delay: 0.1, ease }}
                            >
                                <Link href="/" className="group">
                                    <motion.h1
                                        className="text-lg font-bold tracking-tight text-green-500 animate-flicker"
                                        whileHover={{ textShadow: "0 0 12px rgba(34,197,94,0.4)" }}
                                    >
                                        {">"}redacted.chat
                                    </motion.h1>
                                </Link>
                            </motion.div>
                        </div>

                        {/* Mobile: Identity + Timer row */}
                        <div className="flex items-center justify-between gap-2 md:hidden">
                            {/* Identity badge — compact on mobile */}
                            <motion.div
                                className="flex items-center gap-2 border border-green-900/40 rounded-sm px-2.5 py-1.5 min-w-0 flex-shrink group"
                                initial={{ opacity: 0, x: -24 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5, delay: 0.15, ease }}
                            >
                                <div className="shrink-0 w-8 h-8 rounded-full bg-green-950/30 border border-green-500/30 flex items-center justify-center">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                                        <path d="M12 6a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
                                        <path d="M5.5 18.5c1.5-2.5 3.8-3.5 6.5-3.5s5 1 6.5 3.5" />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[9px] uppercase tracking-widest text-green-500/70 font-bold">Identity</p>
                                    <p className="text-xs font-bold text-green-400 truncate max-w-[120px]">{username || "anonymous"}</p>
                                </div>
                            </motion.div>

                            {/* Timer — compact on mobile */}
                            <motion.div
                                className="flex items-center gap-1.5 border border-zinc-700/50 rounded-sm px-2 py-1.5 shrink-0"
                                initial={{ opacity: 0, x: 24 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5, delay: 0.15, ease }}
                            >
                                <div className="text-center">
                                    <p className="text-[8px] uppercase tracking-widest text-zinc-500 font-bold">Timer</p>
                                    <div className={`text-[13px] font-bold tracking-wider tabular-nums flex justify-center ${timeRemaining === -1
                                        ? "text-green-400"
                                        : timeRemaining !== null && timeRemaining < 60
                                            ? "text-red-500 animate-pulse-glow"
                                            : "text-amber-400"
                                        }`}>
                                        {timeRemaining === -1 ? (
                                            <span className="text-[11px] tracking-widest">∞</span>
                                        ) : timeRemaining !== null && timeRemaining >= 0 ? (
                                            <span>{formatTimeRemaining(timeRemaining)}</span>
                                        ) : (
                                            <span>--:--</span>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        </div>

                        {/* Mobile: Action buttons row */}
                        <div className="flex items-center justify-center gap-1.5 flex-wrap md:hidden">
                            {userRole === "creator" && timeRemaining !== -1 && timeRemaining !== null && (
                                <div className="relative">
                                    <motion.button
                                        onClick={() => setShowExtendPopover(!showExtendPopover)}
                                        className="flex items-center gap-1 border border-green-900/40 bg-green-950/30 hover:bg-green-900/40 px-2 py-1.5 rounded-sm text-[10px] font-bold text-green-400 transition-colors"
                                        whileTap={{ scale: 0.95 }}
                                    >
                                        ⏱
                                    </motion.button>
                                    <AnimatePresence>
                                        {showExtendPopover && (
                                            <motion.div
                                                className="absolute top-full right-0 mt-1 z-50 border border-zinc-700/60 bg-zinc-950 rounded-sm p-2 shadow-2xl min-w-[140px]"
                                                initial={{ opacity: 0, y: -5 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: -5 }}
                                                transition={{ duration: 0.15 }}
                                            >
                                                <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mb-1.5">Add time</p>
                                                {[5, 10, 15, 30].map((m) => (
                                                    <button
                                                        key={m}
                                                        onClick={() => extendTimer(m)}
                                                        className="block w-full text-left px-2 py-1.5 text-xs text-zinc-300 hover:text-green-400 hover:bg-zinc-800/50 rounded-sm transition-colors font-mono"
                                                    >
                                                        +{m} min
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                            <motion.button
                                onClick={() => setShowPanicModal(true)}
                                disabled={isNukeRunning}
                                className="flex items-center border border-red-900/40 bg-red-950/20 hover:bg-red-900/30 px-2 py-1.5 rounded-sm text-[11px] font-bold text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                whileTap={{ scale: 0.95 }}
                            >
                                🚨
                            </motion.button>
                            {userRole === "creator" ? (
                                <motion.button
                                    onClick={(event) => {
                                        setNukeOriginFromTrigger(event.currentTarget)
                                        destroyRoom()
                                    }}
                                    disabled={isNukeRunning}
                                    data-nuke-origin="destroy"
                                    className="flex items-center gap-1 border border-red-900/60 bg-red-950/40 hover:bg-red-900/50 px-2.5 py-1.5 rounded-sm text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors hover-shake disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.94 }}
                                >
                                    💣 <span className="hidden xs:inline">DESTROY</span>
                                </motion.button>
                            ) : (
                                <motion.button
                                    onClick={() => requestDestroy()}
                                    disabled={destroyRequestPending || isNukeRunning}
                                    className="flex items-center gap-1 border border-amber-900/60 bg-amber-950/40 hover:bg-amber-900/50 px-2.5 py-1.5 rounded-sm text-[11px] font-bold text-amber-400 hover:text-amber-300 transition-colors hover-shake disabled:opacity-50 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.94 }}
                                >
                                    ⚠️ <span className="hidden xs:inline">{destroyRequestPending ? "PENDING" : "REQUEST"}</span>
                                </motion.button>
                            )}
                            {userRole !== "creator" && (
                                <motion.button
                                    onClick={() => leaveRoom()}
                                    disabled={isNukeRunning || isLeavingRoom}
                                    className="flex items-center gap-1 border border-zinc-700/60 bg-zinc-900/50 hover:bg-zinc-800/60 px-2.5 py-1.5 rounded-sm text-[11px] font-bold text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.94 }}
                                >
                                    ↩ <span className="hidden xs:inline">EXIT</span>
                                </motion.button>
                            )}
                        </div>

                        {/* Desktop: Left — Identity Badge */}
                        <motion.div
                            className="hidden md:flex items-center gap-4 border border-green-900/40 rounded-sm px-4 py-1.5 max-w-[280px] group"
                            initial={{ opacity: 0, x: -24 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.15, ease }}
                            whileHover={{ borderColor: "rgba(34, 197, 94, 0.4)" }}
                        >
                            <motion.div
                                className="shrink-0 w-11 h-11 rounded-full bg-green-950/30 border border-green-500/30 flex items-center justify-center"
                                whileHover={{ scale: 1.08 }}
                                transition={{ type: "spring", stiffness: 400, damping: 20 }}
                            >
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                                    <path d="M12 6a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
                                    <path d="M5.5 18.5c1.5-2.5 3.8-3.5 6.5-3.5s5 1 6.5 3.5" />
                                </svg>
                            </motion.div>
                            <div className="min-w-0">
                                <p className="text-[11px] uppercase tracking-widest text-green-500/70 font-bold">Identity</p>
                                <p className="text-sm font-bold text-green-400 truncate group-hover:text-green-300 transition-colors duration-300">{username || "anonymous"}</p>
                            </div>
                        </motion.div>

                        {/* Desktop: Center — Title */}
                        <motion.div
                            className="hidden md:block text-center md:justify-self-center"
                            initial={{ opacity: 0, scale: 0.92 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.1, ease }}
                        >
                            <Link href="/" className="group">
                                <motion.h1
                                    className="text-xl sm:text-2xl font-bold tracking-tight text-green-500 animate-flicker"
                                    whileHover={{ textShadow: "0 0 12px rgba(34,197,94,0.4)" }}
                                >
                                    {">"}redacted.chat
                                </motion.h1>
                                <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mt-0.5 group-hover:text-zinc-400 transition-colors">Secure Encrypted Communication</p>
                            </Link>
                        </motion.div>

                        {/* Desktop: Right — Action stack */}
                        <motion.div
                            className="hidden md:flex flex-col items-end gap-2 md:justify-self-end"
                            initial={{ opacity: 0, x: 24 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.5, delay: 0.15, ease }}
                        >
                            <div className="flex items-center gap-2">
                                <motion.button
                                    onClick={() => setShowPanicModal(true)}
                                    disabled={isNukeRunning}
                                    className="flex items-center gap-1 border border-red-900/40 bg-red-950/20 hover:bg-red-900/30 px-2 py-1.5 rounded-sm text-[11px] font-bold text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                    title="Panic Mode — instantly destroy room"
                                >
                                    🚨
                                </motion.button>
                                {userRole === "creator" ? (
                                    <motion.button
                                        onClick={(event) => {
                                            setNukeOriginFromTrigger(event.currentTarget)
                                            destroyRoom()
                                        }}
                                        disabled={isNukeRunning}
                                        data-nuke-origin="destroy"
                                        className="flex items-center gap-1.5 border border-red-900/60 bg-red-950/40 hover:bg-red-900/50 px-3 py-2 rounded-sm text-[13px] font-bold text-red-400 hover:text-red-300 transition-colors group hover-shake disabled:opacity-40 disabled:cursor-not-allowed"
                                        whileTap={{ scale: 0.94 }}
                                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                    >
                                        <motion.span
                                            className="text-sm"
                                            animate={{ rotate: [0, 0, 0] }}
                                            whileHover={{ rotate: [0, -10, 10, -5, 5, 0] }}
                                            transition={{ duration: 0.5 }}
                                        >
                                            💣
                                        </motion.span>
                                        <span className="hidden sm:inline">DESTROY NOW</span>
                                    </motion.button>
                                ) : (
                                    <>
                                        <motion.button
                                            onClick={() => requestDestroy()}
                                            disabled={destroyRequestPending || isNukeRunning}
                                            className="flex items-center gap-1.5 border border-amber-900/60 bg-amber-950/40 hover:bg-amber-900/50 px-3 py-2 rounded-sm text-[13px] font-bold text-amber-400 hover:text-amber-300 transition-colors group hover-shake disabled:opacity-50 disabled:cursor-not-allowed"
                                            whileTap={{ scale: 0.94 }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            <motion.span
                                                className="text-sm"
                                                animate={{ rotate: [0, 0, 0] }}
                                                whileHover={{ rotate: [0, -10, 10, -5, 5, 0] }}
                                                transition={{ duration: 0.5 }}
                                            >
                                                ⚠️
                                            </motion.span>
                                            <span className="hidden sm:inline">{destroyRequestPending ? "PENDING..." : "REQUEST DESTROY"}</span>
                                        </motion.button>
                                        <motion.button
                                            onClick={() => leaveRoom()}
                                            disabled={isNukeRunning || isLeavingRoom}
                                            className="flex items-center gap-1.5 border border-zinc-700/70 bg-zinc-900/60 hover:bg-zinc-800/70 px-3 py-2 rounded-sm text-[12px] font-bold text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            whileTap={{ scale: 0.94 }}
                                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                        >
                                            ↩ <span className="hidden sm:inline">EXIT ROOM</span>
                                        </motion.button>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center gap-3 border border-zinc-700/50 rounded-sm px-3 py-2.5">
                                <div className="text-center">
                                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Self Destruct</p>
                                    <div className={`text-[15px] font-bold tracking-wider tabular-nums flex justify-center ${timeRemaining === -1
                                        ? "text-green-400"
                                        : timeRemaining !== null && timeRemaining < 60
                                            ? "text-red-500 animate-pulse-glow"
                                            : "text-amber-400"
                                        }`}>
                                        {timeRemaining === -1 ? (
                                            <span className="text-[13px] tracking-widest">∞ PERMANENT</span>
                                        ) : timeRemaining !== null && timeRemaining >= 0 ? (
                                            formatTimeRemaining(timeRemaining).split('').map((char, i) => (
                                                <div key={i} className="relative overflow-hidden inline-flex w-[1ch] justify-center">
                                                    <AnimatePresence mode="popLayout">
                                                        <motion.span
                                                            key={`${i}-${char}`}
                                                            initial={{ y: "-100%", opacity: 0 }}
                                                            animate={{ y: 0, opacity: 1 }}
                                                            exit={{ y: "100%", opacity: 0 }}
                                                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                                            className="inline-block relative"
                                                        >
                                                            {char}
                                                        </motion.span>
                                                    </AnimatePresence>
                                                </div>
                                            ))
                                        ) : (
                                            <span>--:--</span>
                                        )}
                                    </div>
                                </div>
                                {userRole === "creator" && timeRemaining !== -1 && timeRemaining !== null && (
                                    <div className="relative">
                                        <motion.button
                                            onClick={() => setShowExtendPopover(!showExtendPopover)}
                                            className="flex items-center gap-1 border border-green-900/40 bg-green-950/30 hover:bg-green-900/40 px-2 py-1.5 rounded-sm text-[11px] font-bold text-green-400 hover:text-green-300 transition-colors"
                                            whileTap={{ scale: 0.95 }}
                                        >
                                            ⏱ EXTEND
                                        </motion.button>
                                        <AnimatePresence>
                                            {showExtendPopover && (
                                                <motion.div
                                                    className="absolute top-full right-0 mt-1 z-50 border border-zinc-700/60 bg-zinc-950 rounded-sm p-2 shadow-2xl min-w-[140px]"
                                                    initial={{ opacity: 0, y: -5 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -5 }}
                                                    transition={{ duration: 0.15 }}
                                                >
                                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mb-1.5">Add time</p>
                                                    {[5, 10, 15, 30].map((m) => (
                                                        <button
                                                            key={m}
                                                            onClick={() => extendTimer(m)}
                                                            className="block w-full text-left px-2 py-1.5 text-xs text-zinc-300 hover:text-green-400 hover:bg-zinc-800/50 rounded-sm transition-colors font-mono"
                                                        >
                                                            +{m} min
                                                        </button>
                                                    ))}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    </div>
                </div>

                {/* ── Sub-header: Room ID ── */}
                <motion.div
                    className="flex justify-center pb-3 px-3"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.25, ease }}
                >
                    <div className="flex items-center gap-2 sm:gap-3 glass-light rounded-sm px-2.5 sm:px-4 py-2 animate-border-pulse max-w-full overflow-hidden relative">
                        <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold mt-1 shrink-0">Room ID</span>
                        <span className="text-xs sm:text-sm font-bold text-green-400 tracking-wide truncate min-w-0">{roomId}</span>
                        <motion.button
                            onClick={copyLink}
                            className="flex min-w-[88px] items-center justify-center gap-1.5 border border-zinc-700/40 bg-zinc-800/60 hover:bg-zinc-700/60 px-3 py-1 rounded-sm text-[10px] font-bold transition-colors"
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        >
                            {/* Animated icon swap: clipboard → checkmark */}
                            <AnimatePresence mode="wait">
                                {isCopied ? (
                                    <motion.svg
                                        key="check"
                                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                        className="text-green-400"
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                    </motion.svg>
                                ) : (
                                    <motion.svg
                                        key="clip"
                                        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                        className="text-zinc-400"
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.5 }}
                                        transition={{ duration: 0.15 }}
                                    >
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                    </motion.svg>
                                )}
                            </AnimatePresence>
                            <AnimatePresence mode="wait">
                                <motion.span
                                    key={isCopied ? "copied" : "copy"}
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 6 }}
                                    transition={{ duration: 0.15 }}
                                    className={isCopied ? "text-green-400" : "text-zinc-400"}
                                >
                                    {isCopied ? "COPIED!" : "COPY"}
                                </motion.span>
                            </AnimatePresence>
                        </motion.button>
                    </div>
                </motion.div>
            </motion.header>

            {/* ═══════════════════ MESSAGES AREA ═══════════════════ */}
            <div data-nuke-el="messages" className="flex-1 overflow-hidden custom-scrollbar cyber-grid-bg">

                {/* Empty state */}
                <AnimatePresence>
                    {visibleMessages.length === 0 && (
                        <motion.div
                            className="flex flex-col items-center justify-center h-full gap-5 select-none"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.5, ease }}
                        >
                            {/* Animated encryption hex visualization */}
                            <motion.div
                                className="relative"
                                animate={{ y: [0, -8, 0] }}
                                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <div className="w-20 h-20 rounded-full border border-green-500/15 bg-green-500/5 flex items-center justify-center">
                                    <div className="grid grid-cols-3 gap-1">
                                        {Array.from({ length: 9 }, (_, i) => (
                                            <motion.span
                                                key={i}
                                                className="text-[9px] font-mono text-green-500/60 w-3 text-center"
                                                animate={{ opacity: [0.2, 0.8, 0.2] }}
                                                transition={{
                                                    duration: 1.5 + Math.random(),
                                                    repeat: Infinity,
                                                    delay: i * 0.15,
                                                }}
                                            >
                                                {String.fromCharCode(48 + Math.floor(Math.random() * 42))}
                                            </motion.span>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                            <div className="text-center space-y-1.5">
                                <p className="text-zinc-500 text-sm font-mono tracking-wide">Waiting for messages...</p>
                                <p className="text-zinc-600 text-[11px]">Share the Room ID to start a secure conversation</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Messages list — virtualized with react-window */}
                {visibleMessages.length > 0 && (
                    <List
                        listRef={listRef}
                        rowCount={visibleMessages.length}
                        rowHeight={getRowHeight}
                        overscanCount={5}
                        className="custom-scrollbar"
                        style={{ height: '100%' }}
                        rowComponent={/** @type {any} */ (MessageRow)}
                        rowProps={/** @type {any} */ ({ messages: visibleMessages, username, onVanish: handleVanishMessage })}
                    />
                )}
            </div>

            {/* ═══════════════════ INPUT BAR ═══════════════════ */}
            <motion.div
                data-nuke-el="input"
                className="border-t border-zinc-800/60 bg-black p-3 sm:p-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3, ease }}
            >
                <div className="flex items-center gap-2 sm:gap-3">

                    {isRecording ? (
                        /* ── Recording mode ── */
                        <>
                            {/* Cancel recording */}
                            <motion.button
                                onClick={cancelRecording}
                                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-sm border border-zinc-700/50 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
                                whileTap={{ scale: 0.92 }}
                                title="Cancel recording"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </motion.button>

                            {/* Recording indicator */}
                            <div className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 rounded-sm border border-red-900/40 bg-red-950/10">
                                <motion.div
                                    className="w-3 h-3 rounded-full bg-red-500"
                                    animate={{ opacity: [1, 0.3, 1] }}
                                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                                />
                                <span className="text-red-400 text-sm font-mono font-bold">
                                    {Math.floor(recordingDuration / 60).toString().padStart(2, "0")}:{(recordingDuration % 60).toString().padStart(2, "0")}
                                </span>
                                <span className="text-zinc-500 text-[10px] uppercase tracking-wider font-bold">Recording...</span>
                            </div>

                            {/* Send recording */}
                            <motion.button
                                onClick={stopRecording}
                                className="shrink-0 w-10 h-10 flex items-center justify-center rounded-sm border border-green-500/40 bg-green-600/20 hover:bg-green-600/30 text-green-400 hover:text-green-300 transition-colors"
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.92 }}
                                title="Send voice message"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                </svg>
                            </motion.button>
                        </>
                    ) : (
                        /* ── Normal input mode ── */
                        <>
                            {/* ⊕ Overflow menu — reveals extra tools */}
                            <div className="relative shrink-0 lg:hidden">
                                <motion.button
                                    onClick={() => { setShowInputMenu(p => !p); setShowVanishPicker(false) }}
                                    className={`w-10 h-10 flex items-center justify-center rounded-full border transition-all duration-200 ${showInputMenu
                                        ? "bg-green-600/20 border-green-500/30 text-green-400 rotate-45"
                                        : "bg-zinc-900 border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600/60"
                                        }`}
                                    whileTap={{ scale: 0.92 }}
                                    title="More tools"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <line x1="12" y1="5" x2="12" y2="19" />
                                        <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                </motion.button>

                                {/* Active vanish indicator dot */}
                                {vanishAfter > 0 && !showInputMenu && (
                                    <motion.span
                                        className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-orange-500 border border-black"
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        exit={{ scale: 0 }}
                                    />
                                )}

                                {/* Floating tool tray */}
                                <AnimatePresence>
                                    {showInputMenu && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8, scale: 0.9 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 8, scale: 0.9 }}
                                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                                            className="absolute bottom-full mb-3 left-0 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/50 rounded-lg p-2 flex gap-1.5 z-50 shadow-xl shadow-black/40"
                                        >
                                            {/* Stego */}
                                            <motion.button
                                                onClick={() => { setShowStegoModal(true); setShowInputMenu(false) }}
                                                className="w-10 h-10 flex items-center justify-center rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-400 hover:text-purple-300 transition-colors"
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.9 }}
                                                title="Steganography"
                                            >
                                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                                    <circle cx="12" cy="12" r="3" />
                                                </svg>
                                            </motion.button>

                                            {/* Vanish timer — inline in the tray */}
                                            <div className="relative">
                                                <motion.button
                                                    onClick={() => setShowVanishPicker(p => !p)}
                                                    className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${vanishAfter > 0
                                                        ? "bg-orange-600/20 text-orange-400 hover:bg-orange-600/30"
                                                        : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40"
                                                        }`}
                                                    whileHover={{ scale: 1.1 }}
                                                    whileTap={{ scale: 0.9 }}
                                                    title={vanishAfter > 0 ? `Vanish: ${vanishAfter}s` : "Vanish timer"}
                                                >
                                                    <span className="text-sm">🔥</span>
                                                </motion.button>

                                                {/* Vanish picker popover — above the tray */}
                                                <AnimatePresence>
                                                    {showVanishPicker && (
                                                        <motion.div
                                                            initial={{ opacity: 0, y: 6, scale: 0.95 }}
                                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                                            exit={{ opacity: 0, y: 6, scale: 0.95 }}
                                                            transition={{ duration: 0.12 }}
                                                            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700/50 rounded-lg p-1.5 flex flex-col gap-0.5 z-50 min-w-[80px]"
                                                        >
                                                            {VANISH_OPTIONS.map(opt => (
                                                                <button
                                                                    key={opt}
                                                                    onClick={() => { setVanishAfter(opt); setShowVanishPicker(false) }}
                                                                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors text-left ${vanishAfter === opt
                                                                        ? "bg-orange-600/20 text-orange-400"
                                                                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                                                        }`}
                                                                >
                                                                    {opt === 0 ? "Off" : opt < 60 ? `${opt}s` : `${opt / 60}m`}
                                                                </button>
                                                            ))}
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>

                            {/* Input field */}
                            <motion.div
                                className="flex-1 min-w-0 relative rounded-full border input-focus-glow overflow-hidden"
                                animate={{
                                    borderColor: hasInput
                                        ? "rgba(34,197,94,0.4)"
                                        : "rgba(63,63,70,0.3)",
                                    boxShadow: hasInput
                                        ? "0 0 12px rgba(34,197,94,0.08)"
                                        : "0 0 0 rgba(0,0,0,0)",
                                }}
                                transition={{ duration: 0.4, ease: "easeInOut" }}
                            >
                                <motion.button
                                    onClick={() => { setShowFileSendModal(true); setShowInputMenu(false); setShowVanishPicker(false) }}
                                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-green-600/15 hover:bg-green-600/25 text-green-400 hover:text-green-300 transition-colors"
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.92 }}
                                    title="P2P File Transfer"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                                    </svg>
                                </motion.button>

                                <input
                                    ref={inputRef}
                                    value={input}
                                    onChange={(e) => { setInput(e.target.value); setShowInputMenu(false) }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && input.trim()) {
                                            sendMessage()
                                        }
                                    }}
                                    placeholder="Type a message..."
                                    autoFocus
                                    type="text"
                                    className={`w-full min-w-0 bg-zinc-950/80 py-3 pl-14 pr-5 text-sm rounded-full focus:outline-none caret-green-500 placeholder:text-zinc-600 transition-colors duration-200 ${hasInput
                                        ? "text-green-500"
                                        : "text-zinc-300"
                                        }`}
                                />
                            </motion.div>

                            {/* Desktop quick tools — visible beside input */}
                            <div className="relative hidden lg:flex items-center gap-1.5 shrink-0 rounded-xl border border-zinc-700/50 bg-zinc-900/90 p-1.5">
                                <motion.button
                                    onClick={() => { setShowStegoModal(true); setShowVanishPicker(false) }}
                                    className="w-10 h-10 flex items-center justify-center rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-400 hover:text-purple-300 transition-colors"
                                    whileHover={{ scale: 1.06 }}
                                    whileTap={{ scale: 0.92 }}
                                    title="Steganography"
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                </motion.button>

                                <div className="relative">
                                    <motion.button
                                        onClick={() => setShowVanishPicker((p) => !p)}
                                        className={`w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${vanishAfter > 0
                                            ? "bg-orange-600/20 text-orange-400 hover:bg-orange-600/30"
                                            : "bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40"
                                            }`}
                                        whileHover={{ scale: 1.06 }}
                                        whileTap={{ scale: 0.92 }}
                                        title={vanishAfter > 0 ? `Vanish: ${vanishAfter}s` : "Vanish timer"}
                                    >
                                        <span className="text-sm">🔥</span>
                                    </motion.button>

                                    <AnimatePresence>
                                        {showVanishPicker && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                                                transition={{ duration: 0.12 }}
                                                className="absolute bottom-full mb-2 right-0 bg-zinc-900 border border-zinc-700/50 rounded-lg p-1.5 flex flex-col gap-0.5 z-50 min-w-[80px]"
                                            >
                                                {VANISH_OPTIONS.map(opt => (
                                                    <button
                                                        key={opt}
                                                        onClick={() => { setVanishAfter(opt); setShowVanishPicker(false) }}
                                                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors text-left ${vanishAfter === opt
                                                            ? "bg-orange-600/20 text-orange-400"
                                                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                                                            }`}
                                                    >
                                                        {opt === 0 ? "Off" : opt < 60 ? `${opt}s` : `${opt / 60}m`}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* Right-side action: Mic ↔ Send swap */}
                            <div className="relative shrink-0 w-12 h-12">
                                <AnimatePresence mode="wait">
                                    {hasInput ? (
                                        /* Send button */
                                        <motion.button
                                            key="send-btn"
                                            onClick={sendMessage}
                                            disabled={isPending}
                                            className="absolute inset-0 flex items-center justify-center rounded-full bg-green-600 hover:bg-green-500 text-black transition-colors disabled:opacity-50 cursor-pointer"
                                            initial={{ scale: 0.6, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0.6, opacity: 0 }}
                                            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                                            whileTap={{ scale: 0.9 }}
                                        >
                                            {/* Pulse ring on send */}
                                            <AnimatePresence>
                                                {isSendFxActive && (
                                                    <motion.span
                                                        key={`send-pulse-${sendFxId}`}
                                                        className="pointer-events-none absolute inset-0 rounded-full border-2 border-green-400/60"
                                                        initial={{ scale: 1, opacity: 0.8 }}
                                                        animate={{ scale: 1.5, opacity: 0 }}
                                                        exit={{ opacity: 0 }}
                                                        transition={{ duration: 0.6 }}
                                                    />
                                                )}
                                            </AnimatePresence>
                                            <motion.span
                                                className="relative z-10"
                                                initial={false}
                                                animate={isSendFxActive
                                                    ? { x: [0, 3, 40, 40, -40, -40, 0], y: [0, -4, -30, -30, 30, 30, 0], rotate: [-12, -20, -35, -35, -6, -6, -12] }
                                                    : { x: 0, y: 0, rotate: -12 }}
                                                transition={{ duration: 0.9, times: [0, 0.15, 0.32, 0.38, 0.39, 0.65, 1], ease: "easeInOut" }}
                                            >
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <line x1="22" y1="2" x2="11" y2="13" />
                                                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                                </svg>
                                            </motion.span>
                                        </motion.button>
                                    ) : (
                                        /* Mic button */
                                        <motion.button
                                            key="mic-btn"
                                            onClick={startRecording}
                                            className="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-700/50 text-zinc-400 hover:text-green-400 hover:border-green-500/30 transition-colors cursor-pointer"
                                            initial={{ scale: 0.6, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            exit={{ scale: 0.6, opacity: 0 }}
                                            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                                            whileTap={{ scale: 0.9 }}
                                            title="Record voice message"
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                                                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                                                <line x1="12" y1="19" x2="12" y2="23" />
                                                <line x1="8" y1="23" x2="16" y2="23" />
                                            </svg>
                                        </motion.button>
                                    )}
                                </AnimatePresence>
                            </div>
                        </>
                    )}
                </div>
            </motion.div>

            {/* ═══════════════════ TOASTER ═══════════════════ */}
            <Toaster position="top-center" />

            {/* ═══════════════════ DESTROY REQUEST MODAL (Creator Only) ═══════════════════ */}
            <AnimatePresence>
                {showDestroyRequest && userRole === "creator" && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <motion.div
                            className="border border-amber-900/60 bg-zinc-950 rounded-sm p-6 max-w-sm w-full mx-4 shadow-2xl"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <span className="text-2xl">⚠️</span>
                                <h3 className="text-amber-400 font-bold text-lg tracking-wide">DESTROY REQUEST</h3>
                            </div>
                            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
                                {pendingDestroyRequester?.requesterName || "A participant"} has requested to destroy this room. All messages will be permanently deleted.
                            </p>
                            <div className="flex gap-3">
                                <motion.button
                                    onClick={(event) => {
                                        setNukeOriginFromTrigger(event.currentTarget)
                                        approveDestroy()
                                    }}
                                    disabled={isNukeRunning}
                                    className="flex-1 py-2.5 rounded-sm border border-red-900/60 bg-red-950/40 hover:bg-red-900/50 text-red-400 hover:text-red-300 font-bold text-sm tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    💣 APPROVE
                                </motion.button>
                                <motion.button
                                    onClick={() => {
                                        if (pendingDestroyRequester?.requesterId) denyDestroy(pendingDestroyRequester.requesterId)
                                    }}
                                    disabled={!pendingDestroyRequester?.requesterId || isNukeRunning}
                                    className="flex-1 py-2.5 rounded-sm border border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-300 font-bold text-sm tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    ✕ DENY
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══════════════════ PANIC MODE MODAL ═══════════════════ */}
            <AnimatePresence>
                {showPanicModal && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        <motion.div
                            className="border border-red-900/60 bg-zinc-950 rounded-sm p-6 max-w-xs w-full mx-4 shadow-2xl"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <span className="text-2xl">🚨</span>
                                <h3 className="text-red-400 font-bold text-lg tracking-wide">PANIC MODE</h3>
                            </div>
                            <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                                Enter the panic password to instantly destroy this room. This cannot be undone.
                            </p>
                            <input
                                type="password"
                                value={panicInput}
                                onChange={(e) => setPanicInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter" && panicInput.trim()) triggerPanic(panicInput.trim()) }}
                                placeholder="Panic password"
                                autoFocus
                                className="w-full bg-black border border-red-900/40 focus:border-red-500/60 p-2.5 text-sm text-red-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 mb-4"
                            />
                            <div className="flex gap-3">
                                <motion.button
                                    onClick={(event) => {
                                        setNukeOriginFromTrigger(event.currentTarget)
                                        triggerPanic(panicInput.trim())
                                    }}
                                    disabled={!panicInput.trim() || isNukeRunning}
                                    className="flex-1 py-2.5 rounded-sm border border-red-700/60 bg-red-900/40 hover:bg-red-800/50 text-red-300 font-bold text-sm tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    💣 DESTROY
                                </motion.button>
                                <motion.button
                                    onClick={() => { setShowPanicModal(false); setPanicInput("") }}
                                    className="flex-1 py-2.5 rounded-sm border border-zinc-700/60 bg-zinc-800/40 hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-300 font-bold text-sm tracking-wider transition-colors"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    CANCEL
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══════════════════ STEGO MODAL ═══════════════════ */}
            <AnimatePresence>
                {showStegoModal && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={closeStegoModal}
                    >
                        <motion.div
                            className="border border-purple-900/60 bg-zinc-950 rounded-sm p-6 max-w-md w-full mx-4 shadow-2xl"
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 10 }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center gap-3 mb-4">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                                <h3 className="text-purple-400 font-bold text-sm uppercase tracking-wider">Steganography</h3>
                            </div>
                            <p className="text-zinc-500 text-[11px] mb-4 leading-relaxed">
                                Hide a secret message or image inside an innocent-looking cover image. Only someone who clicks &quot;Reveal&quot; can see it.
                            </p>

                            {/* Mode toggle */}
                            <div className="flex mb-4 border border-zinc-800 rounded-sm overflow-hidden">
                                <button
                                    onClick={() => setStegoMode("text")}
                                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${stegoMode === "text"
                                        ? "bg-purple-600/20 text-purple-400 border-r border-purple-500/30"
                                        : "bg-zinc-900 text-zinc-500 hover:text-zinc-300 border-r border-zinc-800"
                                        }`}
                                >
                                    🔤 Hide Text
                                </button>
                                <button
                                    onClick={() => setStegoMode("image")}
                                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${stegoMode === "image"
                                        ? "bg-purple-600/20 text-purple-400"
                                        : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                                        }`}
                                >
                                    🖼️ Hide Image
                                </button>
                            </div>

                            {/* Cover image upload */}
                            <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">Cover Image (what others see)</p>
                            {stegoImage ? (
                                <div className="mb-4 relative group">
                                    <img src={stegoImage} alt="Cover" className="max-h-[200px] w-full object-contain rounded-sm border border-zinc-800 bg-black" />
                                    <button
                                        onClick={clearStegoImage}
                                        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-zinc-400 hover:text-white text-xs cursor-pointer"
                                    >✕</button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => stegoFileRef.current?.click()}
                                    className="w-full mb-4 py-6 border-2 border-dashed border-zinc-700 hover:border-purple-500/50 rounded-sm text-zinc-500 hover:text-purple-400 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                                >
                                    Click to select cover image
                                </button>
                            )}
                            <input ref={stegoFileRef} type="file" accept="image/*" className="hidden" onChange={handleStegoImageSelect} />

                            {/* Secret payload — text or image */}
                            <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">
                                {stegoMode === "text" ? "Secret Message" : "Secret Image (what's hidden)"}
                            </p>
                            {stegoMode === "text" ? (
                                <textarea
                                    value={stegoSecret}
                                    onChange={e => setStegoSecret(e.target.value)}
                                    placeholder="Type your secret message..."
                                    rows={3}
                                    className="w-full bg-black border border-zinc-800 focus:border-purple-500/50 p-3 text-sm text-purple-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 mb-4 resize-none"
                                />
                            ) : (
                                <>
                                    {stegoSecretImage ? (
                                        <div className="mb-4 relative group">
                                            <img src={stegoSecretImage} alt="Secret" className="max-h-[160px] w-full object-contain rounded-sm border border-purple-900/40 bg-black" />
                                            <button
                                                onClick={() => setStegoSecretImage(null)}
                                                className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-zinc-400 hover:text-white text-xs cursor-pointer"
                                            >✕</button>
                                            <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-purple-600/30 backdrop-blur-sm rounded-sm text-[8px] text-purple-300 font-bold uppercase tracking-wider">
                                                Hidden
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => stegoSecretFileRef.current?.click()}
                                            className="w-full mb-4 py-5 border-2 border-dashed border-purple-900/40 hover:border-purple-500/50 rounded-sm text-zinc-500 hover:text-purple-400 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer"
                                        >
                                            Click to select secret image
                                        </button>
                                    )}
                                    <input ref={stegoSecretFileRef} type="file" accept="image/*" className="hidden" onChange={handleStegoSecretImageSelect} />
                                </>
                            )}

                            {isSecureRoom && (
                                <div className="mb-4 border border-zinc-800/70 rounded-sm p-3 bg-zinc-900/30">
                                    <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">Decode Received Stego PNG</p>
                                    <button
                                        onClick={() => stegoDecodeFileRef.current?.click()}
                                        className="w-full py-2 border border-zinc-700/70 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-green-300 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors cursor-pointer"
                                    >
                                        Select PNG to Decode
                                    </button>
                                    <input ref={stegoDecodeFileRef} type="file" accept="image/png,image/*" className="hidden" onChange={handleDecodeStegoFile} />

                                    {stegoDecodeResult && (
                                        <div className="mt-3 border border-green-900/40 bg-black/60 rounded-sm p-2">
                                            <p className="text-[9px] text-green-400 font-bold uppercase tracking-wider mb-1">Decoded Payload</p>
                                            {stegoDecodeResult?.mode === "image" && typeof stegoDecodeResult?.payload === "string" && stegoDecodeResult.payload.startsWith("data:image/") ? (
                                                <img src={stegoDecodeResult.payload} alt="Decoded secret" className="max-h-[150px] w-full object-contain rounded-sm border border-green-900/40 bg-black" />
                                            ) : (
                                                <p className="text-xs text-zinc-200 font-mono break-all">{String(stegoDecodeResult?.payload ?? "")}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3">
                                <motion.button
                                    onClick={closeStegoModal}
                                    className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 rounded-sm transition-colors"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    Cancel
                                </motion.button>
                                <motion.button
                                    onClick={sendStegoMessage}
                                    disabled={!stegoImage || (stegoMode === "text" ? !stegoSecret.trim() : !stegoSecretImage) || stegoEncoding}
                                    className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider border border-purple-500/30 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    {stegoEncoding ? "Encoding..." : "Encode & Send"}
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══════════════════ FILE SEND MODAL ═══════════════════ */}
            <FileSendModal
                isOpen={showFileSendModal}
                onClose={() => setShowFileSendModal(false)}
                onFileSend={handleSendFile}
                participants={participants}
                username={username}
            />

            {/* ═══════════════════ TRANSFER PROGRESS ═══════════════════ */}
            <TransferProgress
                progress={transferState.progress}
                filename={transferState.filename}
                direction={transferState.direction}
                status={transferState.status}
                onCancel={cancelOutgoingTransfers}
            />

            <NukeController
                active={isNukeRunning}
                onComplete={handleNukeComplete}
                reduced={reduced}
            />
        </main>
    )

}

export default Page
