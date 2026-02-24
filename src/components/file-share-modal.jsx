"use client"

import { motion, AnimatePresence } from "framer-motion"
import { useState, useRef, useCallback, useMemo } from "react"

/**
 * Formats file size to human readable
 * @param {number} bytes
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * File send modal — file picker → recipient selector → send
 *
 * @param {{ isOpen: boolean, onClose: () => void, onFileSend: (file: File, targets: string[]) => void, participants: string[], username: string }} props
 */
export function FileSendModal({ isOpen, onClose, onFileSend, participants, username }) {
    const fileInputRef = useRef(null)
    const [dragActive, setDragActive] = useState(false)
    const [selectedFile, setSelectedFile] = useState(/** @type {File | null} */(null))
    const [targetMode, setTargetMode] = useState(/** @type {"everyone" | "custom"} */("everyone"))
    const [selectedTargets, setSelectedTargets] = useState(/** @type {string[]} */([]))

    // Filter out our own username from the list
    const otherParticipants = useMemo(
        () => (participants || []).filter(p => p !== username),
        [participants, username]
    )

    const handleFile = useCallback((/** @type {File | undefined} */ file) => {
        if (!file) return
        setSelectedFile(file)
        setTargetMode("everyone")
        setSelectedTargets([])
    }, [])

    const toggleTarget = useCallback((/** @type {string} */ participant) => {
        setTargetMode("custom")
        setSelectedTargets((prev) => (
            prev.includes(participant)
                ? prev.filter((p) => p !== participant)
                : [...prev, participant]
        ))
    }, [])

    const handleSend = useCallback(() => {
        if (!selectedFile) return
        const targets = targetMode === "everyone"
            ? otherParticipants
            : selectedTargets

        if (targets.length === 0) return

        onFileSend(selectedFile, targets)
        setSelectedFile(null)
        setTargetMode("everyone")
        setSelectedTargets([])
        onClose()
    }, [selectedFile, targetMode, selectedTargets, otherParticipants, onFileSend, onClose])

    const handleClose = useCallback(() => {
        setSelectedFile(null)
        setTargetMode("everyone")
        setSelectedTargets([])
        onClose()
    }, [onClose])

    const handleDrag = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true)
        if (e.type === "dragleave") setDragActive(false)
    }, [])

    const handleDrop = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActive(false)
        if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0])
    }, [handleFile])

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleClose}
                >
                    <motion.div
                        className="border border-zinc-700/60 bg-zinc-950 rounded-sm p-6 max-w-sm w-full mx-4 shadow-2xl"
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 10 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">📁</span>
                                <h3 className="text-green-400 font-bold text-sm tracking-wide uppercase">P2P File Transfer</h3>
                            </div>
                            <button onClick={handleClose} className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <p className="text-zinc-500 text-xs mb-4">
                            Files transfer directly to your peer. Nothing touches any server.
                        </p>

                        {/* ── Step 1: File picker ── */}
                        {!selectedFile && (
                            <>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    onDragEnter={handleDrag}
                                    onDragLeave={handleDrag}
                                    onDragOver={handleDrag}
                                    onDrop={handleDrop}
                                    className={`border-2 border-dashed rounded-sm p-8 text-center cursor-pointer transition-colors ${dragActive
                                        ? "border-green-500/60 bg-green-950/20"
                                        : "border-zinc-700/50 hover:border-zinc-600/60 bg-zinc-900/20"
                                        }`}
                                >
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-zinc-500">
                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                        <polyline points="17 8 12 3 7 8" />
                                        <line x1="12" y1="3" x2="12" y2="15" />
                                    </svg>
                                    <p className="text-zinc-400 text-xs font-bold">Drop a file here</p>
                                    <p className="text-zinc-600 text-[10px] mt-1">or click to browse</p>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => handleFile(e.target.files?.[0])}
                                />
                            </>
                        )}

                        {/* ── Step 2: Recipient selector ── */}
                        {selectedFile && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                            >
                                {/* File preview */}
                                <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-sm px-3 py-2 mb-4">
                                    <p className="text-zinc-300 text-xs font-mono truncate">{selectedFile.name}</p>
                                    <p className="text-zinc-500 text-[10px]">{formatSize(selectedFile.size)}</p>
                                </div>

                                <label className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold mb-2 block">
                                    Send to
                                </label>

                                {/* Send to everyone */}
                                <button
                                    onClick={() => setTargetMode("everyone")}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-sm mb-1.5 border text-left transition-colors cursor-pointer ${targetMode === "everyone"
                                        ? "border-green-600/50 bg-green-950/30 text-green-400"
                                        : "border-zinc-700/40 bg-zinc-900/30 text-zinc-400 hover:border-zinc-600/50"
                                        }`}
                                >
                                    <span className="text-lg">🌐</span>
                                    <div className="flex-1">
                                        <p className="text-xs font-bold">Everyone in room</p>
                                        <p className="text-[10px] text-zinc-500">{otherParticipants.length} participant{otherParticipants.length !== 1 ? "s" : ""}</p>
                                    </div>
                                    {targetMode === "everyone" && (
                                        <span className="text-green-400 text-xs">✓</span>
                                    )}
                                </button>

                                {/* Individual participants */}
                                <div className="max-h-40 overflow-y-auto space-y-1 mb-4 custom-scrollbar">
                                    {otherParticipants.map((p) => (
                                        <button
                                            key={p}
                                            onClick={() => toggleTarget(p)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm border text-left transition-colors cursor-pointer ${targetMode === "custom" && selectedTargets.includes(p)
                                                ? "border-green-600/50 bg-green-950/30 text-green-400"
                                                : "border-zinc-700/40 bg-zinc-900/30 text-zinc-400 hover:border-zinc-600/50"
                                                }`}
                                        >
                                            <span className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold uppercase">
                                                {p.charAt(0)}
                                            </span>
                                            <span className="text-xs font-mono truncate flex-1">{p}</span>
                                            {targetMode === "custom" && selectedTargets.includes(p) && (
                                                <span className="text-green-400 text-xs">✓</span>
                                            )}
                                        </button>
                                    ))}
                                    {otherParticipants.length === 0 && (
                                        <div className="px-3 py-2 text-[11px] text-zinc-500 border border-zinc-800 rounded-sm bg-zinc-900/20">
                                            No recipients in room yet.
                                        </div>
                                    )}
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    <motion.button
                                        onClick={handleSend}
                                        disabled={targetMode === "everyone" ? otherParticipants.length === 0 : selectedTargets.length === 0}
                                        className="flex-1 py-2.5 rounded-sm border border-green-600/50 bg-green-950/40 hover:bg-green-900/40 text-green-400 text-xs font-bold tracking-wider transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        whileTap={{ scale: 0.97 }}
                                    >
                                        📤 SEND
                                    </motion.button>
                                    <motion.button
                                        onClick={handleClose}
                                        className="flex-1 py-2.5 rounded-sm border border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-700/40 text-zinc-400 text-xs font-bold tracking-wider transition-colors cursor-pointer"
                                        whileTap={{ scale: 0.97 }}
                                    >
                                        CANCEL
                                    </motion.button>
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}

