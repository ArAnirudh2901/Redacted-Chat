"use client"

import { useUsername } from "@/hooks/use-username"
import { useAuth } from "@/hooks/use-auth"
import { client } from "@/lib/client"
import { useRealtime } from "@/lib/realtime-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { motion, AnimatePresence, useAnimationControls, useReducedMotion } from "framer-motion"
import { toast } from "sonner"
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
import { DUR_BASE, DUR_FAST, DUR_SLOW, EASE_STANDARD } from "@/lib/motion-tokens"

/* ── Shared easing ── */
const ease = EASE_STANDARD
const PRESENCE_TTL_MS = 25000
const PRESENCE_HEARTBEAT_MS = 8000
const DISK_STREAM_THRESHOLD_BYTES = 100 * 1024 * 1024

const SECURE_CACHE_MAX = 50
const STEGO_PACKET_PREFIX = "STEGO_PACKET_V1:"
const STEGO_PACKET_MAX_BYTES = 450 * 1024
const STEGO_IMAGE_BUDGET_BYTES = 220 * 1024
const FILE_PACKET_PREFIX = "FILE_PACKET_V1:"
const FILE_IMAGE_PREVIEW_BUDGET_BYTES = 180 * 1024
const FILE_IMAGE_PREVIEW_MAX_DIMENSION = 1080
const FILE_IMAGE_PREVIEW_SOURCE_MAX_BYTES = 15 * 1024 * 1024
const PANIC_SHORTCUT_STORAGE_PREFIX = "panic-shortcut:"
const STEGO_IMAGE_COMPRESSION_STEPS = [
    { scale: 1.0, quality: 0.9 },
    { scale: 0.92, quality: 0.84 },
    { scale: 0.85, quality: 0.78 },
    { scale: 0.78, quality: 0.72 },
    { scale: 0.7, quality: 0.66 },
    { scale: 0.62, quality: 0.6 },
    { scale: 0.55, quality: 0.54 },
    { scale: 0.48, quality: 0.48 },
    { scale: 0.42, quality: 0.42 },
    { scale: 0.36, quality: 0.36 },
    { scale: 0.3, quality: 0.32 },
    { scale: 0.24, quality: 0.28 },
    { scale: 0.2, quality: 0.24 },
    { scale: 0.16, quality: 0.2 },
    { scale: 0.12, quality: 0.18 },
]
const FILE_IMAGE_PREVIEW_STEPS = [
    { scale: 1.0, quality: 0.88 },
    { scale: 0.88, quality: 0.78 },
    { scale: 0.76, quality: 0.7 },
    { scale: 0.66, quality: 0.62 },
    { scale: 0.56, quality: 0.55 },
    { scale: 0.46, quality: 0.48 },
]
const VANISH_OPTIONS = [0, 5, 10, 30, 60, 300]
const SEND_FX_ACTIVE_MS = 1300
/** @type {[number, number, number, number]} */
const SEND_FX_EASE = [0.16, 1, 0.3, 1]
const SEND_PLANE_REST_ANIMATION = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
const SEND_PLANE_LAUNCH_ANIMATION = {
    x: [0, 12, 34, 60, 92],
    y: [0, -10, -24, -40, -58],
    rotate: [0, 3, 5, 7, 9],
    scale: [1, 1.03, 0.98, 0.9, 0.82],
    opacity: [1, 1, 0.9, 0.42, 0],
}
const SEND_TRAIL_REST_ANIMATION = { x: -14, y: 4, rotate: -34, scaleX: 0.45, opacity: 0 }
const SEND_TRAIL_LAUNCH_ANIMATION = {
    x: [-8, 26, 58],
    y: [4, -14, -32],
    rotate: -34,
    scaleX: [0.45, 1, 0.5],
    opacity: [0, 0.95, 0],
}
const SEND_WIND_REST_ANIMATION = { x: -14, y: 10, rotate: -16, scaleX: 0.4, opacity: 0 }
const SEND_WIND_LAUNCH_ANIMATION = {
    x: [-10, 22, 50],
    y: [12, 0, -18],
    rotate: -16,
    scaleX: [0.4, 1, 0.6],
    opacity: [0, 0.98, 0],
}
const SEND_PLANE_RETURN_START = { x: -44, y: 28, rotate: 0, scale: 0.9, opacity: 0 }
const SEND_PLANE_RETURN_END = SEND_PLANE_REST_ANIMATION
/** @type {import("framer-motion").Transition} */
const SEND_PLANE_LAUNCH_TRANSITION = { duration: 0.72, times: [0, 0.14, 0.38, 0.68, 1], ease: SEND_FX_EASE }
/** @type {import("framer-motion").Transition} */
const SEND_TRAIL_LAUNCH_TRANSITION = { duration: 0.46, times: [0, 0.35, 1], ease: SEND_FX_EASE }
/** @type {import("framer-motion").Transition} */
const SEND_WIND_LAUNCH_TRANSITION = { duration: 0.48, times: [0, 0.34, 1], ease: SEND_FX_EASE }
/** @type {import("framer-motion").Transition} */
const SEND_PLANE_RETURN_TRANSITION = { duration: 0.24, ease: EASE_STANDARD }
const EMPTY_STATE_MATRIX_ITEMS = [
    { char: "3", delay: 0, duration: 1.52 },
    { char: "8", delay: 0.12, duration: 1.66 },
    { char: "A", delay: 0.24, duration: 1.8 },
    { char: "1", delay: 0.36, duration: 1.58 },
    { char: "F", delay: 0.48, duration: 1.72 },
    { char: "6", delay: 0.6, duration: 1.86 },
    { char: "0", delay: 0.72, duration: 1.6 },
    { char: "D", delay: 0.84, duration: 1.74 },
    { char: "9", delay: 0.96, duration: 1.9 },
]

const formatTimeRemaining = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
}

/**
 * @param {string} roomId
 */
function panicShortcutStorageKey(roomId) {
    return `${PANIC_SHORTCUT_STORAGE_PREFIX}${roomId}`
}

/**
 * @param {string} key
 */
function normalizeShortcutKey(key) {
    if (typeof key !== "string" || key.length === 0) return ""
    if (key === "Control" || key === "Meta" || key === "Alt" || key === "Shift") return ""
    if (key === " ") return "Space"
    if (key === "Escape") return "Esc"
    if (key === "ArrowUp") return "Up"
    if (key === "ArrowDown") return "Down"
    if (key === "ArrowLeft") return "Left"
    if (key === "ArrowRight") return "Right"
    if (key.length === 1) return key.toUpperCase()
    return key
}

/**
 * @param {KeyboardEvent} event
 */
function shortcutFromEvent(event) {
    if (!event || event.repeat) return ""
    const key = normalizeShortcutKey(event.key)
    if (!key) return ""
    const parts = []
    if (event.ctrlKey) parts.push("Ctrl")
    if (event.metaKey) parts.push("Meta")
    if (event.altKey) parts.push("Alt")
    if (event.shiftKey) parts.push("Shift")
    parts.push(key)
    return parts.join("+")
}

/**
 * @param {unknown} value
 */
function normalizeParticipantName(value) {
    if (typeof value !== "string") return ""
    return value.trim().replace(/\s+/g, " ")
}

/**
 * @param {string} name
 */
function participantKey(name) {
    return normalizeParticipantName(name).toLocaleLowerCase()
}

/**
 * @param {unknown} value
 */
function isDataImageUrl(value) {
    return typeof value === "string" && value.startsWith("data:image/")
}

/**
 * @param {unknown} value
 */
function utf8ByteLengthOf(value) {
    const encoder = new TextEncoder()
    return encoder.encode(String(value || "")).length
}

/**
 * @param {number} bytes
 */