/**
 * Incoming file offer notification
 */
export function FileOfferToast({ filename, fileSize, from, onAccept, onReject }) {
    return (
        <div className="flex flex-col gap-2 min-w-[240px] max-w-[280px]">
            <div className="flex items-center gap-2">
                <span className="text-lg">📨</span>
                <div>
                    <p className="text-green-400 text-xs font-bold">Incoming File</p>
                    <p className="text-zinc-400 text-[10px]">from {from}</p>
                </div>
            </div>
            <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-sm px-3 py-2">
                <p className="text-zinc-300 text-xs font-mono truncate">{filename}</p>
                <p className="text-zinc-500 text-[10px]">{formatSize(fileSize)}</p>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={onAccept}
                    className="flex-1 py-1.5 rounded-sm border border-green-900/50 bg-green-950/40 hover:bg-green-900/40 text-green-400 text-xs font-bold transition-colors cursor-pointer"
                >
                    Accept
                </button>
                <button
                    onClick={onReject}
                    className="flex-1 py-1.5 rounded-sm border border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-700/40 text-zinc-400 text-xs font-bold transition-colors cursor-pointer"
                >
                    Reject
                </button>
            </div>
        </div>
    )
}

/**
 * Transfer progress bar
 */
export function TransferProgress({ progress, filename, direction, status, onCancel }) {
    const pct = Math.round(progress * 100)
    const canCancel = direction === "send" && (status === "waiting" || status === "active")

    return (
        <AnimatePresence>
            {status !== "idle" && (
                <motion.div
                    className="fixed bottom-24 left-3 right-3 sm:left-auto sm:right-4 z-50 border border-zinc-700/60 bg-zinc-950 rounded-sm p-4 shadow-2xl sm:w-72"
                    initial={{ opacity: 0, y: 20, x: 20 }}
                    animate={{ opacity: 1, y: 0, x: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                    <div className="flex items-center gap-2 mb-2">
                        <span>{direction === "send" ? "📤" : "📥"}</span>
                        <p className="text-xs font-bold text-zinc-300 truncate flex-1">{filename}</p>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                        <motion.div
                            className="h-full bg-green-500 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                    <p className="text-[10px] text-zinc-500 font-mono">
                        {status === "complete" ? (
                            <span className="text-green-400">✓ Transfer complete</span>
                        ) : status === "cancelled" ? (
                            <span className="text-amber-400">⏹ Transfer cancelled</span>
                        ) : status === "error" ? (
                            <span className="text-red-400">✕ Transfer failed</span>
                        ) : status === "waiting" ? (
                            "Waiting for peer..."
                        ) : (
                            `${pct}% — ${direction === "send" ? "Sending" : "Receiving"}...`
                        )}
                    </p>
                    {canCancel && (
                        <button
                            onClick={onCancel}
                            className="mt-3 w-full py-1.5 rounded-sm border border-amber-700/50 bg-amber-950/30 hover:bg-amber-900/30 text-amber-300 text-[10px] font-bold tracking-wider transition-colors cursor-pointer"
                        >
                            STOP SENDING
                        </button>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    )
}