function formatFileSize(bytes) {
    const normalized = Number.isFinite(bytes) ? Math.max(0, Number(bytes)) : 0
    if (normalized < 1024) return `${normalized} B`
    if (normalized < 1024 * 1024) return `${(normalized / 1024).toFixed(1)} KB`
    if (normalized < 1024 * 1024 * 1024) return `${(normalized / (1024 * 1024)).toFixed(1)} MB`
    return `${(normalized / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * @param {string} mimeType
 */
function formatFileTypeLabel(mimeType) {
    if (typeof mimeType !== "string" || !mimeType) return "file"
    if (mimeType.startsWith("image/")) return "image"
    const [, subtype] = mimeType.split("/")
    if (!subtype) return mimeType
    return subtype.toUpperCase()
}

/**
 * @param {File} file
 */
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result)
                return
            }
            reject(new Error("Failed to read file data"))
        }
        reader.onerror = () => reject(new Error("Failed to read file data"))
        reader.readAsDataURL(file)
    })
}

/**
 * @param {string} src
 */
function loadPreviewImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = "async"
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error("Unable to load image preview"))
        img.src = src
    })
}

/**
 * @param {HTMLImageElement} img
 * @param {number} scale
 * @param {number} quality
 */
function encodePreviewVariant(img, scale, quality) {
    const sourceMax = Math.max(img.width, img.height)
    const clampedScale = Number.isFinite(scale) ? Math.max(0.1, Math.min(1, scale)) : 1
    const targetMax = Math.max(64, Math.round(sourceMax * clampedScale))
    const resizeRatio = Math.min(1, targetMax / sourceMax)
    const width = Math.max(1, Math.round(img.width * resizeRatio))
    const height = Math.max(1, Math.round(img.height * resizeRatio))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Unable to initialize preview canvas")

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(img, 0, 0, width, height)

    const normalizedQuality = Number.isFinite(quality) ? Math.max(0.2, Math.min(0.95, quality)) : 0.82
    const out = canvas.toDataURL("image/jpeg", normalizedQuality)
    canvas.width = 0
    canvas.height = 0
    return out
}

/**
 * @param {File} file
 */
async function buildImagePreviewDataUrl(file) {
    if (!file?.type?.startsWith("image/")) return ""
    if ((file.size || 0) > FILE_IMAGE_PREVIEW_SOURCE_MAX_BYTES) return ""

    const dataUrl = /** @type {string} */ (await readFileAsDataUrl(file))
    const img = /** @type {HTMLImageElement} */ (await loadPreviewImageElement(dataUrl))
    const sourceMax = Math.max(img.width, img.height)
    const baseScale = sourceMax > FILE_IMAGE_PREVIEW_MAX_DIMENSION ? (FILE_IMAGE_PREVIEW_MAX_DIMENSION / sourceMax) : 1
    const candidates = []
    const seen = new Set()

    const addCandidate = (candidate) => {
        if (!candidate || seen.has(candidate)) return
        seen.add(candidate)
        candidates.push(candidate)
    }

    for (const step of FILE_IMAGE_PREVIEW_STEPS) {
        try {
            addCandidate(encodePreviewVariant(img, baseScale * step.scale, step.quality))
        } catch {
            // Keep trying lower quality previews.
        }
    }

    if (candidates.length === 0) return ""
    for (const candidate of candidates) {
        if (utf8ByteLengthOf(candidate) <= FILE_IMAGE_PREVIEW_BUDGET_BYTES) return candidate
    }
    return candidates[candidates.length - 1]
}

/**
 * @param {{ previewImage: string, hiddenImage?: string, secretText?: string }} packet
 */
function buildStegoPacket(packet) {
    const payload = {
        v: 1,
        p: packet.previewImage || "",
        h: packet.hiddenImage || "",
        t: packet.secretText || "",
        c: Date.now(),
    }
    return `${STEGO_PACKET_PREFIX}${JSON.stringify(payload)}`
}

/**
 * @param {unknown} raw
 */
function parseStegoPacket(raw) {
    if (typeof raw !== "string" || !raw.startsWith(STEGO_PACKET_PREFIX)) return null
    try {
        const parsed = JSON.parse(raw.slice(STEGO_PACKET_PREFIX.length))
        const previewImage = isDataImageUrl(parsed?.p) ? parsed.p : ""
        const hiddenImage = isDataImageUrl(parsed?.h) ? parsed.h : ""
        const secretText = typeof parsed?.t === "string" ? parsed.t : ""
        if (!previewImage) return null
        return { previewImage, hiddenImage, secretText }
    } catch {
        return null
    }
}

/**
 * @param {{ file: File, recipientCount: number, previewImage?: string, noticeText?: string }} packet
 */
function buildFilePacket(packet) {
    const payload = {
        v: 1,
        n: packet.file?.name || "file",
        s: Number.isFinite(packet.file?.size) ? Math.max(0, Number(packet.file.size)) : 0,
        m: packet.file?.type || "application/octet-stream",
        r: Math.max(1, Number(packet.recipientCount) || 1),
        p: packet.previewImage || "",
        t: packet.noticeText || "",
        c: Date.now(),
    }
    return `${FILE_PACKET_PREFIX}${JSON.stringify(payload)}`
}

/**
 * @param {unknown} raw
 */
function parseLegacyFileNotice(raw) {
    if (typeof raw !== "string") return null
    const trimmed = raw.trim()
    const match = trimmed.match(/^\[file sent:\s*(.+?)\s*to\s*(\d+)\s*recipient(?:s)?\]$/i)
    if (!match) return null
    const filename = match[1]?.trim()
    if (!filename) return null
    const recipientCount = Math.max(1, Number.parseInt(match[2] || "1", 10) || 1)
    return {
        filename,
        fileSize: 0,
        fileType: "application/octet-stream",
        recipientCount,
        previewImage: "",
        noticeText: "",
    }
}

/**
 * @param {unknown} raw
 */
function parseFilePacket(raw) {
    if (typeof raw !== "string" || !raw.startsWith(FILE_PACKET_PREFIX)) return null
    try {
        const parsed = JSON.parse(raw.slice(FILE_PACKET_PREFIX.length))
        const filename = typeof parsed?.n === "string" ? parsed.n.trim() : ""
        if (!filename) return null
        const fileSize = Number.isFinite(parsed?.s) ? Math.max(0, Number(parsed.s)) : 0
        const fileType = typeof parsed?.m === "string" && parsed.m ? parsed.m : "application/octet-stream"
        const recipientCount = Number.isFinite(parsed?.r) ? Math.max(1, Math.floor(Number(parsed.r))) : 1
        const previewImage = isDataImageUrl(parsed?.p) ? parsed.p : ""
        const noticeText = typeof parsed?.t === "string" ? parsed.t : ""

        return {
            filename,
            fileSize,
            fileType,
            recipientCount,
            previewImage,
            noticeText,
        }
    } catch {
        return null
    }
}

let _messageDustRenderer = null
async function loadMessageDustRenderer() {
    if (_messageDustRenderer) return _messageDustRenderer
    try {
        const mod = await import("html2canvas-pro")
        if (typeof mod?.default === "function") {
            _messageDustRenderer = mod.default
            return _messageDustRenderer
        }
    } catch {
        // Fall through to html2canvas.
    }
    const fallback = await import("html2canvas")
    _messageDustRenderer = fallback.default
    return _messageDustRenderer
}

/**
 * @param {number} peak
 * @param {number} layerCount
 */
function messageDustWeightedIndex(peak, layerCount) {
    const safeCount = Math.max(1, layerCount | 0)
    const safePeak = Math.max(0, Math.min(safeCount - 1, peak | 0))

    let total = 0
    const probabilities = new Array(safeCount)
    for (let i = 0; i < safeCount; i += 1) {
        const weight = Math.pow(safeCount - Math.abs(safePeak - i), 3)
        probabilities[i] = weight
        total += weight
    }

    let draw = Math.random() * total
    for (let i = 0; i < safeCount; i += 1) {
        draw -= probabilities[i]
        if (draw <= 0) return i
    }
    return safeCount - 1
}

/**
 * @param {Uint8ClampedArray} pixelArray
 * @param {number} width
 * @param {number} height
 */
function createMessageDustCanvas(pixelArray, width, height) {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (ctx) {
        const imageData = ctx.createImageData(width, height)
        imageData.data.set(pixelArray)
        ctx.putImageData(imageData, 0, 0)
    }
    return canvas
}

/**
 * @param {HTMLElement | null} target
 * @param {{ reduced?: boolean }} [options]
 */
async function disintegrateMessageElement(target, options = {}) {
    if (!(target instanceof HTMLElement)) return

    const reduced = options.reduced === true
    const rect = target.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 2 || rect.height < 2) {
        return
    }

    let renderer
    try {
        renderer = await loadMessageDustRenderer()
    } catch {
        return
    }

    let snapshot
    try {
        snapshot = await renderer(target, {
            backgroundColor: null,
            scale: 0.8,
            useCORS: true,
            logging: false,
            removeContainer: true,
            scrollX: 0,
            scrollY: 0,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
        })
    } catch {
        return
    }

    const ctx = snapshot.getContext("2d")
    if (!ctx) return

    let imageData
    try {
        imageData = ctx.getImageData(0, 0, snapshot.width, snapshot.height)
    } catch {
        return
    }

    const pixels = imageData.data
    const width = snapshot.width
    const height = snapshot.height
    const layerCount = reduced ? 6 : 10
    const layers = Array.from({ length: layerCount }, () => new Uint8ClampedArray(pixels.length))

    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 8) continue
        const pixelIndex = (i / 4) | 0
        const y = (pixelIndex / width) | 0
        const peak = Math.floor((y / Math.max(1, height)) * layerCount)
        const layer = messageDustWeightedIndex(peak, layerCount)
        layers[layer][i] = pixels[i]
        layers[layer][i + 1] = pixels[i + 1]
        layers[layer][i + 2] = pixels[i + 2]
        layers[layer][i + 3] = pixels[i + 3]
    }

    const overlay = document.createElement("div")
    overlay.className = "message-dust-overlay"
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    document.body.appendChild(overlay)

    const dustCanvases = []
    for (let i = 0; i < layerCount; i += 1) {
        const canvas = createMessageDustCanvas(layers[i], width, height)
        canvas.classList.add("message-dust-canvas")
        canvas.style.width = `${rect.width}px`
        canvas.style.height = `${rect.height}px`
        overlay.appendChild(canvas)
        dustCanvases.push(canvas)
    }

    target.classList.add("nuke-dissolving")
    try {
        const animations = dustCanvases.map((canvas, index) => {
            const driftX = (30 + Math.random() * 90) * (Math.random() < 0.4 ? -1 : 1)
            const driftY = -(20 + Math.random() * 80)
            const rotation = (Math.random() - 0.5) * 24
            const delay = index * (reduced ? 18 : 26)
            const duration = (reduced ? 520 : 680) + index * (reduced ? 14 : 20)
            const animation = canvas.animate(
                [
                    { transform: "translate3d(0, 0, 0) rotate(0deg)", opacity: 1, filter: "blur(0px)" },
                    { transform: `translate3d(${driftX}px, ${driftY}px, 0) rotate(${rotation}deg)`, opacity: 0, filter: "blur(1.4px)" },
                ],
                {
                    delay,
                    duration,
                    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                    fill: "forwards",
                },
            )
            return animation.finished.catch(() => undefined)
        })
        await Promise.allSettled(animations)
    } finally {
        overlay.remove()
        target.classList.remove("nuke-dissolving")
    }
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

function MessageRow({ index, style, messages, username, onVanish, reducedMotion = false }) {
    const msg = messages?.[index]
    const vanishDuration = msg?.vanishAfter ? Number(msg.vanishAfter) : 0
    const [vanishRemaining, setVanishRemaining] = useState(null)
    const [isVanished, setIsVanished] = useState(false)
    const [isDissolving, setIsDissolving] = useState(false)
    const [showStegoRevealModal, setShowStegoRevealModal] = useState(false)
    const [showFilePreviewModal, setShowFilePreviewModal] = useState(false)
    const rowVisualRef = useRef(null)
    const vanishStartedRef = useRef(false)
    const stegoPacket = useMemo(() => parseStegoPacket(msg?.text), [msg?.text])
    const filePacket = useMemo(() => parseFilePacket(msg?.text) || parseLegacyFileNotice(msg?.text), [msg?.text])

    useEffect(() => {
        setIsVanished(false)
        setIsDissolving(false)
        setShowStegoRevealModal(false)
        setShowFilePreviewModal(false)
        setVanishRemaining(null)
        vanishStartedRef.current = false
    }, [msg?.id])

    const runTimedVanish = useCallback(async () => {
        if (!msg?.id || vanishStartedRef.current) return
        vanishStartedRef.current = true
        setVanishRemaining(0)
        setIsDissolving(true)

        try {
            await disintegrateMessageElement(rowVisualRef.current, { reduced: reducedMotion })
        } catch {
            // Fall back to immediate remove if dissolve animation fails.
        } finally {
            setIsDissolving(false)
            setIsVanished(true)
            onVanish?.(msg.id)
        }
    }, [msg?.id, onVanish, reducedMotion])

    // Start vanish countdown based on message timestamp (survives react-window re-mounts)
    useEffect(() => {
        if (!vanishDuration || !msg?.timestamp) return

        const msgTime = typeof msg.timestamp === "number" ? msg.timestamp : new Date(msg.timestamp).getTime()
        const expiresAt = msgTime + vanishDuration * 1000
        let interval = /** @type {ReturnType<typeof setInterval> | null} */ (null)

        const tick = () => {
            const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
            setVanishRemaining(remaining)
            if (remaining <= 0) {
                if (interval) clearInterval(interval)
                void runTimedVanish()
            }
        }

        tick() // immediate first tick
        interval = setInterval(tick, 1000)
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [msg?.timestamp, runTimedVanish, vanishDuration])

    if (!msg || isVanished) return <div style={style} />

    const isOwn = msg.sender === username
    const isStegoMsg = msg.type === "stego"
    const isFileMsg = msg.type === "file" || Boolean(filePacket)
    const isAudioMsg = msg.type === "audio"
    const stegoPreviewImage = stegoPacket?.previewImage || ""
    const stegoHiddenImage = stegoPacket?.hiddenImage || ""
    const stegoHiddenText = stegoPacket?.secretText || ""
    const hasStegoHiddenPayload = Boolean(stegoHiddenImage || stegoHiddenText)
    const messageTimestamp = typeof msg.timestamp === "number" ? msg.timestamp : new Date(msg.timestamp).getTime()
    const isFreshMessage = Number.isFinite(messageTimestamp) && (Date.now() - messageTimestamp) < 2200

    return (
        <div style={style}>
            <motion.div
                ref={rowVisualRef}
                className={`flex px-3 sm:px-4 py-1.5 ${isOwn ? "justify-end pr-4 sm:pr-6" : "justify-start"} ${isDissolving ? "pointer-events-none" : ""}`}
                initial={isFreshMessage ? { opacity: 0, y: 12, scale: 0.985, filter: "blur(2px)" } : false}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                transition={{ duration: isFreshMessage ? 0.28 : 0.16, ease }}
            >
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
                        <>
                            {/* Hidden payload card: preview image + reveal modal trigger */}
                            <div className={`message-card rounded-sm border overflow-hidden ${isOwn ? "border-green-900/30" : "border-zinc-700/30"}`}>
                                {stegoPreviewImage ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (hasStegoHiddenPayload) setShowStegoRevealModal(true)
                                        }}
                                        disabled={!hasStegoHiddenPayload}
                                        className={`w-full block border-0 p-0 bg-transparent ${hasStegoHiddenPayload ? "cursor-pointer" : "cursor-default"}`}
                                    >
                                        <img
                                            src={stegoPreviewImage}
                                            alt="Preview"
                                            className="media-preview max-w-full max-h-[300px] w-full object-contain bg-black"
                                            loading="lazy"
                                        />
                                    </button>
                                ) : (
                                    <div className="px-3 py-4 text-[10px] text-zinc-500 font-bold uppercase tracking-wider bg-black">
                                        Invalid preview image payload
                                    </div>
                                )}
                            </div>

                            <AnimatePresence>
                                {showStegoRevealModal && hasStegoHiddenPayload && (
                                    <motion.div
                                        className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center px-4"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        onClick={() => setShowStegoRevealModal(false)}
                                    >
                                        <motion.div
                                            className="w-full max-w-lg max-h-[86vh] overflow-hidden rounded-sm border border-purple-700/50 bg-zinc-950 shadow-2xl"
                                            initial={{ scale: 0.94, opacity: 0, y: 12 }}
                                            animate={{ scale: 1, opacity: 1, y: 0 }}
                                            exit={{ scale: 0.96, opacity: 0, y: 10 }}
                                            transition={{ type: "spring", stiffness: 320, damping: 26 }}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                                                <p className="text-xs font-bold uppercase tracking-wider text-purple-300">Hidden Payload</p>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowStegoRevealModal(false)}
                                                    className="text-zinc-500 hover:text-zinc-200 text-sm font-bold cursor-pointer"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                            <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar">
                                                {stegoHiddenText ? (
                                                    <div className="rounded-sm border border-zinc-700/60 bg-zinc-900/50 p-3">
                                                        <p className="text-[9px] text-purple-300 font-bold uppercase tracking-wider mb-1">Hidden Message</p>
                                                        <p className="text-sm text-zinc-200 font-mono whitespace-pre-wrap break-words">{stegoHiddenText}</p>
                                                    </div>
                                                ) : null}
                                                {stegoHiddenImage ? (
                                                    <div className="rounded-sm border border-zinc-700/60 bg-zinc-900/40 p-2">
                                                        <p className="text-[9px] text-purple-300 font-bold uppercase tracking-wider px-1 pt-1">Hidden Image</p>
                                                        <img
                                                            src={stegoHiddenImage}
                                                            alt="Hidden"
                                                            className="max-w-full max-h-[62vh] w-full object-contain rounded-sm border border-purple-900/40 bg-black mt-1"
                                                        />
                                                    </div>
                                                ) : null}
                                            </div>
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </>
                    ) : isFileMsg ? (
                        filePacket ? (
                            <>
                                <div className={`message-card rounded-sm border overflow-hidden ${isOwn ? "border-green-900/30 bg-green-950/10" : "border-zinc-700/30 bg-zinc-900/30"}`}>
                                    {filePacket.previewImage ? (
                                        <button
                                            type="button"
                                            onClick={() => setShowFilePreviewModal(true)}
                                            className="w-full block border-0 p-0 bg-transparent cursor-zoom-in"
                                        >
                                            <img
                                                src={filePacket.previewImage}
                                                alt={filePacket.filename}
                                                className="media-preview max-w-full max-h-[320px] w-full object-contain bg-black"
                                                loading="lazy"
                                            />
                                        </button>
                                    ) : (
                                        <div className="px-3 py-3 flex items-start gap-3">
                                            <div className="w-10 h-10 rounded-sm border border-zinc-700/60 bg-zinc-900 flex items-center justify-center text-lg">
                                                📄
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-bold text-zinc-200 truncate">{filePacket.filename}</p>
                                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                                                    {formatFileSize(filePacket.fileSize)} • {formatFileTypeLabel(filePacket.fileType)}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    <div className="px-3 py-2 bg-zinc-900/60 border-t border-zinc-700/30">
                                        <p className="text-xs font-mono text-zinc-300 truncate">{filePacket.filename}</p>
                                        <p className="text-[10px] text-zinc-500">
                                            {formatFileSize(filePacket.fileSize)} • shared with {filePacket.recipientCount} recipient{filePacket.recipientCount === 1 ? "" : "s"}
                                        </p>
                                        {filePacket.noticeText ? (
                                            <p className="text-[10px] text-zinc-500 mt-1 truncate">{filePacket.noticeText}</p>
                                        ) : null}
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {showFilePreviewModal && filePacket.previewImage && (
                                        <motion.div
                                            className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-sm flex items-center justify-center px-4"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            onClick={() => setShowFilePreviewModal(false)}
                                        >
                                            <motion.div
                                                className="w-full max-w-5xl rounded-sm border border-zinc-700/70 bg-black p-3"
                                                initial={{ scale: 0.96, opacity: 0, y: 12 }}
                                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                                exit={{ scale: 0.98, opacity: 0, y: 8 }}
                                                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <div className="flex items-center justify-between mb-2">
                                                    <p className="text-xs font-mono text-zinc-300 truncate pr-2">{filePacket.filename}</p>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowFilePreviewModal(false)}
                                                        className="text-zinc-500 hover:text-zinc-200 text-sm font-bold cursor-pointer"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                                <img
                                                    src={filePacket.previewImage}
                                                    alt={filePacket.filename}
                                                    className="w-full max-h-[78vh] object-contain rounded-sm border border-zinc-800/70 bg-black"
                                                />
                                            </motion.div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </>
                        ) : (
                            <div className={`message-bubble px-3.5 py-2.5 rounded-sm text-sm leading-relaxed break-all border ${isOwn
                                ? "bg-green-950/20 border-green-900/30 text-zinc-200"
                                : "bg-zinc-800/30 border-zinc-700/30 text-zinc-300"
                                }`}>
                                {msg.text}
                            </div>
                        )
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
            </motion.div>
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
    const sendFxRunIdRef = useRef(0)
    const [isSendFxActive, setIsSendFxActive] = useState(false)
    const sendPlaneControls = useAnimationControls()
    const sendTrailControls = useAnimationControls()
    const sendWindControls = useAnimationControls()
    const isDestroyingRef = useRef(false)
    const [userRole, setUserRole] = useState(null) // "creator" | "member"
    const [showDestroyRequest, setShowDestroyRequest] = useState(false)
    const [pendingDestroyRequester, setPendingDestroyRequester] = useState(null)
    const [destroyRequestPending, setDestroyRequestPending] = useState(false)
    const [showExtendPopover, setShowExtendPopover] = useState(false)
    const [showPanicModal, setShowPanicModal] = useState(false)
    const [panicInput, setPanicInput] = useState("")
    const [hasPanicPassword, setHasPanicPassword] = useState(false)
    const [panicShortcut, setPanicShortcut] = useState("")
    const [panicShortcutPassword, setPanicShortcutPassword] = useState("")
    const [isRecordingPanicShortcut, setIsRecordingPanicShortcut] = useState(false)
    const [showFileSendModal, setShowFileSendModal] = useState(false)
    const [queuedDroppedFile, setQueuedDroppedFile] = useState(/** @type {File | null} */(null))
    const [isRoomDragActive, setIsRoomDragActive] = useState(false)
    const [transferState, setTransferState] = useState({ status: "idle", progress: 0, filename: "", direction: "" })
    // Vanish timer state
    const [vanishAfter, setVanishAfter] = useState(0) // 0 = off, else seconds
    const [showVanishPicker, setShowVanishPicker] = useState(false)
    const [showInputMenu, setShowInputMenu] = useState(false)
    // Stego modal state
    const [showStegoModal, setShowStegoModal] = useState(false)
    const [stegoImage, setStegoImage] = useState(null) // preview image (data URL)
    const [stegoSecret, setStegoSecret] = useState("")
    const [stegoSecretImage, setStegoSecretImage] = useState(null) // hidden image (data URL)
    const [stegoEncoding, setStegoEncoding] = useState(false)
    const [stegoPreviewDragActive, setStegoPreviewDragActive] = useState(false)
    const [stegoHiddenDragActive, setStegoHiddenDragActive] = useState(false)
    const stegoFileRef = useRef(null)
    const stegoSecretFileRef = useRef(null)
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
    const roomDropDepthRef = useRef(0)
    const trackedPermanentRoomRef = useRef("")
    const requesterClientIdRef = useRef("")
    if (!requesterClientIdRef.current) {
        requesterClientIdRef.current = `requester_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    const presenceClientIdRef = useRef("")
    if (!presenceClientIdRef.current) {
        presenceClientIdRef.current = `presence_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    const [presenceMap, setPresenceMap] = useState({})
    const [nukeState, setNukeState] = useState("idle")
    const nukeTargetPathRef = useRef("")
    const nukeRunningRef = useRef(false)
    const nukeReasonRef = useRef("destroy")
    const nukeOriginRef = useRef(null)
    const secureSeenMessageIdsRef = useRef(new Set())
    const { reduced } = useNukeCapabilities()
    const reducedMotion = useReducedMotion()
    const shouldReduceMotion = reduced || reducedMotion
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
                    setHasPanicPassword(Boolean(data?.hasPanicPassword))
                    return
                }
                setHasPanicPassword(false)

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
                setHasPanicPassword(false)
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

    const persistPanicShortcutConfig = useCallback((combo, password) => {
        if (typeof window === "undefined" || !roomId) return
        const key = panicShortcutStorageKey(roomId)
        if (!combo || !password) {
            sessionStorage.removeItem(key)
            return
        }
        sessionStorage.setItem(key, JSON.stringify({
            combo,
            panicPassword: password,
        }))
    }, [roomId])

    useEffect(() => {
        setIsRecordingPanicShortcut(false)

        if (typeof window === "undefined" || !roomId || isSecureRoom) {
            setPanicShortcut("")
            setPanicShortcutPassword("")
            return
        }

        try {
            const key = panicShortcutStorageKey(roomId)
            const raw = sessionStorage.getItem(key)
            if (!raw) {
                setPanicShortcut("")
                setPanicShortcutPassword("")
                return
            }

            const parsed = JSON.parse(raw)
            const combo = typeof parsed?.combo === "string" ? parsed.combo : ""
            const password = typeof parsed?.panicPassword === "string" ? parsed.panicPassword : ""
            if (!combo || !password) {
                sessionStorage.removeItem(key)
                setPanicShortcut("")
                setPanicShortcutPassword("")
                return
            }

            setPanicShortcut(combo)
            setPanicShortcutPassword(password)
        } catch {
            try {
                sessionStorage.removeItem(panicShortcutStorageKey(roomId))
            } catch {
                // Ignore storage cleanup errors.
            }
            setPanicShortcut("")
            setPanicShortcutPassword("")
        }
    }, [roomId, isSecureRoom])

    const openPanicModal = useCallback(() => {
        if (isSecureRoom) {
            toast.error("Panic mode is unavailable in secure rooms", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }
        setPanicInput((prev) => prev || panicShortcutPassword)
        setShowPanicModal(true)
    }, [isSecureRoom, panicShortcutPassword])

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
        if (typeof window !== "undefined") {
            sessionStorage.removeItem(panicShortcutStorageKey(roomId))
        }
        setPanicShortcut("")
        setPanicShortcutPassword("")
        setIsRecordingPanicShortcut(false)
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
            roomDropDepthRef.current = 0
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
        const senders = new Map()
        for (const m of /** @type {any[]} */ (currentMessages)) {
            const normalizedSender = normalizeParticipantName(m?.sender)
            if (!normalizedSender) continue
            const key = participantKey(normalizedSender)
            if (!senders.has(key)) senders.set(key, normalizedSender)
        }
        return Array.from(senders.values())
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
        const merged = new Map()
        const addParticipant = (value) => {
            const normalized = normalizeParticipantName(value)
            if (!normalized) return
            const key = participantKey(normalized)
            if (!merged.has(key)) merged.set(key, normalized)
        }

        for (const p of messageParticipants) addParticipant(p)
        if (serverParticipants) {
            for (const p of serverParticipants) addParticipant(p)
        }
        const presenceEntries = Object.values(presenceMap)
        for (const entry of presenceEntries) {
            addParticipant(entry?.username)
        }
        addParticipant(username)

        return Array.from(merged.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
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
                const requesterUsername = normalizeParticipantName(d?.username)
                const seenAt = Date.now()
                if (requesterId && requesterUsername) {
                    setPresenceMap((prev) => {
                        const current = prev[requesterId]
                        if (
                            current?.username === requesterUsername &&
                            typeof current?.lastSeen === "number" &&
                            seenAt - current.lastSeen < 1000
                        ) return prev
                        return {
                            ...prev,
                            [requesterId]: { username: requesterUsername, lastSeen: seenAt },
                        }
                    })
                }
                if (!username || !requesterId || requesterId === presenceClientIdRef.current) return
                emitSignal("presence.announce", {
                    clientId: presenceClientIdRef.current,
                    username: normalizeParticipantName(username),
                    timestamp: Date.now(),
                })
                return
            }

            if (evt === "presence.announce") {
                const clientId = typeof d?.clientId === "string" ? d.clientId : ""
                const announcedUsername = normalizeParticipantName(d?.username)
                if (!clientId || !announcedUsername) return
                // Use local receipt time; remote clocks can drift and cause false pruning.
                const lastSeen = Date.now()
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

                const toastId = toast.custom(
                    (toastCustomId) => (
                        <FileOfferToast
                            filename={d.filename}
                            fileSize={d.fileSize}
                            from={d.from}
                            onAccept={() => {
                                pendingOfferToastIdsRef.current.delete(d.offerId)
                                toast.dismiss(toastCustomId)
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
                                toast.dismiss(toastCustomId)
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
            setIsRecordingPanicShortcut(false)
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
        onError: (error) => {
            isDestroyingRef.current = false
            const err = /** @type {any} */ (error)
            const message = typeof err?.value?.error === "string"
                ? err.value.error
                : (typeof err?.message === "string" ? err.message : "Invalid panic password")
            toast.error(message, {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
        }
    })

    const savePanicShortcut = useCallback(() => {
        if (isSecureRoom) {
            toast.error("Panic shortcuts are unavailable in secure rooms", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }
        if (!hasPanicPassword) {
            toast.error("This room has no panic password configured", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }
        if (!panicShortcut) {
            toast.error("Record a shortcut first", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }

        const passwordToUse = panicInput.trim() || panicShortcutPassword.trim()
        if (!passwordToUse) {
            toast.error("Enter panic password to arm the shortcut", {
                style: { background: "#18181b", color: "#fca5a5", border: "1px solid #7f1d1d" },
            })
            return
        }

        setPanicShortcutPassword(passwordToUse)
        setIsRecordingPanicShortcut(false)
        persistPanicShortcutConfig(panicShortcut, passwordToUse)
        toast.success(`Panic shortcut armed: ${panicShortcut}`, {
            style: { background: "#18181b", color: "#86efac", border: "1px solid #14532d" },
            duration: 2500,
        })
    }, [
        hasPanicPassword,
        isSecureRoom,
        panicInput,
        panicShortcut,
        panicShortcutPassword,
        persistPanicShortcutConfig,
    ])

    const clearPanicShortcut = useCallback(() => {
        setPanicShortcut("")
        setPanicShortcutPassword("")
        setIsRecordingPanicShortcut(false)
        persistPanicShortcutConfig("", "")
        toast("Panic shortcut cleared", {
            icon: "⌫",
            style: { background: "#18181b", color: "#d4d4d8", border: "1px solid #3f3f46" },
            duration: 2200,
        })
    }, [persistPanicShortcutConfig])

    useEffect(() => {
        const handleShortcutKeydown = (event) => {
            const combo = shortcutFromEvent(event)
            if (!combo) return

            if (isRecordingPanicShortcut) {
                event.preventDefault()
                event.stopPropagation()
                setPanicShortcut(combo)
                setIsRecordingPanicShortcut(false)
                return
            }

            if (isSecureRoom || !hasPanicPassword) return
            if (!panicShortcut || !panicShortcutPassword) return
            if (combo !== panicShortcut) return
            if (isNukeRunning || isDestroyingRef.current) return

            event.preventDefault()
            event.stopPropagation()
            triggerPanic(panicShortcutPassword)
        }

        window.addEventListener("keydown", handleShortcutKeydown, true)
        return () => window.removeEventListener("keydown", handleShortcutKeydown, true)
    }, [
        hasPanicPassword,
        isNukeRunning,
        isRecordingPanicShortcut,
        isSecureRoom,
        panicShortcut,
        panicShortcutPassword,
        triggerPanic,
    ])

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
        const ownUsername = normalizeParticipantName(username)
        if (!roomId || !ownUsername) return

        const clientId = presenceClientIdRef.current
        const announce = () => {
            emitSignal("presence.announce", {
                clientId,
                username: ownUsername,
                timestamp: Date.now(),
            })
        }
        const requestSync = () => {
            emitSignal("presence.request", {
                clientId,
                username: ownUsername,
                timestamp: Date.now(),
            })
        }

        setPresenceMap((prev) => ({
            ...prev,
            [clientId]: { username: ownUsername, lastSeen: Date.now() },
        }))

        announce()
        requestSync()

        // Retry presence discovery for late joiners (realtime subscription may not be ready yet)
        const retry1 = setTimeout(requestSync, 1000)
        const retry2 = setTimeout(requestSync, 3000)
        const retry3 = setTimeout(requestSync, 6000)

        const heartbeatTimer = setInterval(announce, PRESENCE_HEARTBEAT_MS)
        const resyncTimer = setInterval(requestSync, 15_000)
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
                    data: { clientId, username: ownUsername, timestamp: Date.now() },
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
            clearTimeout(retry3)
            clearInterval(heartbeatTimer)
            clearInterval(resyncTimer)
            clearInterval(pruneTimer)
            window.removeEventListener("beforeunload", onBeforeUnload)
            emitSignal("presence.leave", {
                clientId,
                username: ownUsername,
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
    const handleSendFile = useCallback(async (
        /** @type {File} */ file,
        /** @type {string[]} */ targets,
        /** @type {{ announceInChat?: boolean, noticeText?: string, vanishSeconds?: number } | undefined} */ options = undefined,
    ) => {
        const ownParticipant = participantKey(username || "")
        const uniqueTargets = []
        const seenTargets = new Set()
        for (const rawTarget of targets || []) {
            const normalizedTarget = normalizeParticipantName(rawTarget)
            if (!normalizedTarget) continue
            const targetKey = participantKey(normalizedTarget)
            if (!targetKey || targetKey === ownParticipant || seenTargets.has(targetKey)) continue
            seenTargets.add(targetKey)
            uniqueTargets.push(normalizedTarget)
        }
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

        if (options?.announceInChat !== false) {
            const recipientCount = uniqueTargets.length
            const chatNotice = typeof options?.noticeText === "string" && options.noticeText.trim()
                ? options.noticeText.trim()
                : `[file sent: ${file.name} to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}]`
            const vanishSeconds = typeof options?.vanishSeconds === "number"
                ? options.vanishSeconds
                : vanishAfter
            let previewImage = ""
            if (file.type.startsWith("image/")) {
                try {
                    previewImage = await buildImagePreviewDataUrl(file)
                } catch {
                    previewImage = ""
                }
            }

            mutate({
                text: buildFilePacket({
                    file,
                    recipientCount,
                    previewImage,
                    noticeText: chatNotice,
                }),
                type: "file",
                ...(vanishSeconds > 0 ? { vanishAfter: vanishSeconds } : {}),
            })
        }

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
    }, [emitSignal, mutate, roomId, username, vanishAfter])

    const hasDraggedFiles = useCallback((event) => {
        const types = event?.dataTransfer?.types
        if (!types) return false
        return Array.from(types).includes("Files")
    }, [])

    const handleRoomDragEnter = useCallback((event) => {
        if (showStegoModal || showFileSendModal || !hasDraggedFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        roomDropDepthRef.current += 1
        setIsRoomDragActive(true)
    }, [hasDraggedFiles, showFileSendModal, showStegoModal])

    const handleRoomDragOver = useCallback((event) => {
        if (showStegoModal || showFileSendModal || !hasDraggedFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = "copy"
        setIsRoomDragActive(true)
    }, [hasDraggedFiles, showFileSendModal, showStegoModal])

    const handleRoomDragLeave = useCallback((event) => {
        if (!hasDraggedFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        roomDropDepthRef.current = Math.max(0, roomDropDepthRef.current - 1)
        if (roomDropDepthRef.current === 0) {
            setIsRoomDragActive(false)
        }
    }, [hasDraggedFiles])

    const handleRoomDrop = useCallback((event) => {
        if (showStegoModal || showFileSendModal || !hasDraggedFiles(event)) return
        event.preventDefault()
        event.stopPropagation()
        roomDropDepthRef.current = 0
        setIsRoomDragActive(false)
        const file = event.dataTransfer?.files?.[0]
        if (!file) return
        setQueuedDroppedFile(file)
        setShowFileSendModal(true)
    }, [hasDraggedFiles, showFileSendModal, showStegoModal])

    useEffect(() => {
        const resetRoomDragState = () => {
            roomDropDepthRef.current = 0
            setIsRoomDragActive(false)
        }
        window.addEventListener("dragend", resetRoomDragState)
        window.addEventListener("drop", resetRoomDragState)
        return () => {
            window.removeEventListener("dragend", resetRoomDragState)
            window.removeEventListener("drop", resetRoomDragState)
        }
    }, [])

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

    const resetSendFxControls = useCallback(() => {
        sendPlaneControls.set(SEND_PLANE_REST_ANIMATION)
        sendTrailControls.set(SEND_TRAIL_REST_ANIMATION)
        sendWindControls.set(SEND_WIND_REST_ANIMATION)
    }, [sendPlaneControls, sendTrailControls, sendWindControls])

    useEffect(() => {
        resetSendFxControls()
    }, [resetSendFxControls])

    const triggerSendFx = useCallback(async () => {
        const runId = ++sendFxRunIdRef.current
        if (sendFxTimeoutRef.current) {
            clearTimeout(sendFxTimeoutRef.current)
            sendFxTimeoutRef.current = null
        }

        sendPlaneControls.stop()
        sendTrailControls.stop()
        sendWindControls.stop()
        resetSendFxControls()
        setIsSendFxActive(true)

        sendFxTimeoutRef.current = setTimeout(() => {
            if (sendFxRunIdRef.current !== runId) return
            setIsSendFxActive(false)
            resetSendFxControls()
        }, SEND_FX_ACTIVE_MS)

        try {
            if (shouldReduceMotion) {
                await sendPlaneControls.start({
                    scale: [1, 0.97, 1],
                    opacity: [1, 0.84, 1],
                    transition: { duration: DUR_BASE, ease },
                })
            } else {
                await Promise.all([
                    sendPlaneControls.start({
                        ...SEND_PLANE_LAUNCH_ANIMATION,
                        transition: SEND_PLANE_LAUNCH_TRANSITION,
                    }),
                    sendTrailControls.start({
                        ...SEND_TRAIL_LAUNCH_ANIMATION,
                        transition: SEND_TRAIL_LAUNCH_TRANSITION,
                    }),
                    sendWindControls.start({
                        ...SEND_WIND_LAUNCH_ANIMATION,
                        transition: SEND_WIND_LAUNCH_TRANSITION,
                    }),
                ])

                if (sendFxRunIdRef.current !== runId) return

                sendTrailControls.set(SEND_TRAIL_REST_ANIMATION)
                sendWindControls.set(SEND_WIND_REST_ANIMATION)
                sendPlaneControls.set(SEND_PLANE_RETURN_START)

                await sendPlaneControls.start({
                    ...SEND_PLANE_RETURN_END,
                    transition: SEND_PLANE_RETURN_TRANSITION,
                })
            }
        } finally {
            if (sendFxRunIdRef.current !== runId) return
            if (sendFxTimeoutRef.current) {
                clearTimeout(sendFxTimeoutRef.current)
                sendFxTimeoutRef.current = null
            }
            setIsSendFxActive(false)
            resetSendFxControls()
        }
    }, [resetSendFxControls, sendPlaneControls, sendTrailControls, sendWindControls, shouldReduceMotion])

    const sendMessage = () => {
        const text = input.trim()
        if (!text || !roomId) return

        mutate({ text, ...(vanishAfter > 0 ? { vanishAfter } : {}) })
        void triggerSendFx()
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
                        void triggerSendFx()
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
    }, [cleanupRecording, mutate, triggerSendFx, vanishAfter])

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
        setStegoImage(null)
        if (stegoFileRef.current) stegoFileRef.current.value = ""
    }, [])

    const closeFileSendModal = useCallback(() => {
        setShowFileSendModal(false)
        setQueuedDroppedFile(null)
    }, [])

    const closeStegoModal = useCallback(() => {
        setShowStegoModal(false)
        clearStegoImage()
        setStegoSecret("")
        setStegoSecretImage(null)
        setStegoPreviewDragActive(false)
        setStegoHiddenDragActive(false)
    }, [clearStegoImage])

    const encodeImageVariant = useCallback((img, scale, quality) => {
        const sourceMax = Math.max(img.width, img.height)
        const clampedScale = Number.isFinite(scale) ? Math.max(0.08, Math.min(1, scale)) : 1
        const targetMax = Math.max(64, Math.round(sourceMax * clampedScale))
        const resizeRatio = Math.min(1, targetMax / sourceMax)
        const width = Math.max(1, Math.round(img.width * resizeRatio))
        const height = Math.max(1, Math.round(img.height * resizeRatio))

        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Unable to initialize image compression canvas")

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, width, height)

        const normalizedQuality = Number.isFinite(quality) ? Math.max(0.2, Math.min(0.95, quality)) : 0.82
        const out = canvas.toDataURL("image/jpeg", normalizedQuality)
        canvas.width = 0
        canvas.height = 0
        return out
    }, [])

    const buildImageCandidates = useCallback(async (dataUrl, maxDimension = 1400) => {
        const img = await loadPreviewImageElement(dataUrl)
        const sourceMax = Math.max(img.width, img.height)
        const baseScale = sourceMax > maxDimension ? (maxDimension / sourceMax) : 1
        const variants = []
        const seen = new Set()

        const addCandidate = (candidate) => {
            if (!candidate || seen.has(candidate)) return
            seen.add(candidate)
            variants.push(candidate)
        }

        addCandidate(encodeImageVariant(img, baseScale, 0.9))
        for (const step of STEGO_IMAGE_COMPRESSION_STEPS) {
            try {
                addCandidate(encodeImageVariant(img, baseScale * step.scale, step.quality))
            } catch {
                // Skip bad candidate and continue trying smaller variants.
            }
        }

        return variants.length > 0 ? variants : [dataUrl]
    }, [encodeImageVariant])

    const fitImageToBudget = useCallback(async (dataUrl, budgetBytes, maxDimension = 1400) => {
        const candidates = await buildImageCandidates(dataUrl, maxDimension)
        for (const candidate of candidates) {
            if (utf8ByteLengthOf(candidate) <= budgetBytes) return candidate
        }
        return candidates[candidates.length - 1] || dataUrl
    }, [buildImageCandidates])

    const handleStegoImageFile = useCallback(async (file) => {
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file", { duration: 2000 })
            throw new Error("INVALID_STEGO_PREVIEW_FILE")
        }
        const dataUrl = /** @type {string} */ (await readFileAsDataUrl(file))
        const fitted = await fitImageToBudget(dataUrl, STEGO_IMAGE_BUDGET_BYTES, 1600)
        clearStegoImage()
        setStegoImage(fitted)
    }, [clearStegoImage, fitImageToBudget])

    const handleStegoSecretImageFile = useCallback(async (file) => {
        if (!file) return
        if (!file.type.startsWith("image/")) {
            toast.error("Please select an image file", { duration: 2000 })
            throw new Error("INVALID_STEGO_SECRET_FILE")
        }
        const dataUrl = /** @type {string} */ (await readFileAsDataUrl(file))
        const fitted = await fitImageToBudget(dataUrl, STEGO_IMAGE_BUDGET_BYTES, 1400)
        setStegoSecretImage(fitted)
    }, [fitImageToBudget])

    const handleStegoPreviewDragOver = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoPreviewDragActive(true)
    }, [])

    const handleStegoPreviewDragLeave = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoPreviewDragActive(false)
    }, [])

    const handleStegoPreviewDrop = useCallback(async (event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoPreviewDragActive(false)
        const file = event.dataTransfer?.files?.[0]
        if (!file) return
        try {
            await handleStegoImageFile(file)
        } catch {
            // Errors are already surfaced via toast.
        }
    }, [handleStegoImageFile])

    const handleStegoHiddenDragOver = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoHiddenDragActive(true)
    }, [])

    const handleStegoHiddenDragLeave = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoHiddenDragActive(false)
    }, [])

    const handleStegoHiddenDrop = useCallback(async (event) => {
        event.preventDefault()
        event.stopPropagation()
        setStegoHiddenDragActive(false)
        const file = event.dataTransfer?.files?.[0]
        if (!file) return
        try {
            await handleStegoSecretImageFile(file)
        } catch {
            // Errors are already surfaced via toast.
        }
    }, [handleStegoSecretImageFile])

    const sendStegoMessage = useCallback(async () => {
        const secretText = stegoSecret.trim()
        if (!stegoImage || (!secretText && !stegoSecretImage) || stegoEncoding) return

        setStegoEncoding(true)
        try {
            const previewCandidates = await buildImageCandidates(stegoImage, 1600)
            const hiddenCandidates = stegoSecretImage ? await buildImageCandidates(stegoSecretImage, 1400) : [""]

            let selectedPacket = ""
            let wasCompressed = false

            outer:
            for (const previewCandidate of previewCandidates) {
                for (const hiddenCandidate of hiddenCandidates) {
                    const packet = buildStegoPacket({
                        previewImage: previewCandidate,
                        hiddenImage: hiddenCandidate,
                        secretText,
                    })
                    if (utf8ByteLengthOf(packet) <= STEGO_PACKET_MAX_BYTES) {
                        selectedPacket = packet
                        wasCompressed =
                            previewCandidate !== stegoImage
                            || (stegoSecretImage ? hiddenCandidate !== stegoSecretImage : false)
                        break outer
                    }
                }
            }

            if (!selectedPacket) {
                throw new Error("Selected content is too large. Try smaller images or shorter secret text.")
            }

            mutate({ text: selectedPacket, type: "stego", ...(vanishAfter > 0 ? { vanishAfter } : {}) })
            void triggerSendFx()
            closeStegoModal()

            if (wasCompressed) {
                toast.success("Hidden payload sent (images auto-compressed to fit).", { duration: 2500 })
            } else {
                toast.success("Hidden payload sent.", { duration: 2200 })
            }
        } catch (err) {
            const message = err instanceof Error && err.message
                ? err.message
                : "Failed to send hidden payload"
            toast.error(message, { duration: 3000 })
        } finally {
            setStegoEncoding(false)
        }
    }, [
        stegoImage,
        stegoSecret,
        stegoSecretImage,
        stegoEncoding,
        mutate,
        vanishAfter,
        closeStegoModal,
        buildImageCandidates,
        triggerSendFx,
    ])

    const handleStegoSecretImageSelect = useCallback(async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            await handleStegoSecretImageFile(file)
        } catch {
            if (file.type.startsWith("image/")) {
                toast.error("Failed to load secret image", { duration: 2000 })
            }
        } finally {
            if (stegoSecretFileRef.current) stegoSecretFileRef.current.value = ""
        }
    }, [handleStegoSecretImageFile])

    const handleStegoImageSelect = useCallback(async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            await handleStegoImageFile(file)
        } catch {
            if (file.type.startsWith("image/")) {
                toast.error("Unable to load image. Please use PNG, JPG, or WebP.", { duration: 3000 })
            }
        } finally {
            if (stegoFileRef.current) stegoFileRef.current.value = ""
        }
    }, [handleStegoImageFile])

    const listRef = useListRef(null)
    const hasInput = input.trim().length > 0
    const isSendArmed = hasInput || isSendFxActive

    // Filter out vanished messages
    const visibleMessages = useMemo(() => {
        if (!currentMessages || vanishedIds.size === 0) return currentMessages || []
        return currentMessages.filter(m => !vanishedIds.has(m.id))
    }, [currentMessages, vanishedIds])

    // Estimate row height based on message text length
    const getRowHeight = useCallback((index) => {
        const msg = visibleMessages?.[index]
        if (!msg) return 72
        if (msg.type === "stego") {
            return 390
        }
        if (msg.type === "file") {
            const hasImagePreview = typeof msg.text === "string" && msg.text.includes("\"p\":\"data:image/")
            return hasImagePreview ? 380 : 124
        }
        if (parseLegacyFileNotice(msg.text)) return 124
        if (msg.type === "audio") return 80 // voice note player
        const charsPerLine = 60
        const lineCount = Math.ceil(msg.text.length / charsPerLine)
        return Math.max(72, 48 + lineCount * 22)
    }, [visibleMessages])

    const messageRowProps = useMemo(() => ({
        messages: visibleMessages,
        username,
        onVanish: handleVanishMessage,
        reducedMotion: shouldReduceMotion,
    }), [handleVanishMessage, shouldReduceMotion, username, visibleMessages])

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        const count = visibleMessages?.length ?? 0
        if (count > 0 && listRef.current) {
            listRef.current.scrollToRow({ index: count - 1, align: "end" })
        }
    }, [visibleMessages, listRef])


    return (
        <main
            data-nuke-source="room"
            className="scanline-bg flex flex-col h-screen max-h-screen overflow-hidden bg-black relative"
            onDragEnter={handleRoomDragEnter}
            onDragOver={handleRoomDragOver}
            onDragLeave={handleRoomDragLeave}
            onDrop={handleRoomDrop}
        >

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
                <div className="w-full px-3 py-2 pl-14 sm:px-5 sm:py-3 md:pl-14">
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
                                onClick={openPanicModal}
                                disabled={isNukeRunning || isSecureRoom}
                                className="flex items-center border border-red-900/40 bg-red-950/20 hover:bg-red-900/30 px-2 py-1.5 rounded-sm text-[11px] font-bold text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                whileTap={{ scale: 0.95 }}
                                title={isSecureRoom ? "Panic mode unavailable in secure rooms" : (panicShortcut ? `Panic mode (${panicShortcut})` : "Panic mode")}
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
                                    onClick={openPanicModal}
                                    disabled={isNukeRunning || isSecureRoom}
                                    className="flex items-center gap-1 border border-red-900/40 bg-red-950/20 hover:bg-red-900/30 px-2 py-1.5 rounded-sm text-[11px] font-bold text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                    title={isSecureRoom ? "Panic mode unavailable in secure rooms" : (panicShortcut ? `Panic Mode — ${panicShortcut}` : "Panic Mode — instantly destroy room")}
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
                            className="micro-btn flex min-w-[88px] items-center justify-center gap-1.5 border border-zinc-700/40 bg-zinc-800/60 hover:bg-zinc-700/60 px-3 py-1 rounded-sm text-[10px] font-bold transition-colors"
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
                                animate={shouldReduceMotion ? { opacity: 0.88 } : { y: [0, -8, 0] }}
                                transition={shouldReduceMotion ? { duration: DUR_BASE, ease } : { duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                            >
                                <div className="w-20 h-20 rounded-full border border-green-500/15 bg-green-500/5 flex items-center justify-center">
                                    <div className="grid grid-cols-3 gap-1">
                                        {EMPTY_STATE_MATRIX_ITEMS.map((item, index) => (
                                            <motion.span
                                                key={`${item.char}-${index}`}
                                                className="text-[9px] font-mono text-green-500/60 w-3 text-center"
                                                animate={shouldReduceMotion ? { opacity: 0.62 } : { opacity: [0.2, 0.8, 0.2] }}
                                                transition={shouldReduceMotion
                                                    ? { duration: DUR_FAST, ease }
                                                    : { duration: item.duration, repeat: Infinity, delay: item.delay, ease: "linear" }}
                                            >
                                                {item.char}
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
                        rowProps={/** @type {any} */ (messageRowProps)}
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
                                className="micro-btn shrink-0 w-10 h-10 flex items-center justify-center rounded-sm border border-zinc-700/50 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
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
                                className="micro-btn shrink-0 w-10 h-10 flex items-center justify-center rounded-sm border border-green-500/40 bg-green-600/20 hover:bg-green-600/30 text-green-400 hover:text-green-300 transition-colors"
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
                                    className={`micro-btn w-10 h-10 flex items-center justify-center rounded-full border transition-all duration-200 ${showInputMenu
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
                                            transition={{ duration: DUR_FAST, ease }}
                                            className="absolute bottom-full mb-3 left-0 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/50 rounded-lg p-2 flex gap-1.5 z-50 shadow-xl shadow-black/40"
                                        >
                                            {/* Stego */}
                                            <motion.button
                                                onClick={() => { setShowStegoModal(true); setShowInputMenu(false) }}
                                                className="micro-btn w-10 h-10 flex items-center justify-center rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-400 hover:text-purple-300 transition-colors"
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
                                                    className={`micro-btn w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${vanishAfter > 0
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

                            {/* Desktop quick tools — moved to left of input */}
                            <div className="relative hidden lg:flex items-center gap-1.5 shrink-0 rounded-xl border border-zinc-700/50 bg-zinc-900/90 p-1.5">
                                <motion.button
                                    onClick={() => { setShowStegoModal(true); setShowVanishPicker(false) }}
                                    className="micro-btn w-10 h-10 flex items-center justify-center rounded-lg bg-purple-600/15 hover:bg-purple-600/25 text-purple-400 hover:text-purple-300 transition-colors"
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
                                        className={`micro-btn w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${vanishAfter > 0
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

                            {/* Input field */}
                            <motion.div
                                className="flex-1 min-w-0 relative rounded-full border input-focus-glow overflow-hidden"
                                animate={{
                                    borderColor: hasInput
                                        ? "rgba(34,197,94,0.42)"
                                        : "rgba(63,63,70,0.3)",
                                    boxShadow: isSendFxActive
                                        ? "0 0 18px rgba(34,197,94,0.16)"
                                        : (hasInput ? "0 0 12px rgba(34,197,94,0.08)" : "0 0 0 rgba(0,0,0,0)"),
                                    scale: isSendFxActive ? [1, 0.995, 1] : 1,
                                    x: isSendFxActive ? [0, 1, 0] : 0,
                                }}
                                transition={{ duration: isSendFxActive ? DUR_SLOW : DUR_BASE, ease }}
                            >
                                <motion.button
                                    onClick={() => { setQueuedDroppedFile(null); setShowFileSendModal(true); setShowInputMenu(false); setShowVanishPicker(false) }}
                                    className="micro-btn absolute left-2 top-1/2 -translate-y-1/2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-green-600/15 hover:bg-green-600/25 text-green-400 hover:text-green-300 transition-colors"
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

                            {/* Right-side actions: Mic + Send */}
                            <div className="shrink-0 flex items-center gap-2">
                                <motion.button
                                    key="mic-btn"
                                    onClick={startRecording}
                                    className="micro-btn w-11 h-11 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-700/50 text-zinc-400 hover:text-green-400 hover:border-green-500/30 transition-colors cursor-pointer"
                                    transition={{ duration: DUR_FAST, ease }}
                                    whileTap={shouldReduceMotion ? {} : { scale: 0.9 }}
                                    title="Record voice message"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                                        <path d="M19 10v2a7 7 0 01-14 0v-2" />
                                        <line x1="12" y1="19" x2="12" y2="23" />
                                        <line x1="8" y1="23" x2="16" y2="23" />
                                    </svg>
                                </motion.button>

                                <motion.button
                                    key="send-btn"
                                    onClick={sendMessage}
                                    disabled={(!hasInput && !isSendFxActive) || isPending}
                                    className={`micro-btn relative w-[3.75rem] h-[2.75rem] sm:w-[4.25rem] sm:h-[3rem] lg:w-[4.75rem] lg:h-[3.25rem] flex items-center justify-center rounded-md border overflow-hidden transition-colors cursor-pointer ${isSendArmed
                                        ? "bg-green-950/35 hover:bg-green-900/35 border-green-500/70 text-green-400"
                                        : "bg-zinc-900 border-zinc-700/50 text-zinc-500"
                                        } ${isSendArmed
                                            ? (isSendFxActive
                                                ? "shadow-[0_0_0_1px_rgba(74,222,128,0.45),0_12px_24px_rgba(22,101,52,0.34)]"
                                                : "shadow-[0_0_0_1px_rgba(74,222,128,0.24),0_8px_20px_rgba(22,101,52,0.24)]")
                                            : "shadow-[0_0_0_1px_rgba(63,63,70,0.26),0_6px_16px_rgba(0,0,0,0.28)]"
                                        } disabled:opacity-55 disabled:cursor-not-allowed`}
                                    animate={{
                                        y: isSendFxActive ? [0, -1, 0] : 0,
                                    }}
                                    transition={{ duration: isSendFxActive ? DUR_BASE : DUR_FAST, ease }}
                                    whileHover={!shouldReduceMotion && hasInput ? { y: -1 } : { y: 0 }}
                                    whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                                    title="Send message"
                                >
                                    <motion.span
                                        className="pointer-events-none absolute inset-0 rounded-md border-2 border-green-400/60"
                                        initial={{ scale: 1, opacity: 0 }}
                                        animate={isSendFxActive ? { scale: [1, 1.32], opacity: [0.5, 0] } : { scale: 1, opacity: 0 }}
                                        transition={{ duration: DUR_BASE, ease }}
                                    />
                                    <motion.span
                                        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 h-[2px] w-12 rounded-full bg-gradient-to-r from-emerald-300/0 via-emerald-300/95 to-emerald-300/0 blur-[1px]"
                                        initial={SEND_TRAIL_REST_ANIMATION}
                                        animate={sendTrailControls}
                                    />
                                    <motion.span
                                        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 h-[1.5px] w-10 rounded-full bg-gradient-to-r from-emerald-300/0 via-emerald-300/95 to-emerald-300/0 blur-[0.8px]"
                                        initial={SEND_WIND_REST_ANIMATION}
                                        animate={sendWindControls}
                                    />

                                    <div className="relative z-10 flex items-center justify-center">
                                        <motion.span
                                            className="will-change-transform w-[1rem] h-[1rem] sm:w-[1.1rem] sm:h-[1.1rem] lg:w-[1.2rem] lg:h-[1.2rem] flex items-center justify-center"
                                            initial={SEND_PLANE_REST_ANIMATION}
                                            animate={sendPlaneControls}
                                        >
                                            <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                                <path
                                                    d="M22 2 11 13"
                                                    stroke="currentColor"
                                                    strokeWidth="1.65"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                                <path
                                                    d="M22 2 15 22 11 13 2 9 22 2Z"
                                                    stroke="currentColor"
                                                    strokeWidth="1.65"
                                                    fill="none"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                                <path
                                                    d="M11 13 15 22"
                                                    stroke="currentColor"
                                                    strokeWidth="1.65"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </motion.span>
                                    </div>
                                </motion.button>
                            </div>
                        </>
                    )}
                </div>
            </motion.div>

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
                            {isSecureRoom ? (
                                <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                                    Panic mode is unavailable in secure rooms.
                                </p>
                            ) : !hasPanicPassword ? (
                                <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                                    This room has no panic password configured.
                                </p>
                            ) : (
                                <p className="text-zinc-500 text-xs mb-4 leading-relaxed">
                                    Enter the panic password to instantly destroy this room. This cannot be undone.
                                </p>
                            )}
                            <input
                                type="password"
                                value={panicInput}
                                onChange={(e) => setPanicInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && panicInput.trim() && !isSecureRoom && hasPanicPassword) {
                                        triggerPanic(panicInput.trim())
                                    }
                                }}
                                placeholder="Panic password"
                                autoFocus
                                disabled={isSecureRoom || !hasPanicPassword}
                                className="w-full bg-black border border-red-900/40 focus:border-red-500/60 p-2.5 text-sm text-red-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 mb-4 disabled:opacity-40 disabled:cursor-not-allowed"
                            />
                            <div className="mb-4 border border-zinc-800/80 bg-zinc-900/30 rounded-sm p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                                        Panic Shortcut
                                    </p>
                                    <p className="text-[11px] text-red-300 font-mono truncate">
                                        {panicShortcut || "Not armed"}
                                    </p>
                                </div>
                                <p className="text-[10px] text-zinc-600 leading-relaxed">
                                    Stored for this browser session only. Pressing the armed combo triggers instant panic.
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsRecordingPanicShortcut((prev) => !prev)}
                                        disabled={isSecureRoom || !hasPanicPassword}
                                        className="py-1.5 rounded-sm border border-zinc-700/60 bg-zinc-900/40 hover:bg-zinc-800/60 text-[10px] font-bold text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {isRecordingPanicShortcut ? "Press keys..." : "Record"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={savePanicShortcut}
                                        disabled={isSecureRoom || !hasPanicPassword || !panicShortcut || (!panicInput.trim() && !panicShortcutPassword.trim())}
                                        className="py-1.5 rounded-sm border border-red-900/60 bg-red-950/30 hover:bg-red-900/40 text-[10px] font-bold text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Arm
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearPanicShortcut}
                                        disabled={!panicShortcut && !panicShortcutPassword}
                                        className="py-1.5 rounded-sm border border-zinc-700/60 bg-zinc-900/40 hover:bg-zinc-800/60 text-[10px] font-bold text-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-3">
                                <motion.button
                                    onClick={(event) => {
                                        setNukeOriginFromTrigger(event.currentTarget)
                                        triggerPanic(panicInput.trim())
                                    }}
                                    disabled={!panicInput.trim() || isNukeRunning || isSecureRoom || !hasPanicPassword}
                                    className="flex-1 py-2.5 rounded-sm border border-red-700/60 bg-red-900/40 hover:bg-red-800/50 text-red-300 font-bold text-sm tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    💣 DESTROY
                                </motion.button>
                                <motion.button
                                    onClick={() => {
                                        setShowPanicModal(false)
                                        setPanicInput("")
                                        setIsRecordingPanicShortcut(false)
                                    }}
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

            <AnimatePresence>
                {isRoomDragActive && !showFileSendModal && !showStegoModal && (
                    <motion.div
                        className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/55 border-2 border-dashed border-green-500/60"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                    >
                        <div className="px-6 py-4 rounded-sm border border-green-500/40 bg-zinc-950/90 text-center">
                            <p className="text-green-400 text-xs font-bold uppercase tracking-wider">Drop File To Send</p>
                            <p className="text-zinc-500 text-[10px] mt-1">Release to open recipient selection</p>
                        </div>
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
                                <h3 className="text-purple-400 font-bold text-sm uppercase tracking-wider">Hidden Payload</h3>
                            </div>
                            <p className="text-zinc-500 text-[11px] mb-4 leading-relaxed">
                                Choose the visible preview image, then attach hidden text and/or hidden image for reveal.
                            </p>

                            {/* Cover image upload */}
                            <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">Preview Image (what others see)</p>
                            <div
                                className={`mb-4 rounded-sm transition-colors ${stegoPreviewDragActive ? "ring-2 ring-purple-500/60 ring-offset-0" : ""}`}
                                onDragEnter={handleStegoPreviewDragOver}
                                onDragOver={handleStegoPreviewDragOver}
                                onDragLeave={handleStegoPreviewDragLeave}
                                onDrop={handleStegoPreviewDrop}
                            >
                                {stegoImage ? (
                                    <div className="relative group">
                                        <img src={stegoImage} alt="Preview" className="max-h-[200px] w-full object-contain rounded-sm border border-zinc-800 bg-black" />
                                        <button
                                            onClick={clearStegoImage}
                                            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-zinc-400 hover:text-white text-xs cursor-pointer"
                                        >✕</button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => stegoFileRef.current?.click()}
                                        className={`w-full py-6 border-2 border-dashed rounded-sm text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${stegoPreviewDragActive
                                            ? "border-purple-500/60 text-purple-400 bg-purple-900/10"
                                            : "border-zinc-700 text-zinc-500 hover:border-purple-500/50 hover:text-purple-400"
                                            }`}
                                    >
                                        Drop preview image here or click to select
                                    </button>
                                )}
                            </div>
                            <input ref={stegoFileRef} type="file" accept="image/*" className="hidden" onChange={handleStegoImageSelect} />

                            <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">Secret Text (optional)</p>
                            <textarea
                                value={stegoSecret}
                                onChange={e => setStegoSecret(e.target.value)}
                                placeholder="Type your secret message..."
                                rows={3}
                                className="w-full bg-black border border-zinc-800 focus:border-purple-500/50 p-3 text-sm text-purple-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 mb-4 resize-none"
                            />

                            <p className="text-zinc-600 text-[9px] uppercase tracking-widest font-bold mb-2">Hidden Image (optional)</p>
                            <div
                                className={`mb-4 rounded-sm transition-colors ${stegoHiddenDragActive ? "ring-2 ring-purple-500/60 ring-offset-0" : ""}`}
                                onDragEnter={handleStegoHiddenDragOver}
                                onDragOver={handleStegoHiddenDragOver}
                                onDragLeave={handleStegoHiddenDragLeave}
                                onDrop={handleStegoHiddenDrop}
                            >
                                {stegoSecretImage ? (
                                    <div className="relative group">
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
                                        className={`w-full py-5 border-2 border-dashed rounded-sm text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${stegoHiddenDragActive
                                            ? "border-purple-500/60 text-purple-400 bg-purple-900/10"
                                            : "border-purple-900/40 text-zinc-500 hover:border-purple-500/50 hover:text-purple-400"
                                            }`}
                                    >
                                        Drop hidden image here or click to select
                                    </button>
                                )}
                            </div>
                            <input ref={stegoSecretFileRef} type="file" accept="image/*" className="hidden" onChange={handleStegoSecretImageSelect} />
                            <p className="text-zinc-600 text-[9px] mb-4 leading-relaxed">
                                At least one secret payload is required: secret text or hidden image.
                            </p>

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
                                    disabled={!stegoImage || (!stegoSecret.trim() && !stegoSecretImage) || stegoEncoding}
                                    className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider border border-purple-500/30 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    whileTap={{ scale: 0.95 }}
                                >
                                    {stegoEncoding ? "Sending..." : "Send Hidden Payload"}
                                </motion.button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ═══════════════════ FILE SEND MODAL ═══════════════════ */}
            <FileSendModal
                isOpen={showFileSendModal}
                onClose={closeFileSendModal}
                onFileSend={handleSendFile}
                participants={participants}
                username={username}
                preselectedFile={queuedDroppedFile}
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
