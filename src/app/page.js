"use client"

import { useUsername } from "@/hooks/use-username";
import { useAuth } from "@/hooks/use-auth";
import { client } from "@/lib/client";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { CyberCanvas } from "@/components/cyber-canvas";
import { deriveGatekeeperProofHex, deriveRoomKeyHex, persistRoomKey, randomHex } from "@/lib/secure-crypto";
import { DUR_BASE, DUR_FAST, DUR_SLOW, EASE_STANDARD } from "@/lib/motion-tokens";

const ease = EASE_STANDARD

/**
 * @param {string} key
 */
const normalizeShortcutKey = (key) => {
  if (!key || typeof key !== "string") return ""
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
const shortcutFromKeyboardEvent = (event) => {
  if (!event || event.repeat) return ""
  const key = normalizeShortcutKey(event.key)
  if (!key) return ""
  const parts = []
  if (event.ctrlKey) parts.push("Ctrl")
  if (event.metaKey) parts.push("Meta")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  if (parts.length === 0) return ""
  parts.push(key)
  return parts.join("+")
}

/* ── Reusable styled input ── */
const StyledInput = ({ label = null, icon = null, ...props }) => (
  <div className="space-y-1.5">
    {label && (
      <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
        {icon}
        {label}
      </label>
    )}
    <input
      {...props}
      className={`w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 ${props.className || ""}`}
    />
  </div>
)

/* ── Room Creation Modal ── */
function CreateRoomModal({ isOpen, onClose, onSubmit, isPending }) {
  const [ttlMinutes, setTtlMinutes] = useState(10)
  const [isPermanent, setIsPermanent] = useState(false)
  const [maxParticipants, setMaxParticipants] = useState(2)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [securityQuestion, setSecurityQuestion] = useState("")
  const [securityAnswer, setSecurityAnswer] = useState("")
  const [panicShortcut, setPanicShortcut] = useState("")
  const [isRecordingPanicShortcut, setIsRecordingPanicShortcut] = useState(false)

  // Password strength checks
  const pwChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  }
  const pwStrength = Object.values(pwChecks).filter(Boolean).length
  const pwValid = password.length === 0 || pwStrength === 5
  const pwColor = pwStrength <= 1 ? 'bg-red-500' : pwStrength <= 3 ? 'bg-amber-500' : pwStrength <= 4 ? 'bg-yellow-400' : 'bg-green-500'

  const handleSubmit = () => {
    const config = { ttlMinutes: isPermanent ? 0 : ttlMinutes, maxParticipants }
    if (password.trim()) config.password = password.trim()
    if (panicShortcut.trim()) config.panicPassword = panicShortcut.trim()
    const question = securityQuestion.trim()
    const answer = securityAnswer.trim()
    if (question && answer) {
      config.securityQuestion = question
      config.securityAnswer = answer
    }
    onSubmit(config)
  }

  const canSubmit = !isPending && pwValid && (panicShortcut.trim() === '' || panicShortcut !== password)

  const handlePanicShortcutKeyDown = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (event.key === "Backspace" || event.key === "Delete") {
      setPanicShortcut("")
      return
    }
    if (event.key === "Escape") {
      setIsRecordingPanicShortcut(false)
      return
    }

    const shortcut = shortcutFromKeyboardEvent(event.nativeEvent)
    if (!shortcut) return
    setPanicShortcut(shortcut)
    setIsRecordingPanicShortcut(false)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR_FAST, ease }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-sm overflow-hidden"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: DUR_SLOW, ease }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-500">
                  <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Configure Room</h2>
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-5 max-h-[65vh] overflow-y-auto custom-scrollbar">
              {/* Time Limit */}
              <div className="space-y-2">
                <label className="flex items-center justify-between text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <span className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400">
                      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                    </svg>
                    Self-destruct timer
                  </span>
                  <span className={`text-xs font-bold tabular-nums ${isPermanent ? 'text-green-400' : 'text-amber-400'}`}>
                    {isPermanent ? '∞ PERMANENT' : `${ttlMinutes} min`}
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(Number(e.target.value))}
                  disabled={isPermanent}
                  className={`w-full accent-green-500 styled-range ${isPermanent ? 'opacity-30 cursor-not-allowed' : ''}`}
                />
                <div className="flex items-center justify-between">
                  <div className="flex justify-between text-[9px] text-zinc-600 font-mono flex-1">
                    <span>1 min</span><span>60 min</span>
                  </div>
                </div>
                {/* Permanent toggle */}
                <button
                  type="button"
                  onClick={() => setIsPermanent(!isPermanent)}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-sm border text-[11px] font-bold uppercase tracking-wider transition-all ${isPermanent
                    ? 'border-green-500/40 bg-green-950/30 text-green-400'
                    : 'border-zinc-800 bg-zinc-900/30 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                    }`}
                >
                  <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all ${isPermanent ? 'border-green-500/60 bg-green-500/20' : 'border-zinc-600'
                    }`}>
                    {isPermanent && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-green-400">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  Permanent Room (no expiry)
                </button>
              </div>

              {/* Max Participants */}
              <div className="space-y-2">
                <label className="flex items-center justify-between text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <span className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
                    </svg>
                    Max Participants
                  </span>
                  <span className="text-teal-400 text-xs font-bold tabular-nums">{maxParticipants}</span>
                </label>
                <input
                  type="range"
                  min={2}
                  max={10}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(Number(e.target.value))}
                  className="w-full accent-green-500 styled-range"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
                  <span>2</span><span>10</span>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-zinc-800/60" />

              {/* Password */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Room Password
                  <span className="text-zinc-600 normal-case tracking-normal">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Leave empty for open access"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 pr-10 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-2 -mt-1">
                  <div className="flex gap-1 h-1">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`flex-1 rounded-full transition-all duration-300 ${i < pwStrength ? pwColor : 'bg-zinc-800'}`} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {[
                      ['8+ characters', pwChecks.length],
                      ['Uppercase (A-Z)', pwChecks.upper],
                      ['Lowercase (a-z)', pwChecks.lower],
                      ['Digit (0-9)', pwChecks.digit],
                      ['Special (!@#...)', pwChecks.special],
                    ].map(([label, ok]) => (
                      <span key={String(label)} className={`text-[9px] font-mono ${ok ? 'text-green-500' : 'text-zinc-600'}`}>
                        {ok ? '✓' : '○'} {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Panic Shortcut */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Panic Shortcut
                  <span className="text-zinc-600 normal-case tracking-normal">(optional — instant destroy)</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={panicShortcut}
                    readOnly
                    onFocus={() => setIsRecordingPanicShortcut(true)}
                    onBlur={() => setIsRecordingPanicShortcut(false)}
                    onKeyDown={handlePanicShortcutKeyDown}
                    placeholder="Click and press keys (e.g. Ctrl+Shift+K)"
                    className={`w-full bg-zinc-950 border border-red-900/40 focus:border-red-500/60 p-2.5 pr-24 text-sm text-red-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600 ${isRecordingPanicShortcut ? "ring-1 ring-red-500/40" : ""}`}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setIsRecordingPanicShortcut((prev) => !prev)}
                      className="px-2 py-0.5 text-[10px] font-bold rounded border border-zinc-700/70 bg-zinc-900/70 text-zinc-300 hover:text-zinc-100 transition-colors"
                    >
                      {isRecordingPanicShortcut ? "REC" : "SET"}
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setPanicShortcut("")}
                      disabled={!panicShortcut}
                      className="w-5 h-5 text-[11px] rounded border border-zinc-700/70 bg-zinc-900/70 text-zinc-300 hover:text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Clear shortcut"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <p className="text-zinc-600 text-[9px] font-mono">
                  {isRecordingPanicShortcut
                    ? "Recording... press combo with at least one modifier key."
                    : "This combo will trigger panic destroy in-room."}
                </p>
                {panicShortcut && panicShortcut === password && (
                  <p className="text-red-400 text-[9px] font-bold">⚠ Must be different from room password</p>
                )}
              </div>

              {/* Security Question */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400">
                    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Security Question
                  <span className="text-zinc-600 normal-case tracking-normal">(optional 2FA)</span>
                </label>
                <input
                  type="text"
                  value={securityQuestion}
                  onChange={(e) => setSecurityQuestion(e.target.value)}
                  placeholder="e.g. What is our secret code?"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                />
              </div>

              {/* Security Answer — always visible */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Security Answer
                  <span className="text-zinc-600 normal-case tracking-normal">(optional, used only with question)</span>
                </label>
                <input
                  type="text"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                  placeholder="Answer to your security question"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-zinc-800/60 flex items-center gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-zinc-700/50 bg-zinc-900/50 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 py-2.5 text-sm font-bold rounded-sm transition-colors"
              >
                Cancel
              </button>
              <motion.button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="flex-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 hover:border-green-400/40 text-green-400 hover:text-green-300 py-2.5 text-sm font-bold rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                whileHover={canSubmit ? { scale: 1.02 } : {}}
                whileTap={canSubmit ? { scale: 0.98 } : {}}
              >
                <AnimatePresence mode="wait">
                  {isPending ? (
                    <motion.span key="loading" className="flex items-center justify-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                      </motion.svg>
                      Creating...
                    </motion.span>
                  ) : (
                    <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      Create Secure Room
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ── Room Verification Modal ── */
function VerifyRoomModal({ isOpen, onClose, roomId, hasPassword, securityQuestion, secure = false, roomSaltHex = "", kdfIterations = 100_000, onVerified }) {
  const [password, setPassword] = useState("")
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState("")
  const [isVerifying, setIsVerifying] = useState(false)

  const handleVerify = async () => {
    setError("")
    setIsVerifying(true)
    try {
      if (secure) {
        if (!securityQuestion || !answer.trim()) {
          setError("Security answer is required")
          return
        }
        const roomKeyHex = await deriveRoomKeyHex(answer.trim(), roomSaltHex, kdfIterations)
        const proofHex = await deriveGatekeeperProofHex(roomKeyHex)
        const secureRes = await fetch("/api/room/verify-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, proofHex }),
          credentials: "include",
        })
        const secureData = await secureRes.json()
        if (!secureRes.ok || secureData?.ok !== true) {
          setError(secureData?.error || "Secure verification failed")
          return
        }
        persistRoomKey(roomId, roomKeyHex)
        onVerified()
        return
      }

      const body = { roomId }
      if (hasPassword) body.password = password
      if (securityQuestion) body.securityAnswer = answer

      const res = await fetch("/api/room/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Verification failed")
        return
      }

      // Set verified cookie so proxy lets us through
      document.cookie = `room-verified-${roomId}=true; path=/; max-age=3600; SameSite=Strict`
      onVerified()
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR_FAST, ease }}
        >
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-sm overflow-hidden"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: DUR_SLOW, ease }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Room Verification</h2>
              </div>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <p className="text-zinc-500 text-xs">This room requires verification before entry.</p>

              {hasPassword && (
                <StyledInput
                  label="Room Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter room password"
                  icon={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>}
                />
              )}

              {securityQuestion && (
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400">
                      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Security Question
                  </label>
                  <p className="text-sm text-zinc-300 bg-zinc-900/50 border border-zinc-800/50 px-3 py-2 rounded-sm font-mono">
                    {securityQuestion}
                  </p>
                  <StyledInput
                    type="text"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Your answer"
                  />
                </div>
              )}

              <AnimatePresence>
                {error && (
                  <motion.p
                    className="text-red-400 text-xs font-bold bg-red-950/30 border border-red-900/30 px-3 py-2 rounded-sm"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    ⚠ {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="px-5 py-4 border-t border-zinc-800/60 flex items-center gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-zinc-700/50 bg-zinc-900/50 hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 py-2.5 text-sm font-bold rounded-sm transition-colors"
              >
                Cancel
              </button>
              <motion.button
                onClick={handleVerify}
                disabled={isVerifying}
                className="flex-1 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 hover:border-green-400/40 text-green-400 hover:text-green-300 py-2.5 text-sm font-bold rounded-sm transition-colors disabled:opacity-40"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isVerifying ? "Verifying..." : "Verify & Enter"}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ═══════════════════════════════════════════════════════════════
   Main Home Page
   ═══════════════════════════════════════════════════════════════ */
function HomeContent() {
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()
  const { username } = useUsername()
  const { user: authUser, updateUsername: authUpdateUsername, updateAvatar: authUpdateAvatar } = useAuth()
  const displayName = authUser?.username || username
  const [isHovered, setIsHovered] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Profile editing state
  const [isEditingUsername, setIsEditingUsername] = useState(false)
  const [editUsername, setEditUsername] = useState("")
  const [usernameAvailable, setUsernameAvailable] = useState(null) // null | true | false
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef(null)
  const usernameCheckTimer = useRef(null)

  // Join room state
  const [joinRoomId, setJoinRoomId] = useState("")
  const [isJoining, setIsJoining] = useState(false)

  // Verification modal state
  const [verifyModal, setVerifyModal] = useState({
    open: false,
    roomId: "",
    hasPassword: false,
    securityQuestion: null,
    secure: false,
    roomSaltHex: "",
    kdfIterations: 100_000,
  })

  const searchParams = useSearchParams()
  const wasDestroyed = searchParams.get("destroyed") === "true"
  const error = searchParams.get("error")
  const authRoomId = searchParams.get("roomId")
  const hasTransientAlert = wasDestroyed || error === "room-not-found" || error === "room-full" || error === "room-expired" || error === "room-access-denied"

  // Show toast notifications for errors — use unique IDs to prevent duplicates
  useEffect(() => {
    if (wasDestroyed) {
      toast.error("ROOM DESTROYED", {
        id: "room-destroyed",
        description: "All messages have been permanently deleted.",
        duration: 5000,
      })
    }
    if (error === "room-not-found") {
      toast.error("ROOM NOT FOUND", {
        id: "room-not-found",
        description: "This room may have expired or never existed.",
        duration: 5000,
      })
    }
    if (error === "room-full") {
      toast.error("ROOM FULL", {
        id: "room-full",
        description: "This room is at full capacity.",
        duration: 5000,
      })
    }
    if (error === "room-expired") {
      toast.error("ROOM EXPIRED", {
        id: "room-expired",
        description: "This room timed out. Create a new secure room to continue.",
        duration: 5000,
      })
    }
    if (error === "room-access-denied") {
      toast.error("ACCESS DENIED", {
        id: "room-access-denied",
        description: "You exited this room and can no longer re-enter it.",
        duration: 5000,
      })
    }
    // Clean URL params to prevent re-firing on remount
    if (hasTransientAlert) {
      window.history.replaceState({}, "", "/")
    }
  }, [wasDestroyed, error, hasTransientAlert])

  // If redirected here because room needs auth, auto-open verify modal
  useEffect(() => {
    if (error === "room-auth-required" && authRoomId) {
      // Fetch room info so we know what to prompt for
      fetch(`/api/room/info?roomId=${authRoomId}`)
        .then(r => r.json())
        .then(data => {
          if (data.exists) {
            setVerifyModal({
              open: true,
              roomId: authRoomId,
              hasPassword: data.hasPassword,
              securityQuestion: data.securityQuestion,
              secure: data.secure === true,
              roomSaltHex: data.roomSaltHex || "",
              kdfIterations: Number(data.kdfIterations || 100_000),
            })
          } else {
            toast.error("ROOM NOT FOUND", { description: "This room may have expired.", duration: 5000 })
          }
        })
        .catch(() => toast.error("Failed to load room info"))
    }
  }, [error, authRoomId])

  useEffect(() => {
    if (!hasTransientAlert && error !== "room-auth-required") return

    const timer = setTimeout(() => {
      router.replace("/", { scroll: false })
    }, 5000)

    return () => clearTimeout(timer)
  }, [hasTransientAlert, error, router])

  const { mutate: createRoom, isPending } = useMutation({
    mutationFn: async (/** @type {object} */ config) => {
      const hasSecureGate = typeof config?.securityQuestion === "string"
        && config.securityQuestion.trim().length > 0
        && typeof config?.securityAnswer === "string"
        && config.securityAnswer.trim().length > 0

      if (hasSecureGate) {
        const roomSaltHex = randomHex(16)
        const kdfIterations = 100_000
        const roomKeyHex = await deriveRoomKeyHex(config.securityAnswer.trim(), roomSaltHex, kdfIterations)
        const gatekeeperVerifierHex = await deriveGatekeeperProofHex(roomKeyHex)
        const secureCreateRes = await fetch("/api/room/create-secure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            securityQuestion: config.securityQuestion.trim(),
            roomSaltHex,
            kdfIterations,
            gatekeeperVerifierHex,
            maxParticipants: Number(config.maxParticipants || 2),
          }),
        })
        const secureCreateData = await secureCreateRes.json()
        if (!secureCreateRes.ok) {
          throw new Error(secureCreateData?.error || "Failed to create secure room")
        }
        const roomId = secureCreateData?.roomId
        const proofHex = await deriveGatekeeperProofHex(roomKeyHex)
        const verifyRes = await fetch("/api/room/verify-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ roomId, proofHex }),
        })
        const verifyData = await verifyRes.json()
        if (!verifyRes.ok || verifyData?.ok !== true) {
          throw new Error(verifyData?.error || "Failed to initialize secure room session")
        }
        persistRoomKey(roomId, roomKeyHex)
        setShowCreateModal(false)
        router.push(`/room/${roomId}`)
        return
      }

      // Legacy room flow (compat mode)
      // @ts-ignore
      const res = await client.room.create.post(config)
      if (res.status === 200) {
        const newRoomId = res.data?.roomId
        setShowCreateModal(false)

        const panicShortcut = typeof config?.panicPassword === "string" ? config.panicPassword.trim() : ""
        if (typeof window !== "undefined" && newRoomId && panicShortcut) {
          sessionStorage.setItem(`panic-shortcut:${newRoomId}`, JSON.stringify({
            combo: panicShortcut,
            panicPassword: panicShortcut,
          }))
        }

        // Auto-track permanent rooms for logged-in users
        // @ts-ignore
        if (authUser && config.ttlMinutes === 0 && newRoomId) {
          fetch("/api/auth/track-room", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomId: newRoomId }),
            credentials: "include",
          }).catch(() => { /* ignore tracking errors */ })
        }

        router.push(`/room/${newRoomId}`)
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to create room"
      toast.error("CREATE FAILED", { description: message, duration: 4000 })
    },
  })

  // Join room flow
  const handleJoinRoom = useCallback(async () => {
    const id = joinRoomId.trim()
    if (!id) return

    setIsJoining(true)
    try {
      const res = await fetch(`/api/room/info?roomId=${id}`)
      const data = await res.json()

      if (!data.exists) {
        toast.error("ROOM NOT FOUND", { description: "No room found with this ID.", duration: 4000 })
        return
      }

      // If room needs verification, show modal
      if (data.hasPassword || data.securityQuestion) {
        setVerifyModal({
          open: true,
          roomId: id,
          hasPassword: data.hasPassword,
          securityQuestion: data.securityQuestion,
          secure: data.secure === true,
          roomSaltHex: data.roomSaltHex || "",
          kdfIterations: Number(data.kdfIterations || 100_000),
        })
        return
      }

      // No verification needed — go directly
      router.push(`/room/${id}`)
    } catch {
      toast.error("Error", { description: "Failed to check room. Try again.", duration: 4000 })
    } finally {
      setIsJoining(false)
    }
  }, [joinRoomId, router])

  // ── Profile editing handlers ──
  const startEditUsername = useCallback(() => {
    if (!authUser) return
    setEditUsername(authUser.username)
    setUsernameAvailable(null)
    setIsEditingUsername(true)
  }, [authUser])

  const cancelEditUsername = useCallback(() => {
    setIsEditingUsername(false)
    setEditUsername("")
    setUsernameAvailable(null)
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current)
  }, [])

  const handleUsernameChange = useCallback((value) => {
    setEditUsername(value)
    setUsernameAvailable(null)
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current)
    const trimmed = value.trim()
    if (trimmed.length < 3 || trimmed.length > 30) {
      setUsernameAvailable(false)
      return
    }
    if (trimmed.toLowerCase() === authUser?.username?.toLowerCase()) {
      setUsernameAvailable(null)
      return
    }
    setUsernameChecking(true)
    usernameCheckTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(trimmed)}`, { credentials: "include" })
        const data = await res.json()
        setUsernameAvailable(data.available)
      } catch {
        setUsernameAvailable(null)
      } finally {
        setUsernameChecking(false)
      }
    }, 400)
  }, [authUser])

  const saveUsername = useCallback(async () => {
    const trimmed = editUsername.trim()
    if (!trimmed || trimmed === authUser?.username) {
      cancelEditUsername()
      return
    }
    setUsernameSaving(true)
    try {
      await authUpdateUsername(trimmed)
      toast.success("Username updated", { duration: 2000 })
      setIsEditingUsername(false)
    } catch (err) {
      toast.error(err.message || "Failed to update username", { duration: 3000 })
    } finally {
      setUsernameSaving(false)
    }
  }, [editUsername, authUser, authUpdateUsername, cancelEditUsername])

  const handleAvatarUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file", { duration: 2000 })
      return
    }
    if (file.size > 500_000) {
      toast.error("Image too large (max 500KB)", { duration: 2000 })
      return
    }
    setAvatarUploading(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      await authUpdateAvatar(dataUrl)
      toast.success("Photo updated", { duration: 2000 })
    } catch (err) {
      toast.error(err.message || "Failed to upload photo", { duration: 3000 })
    } finally {
      setAvatarUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
    }
  }, [authUpdateAvatar])

  // 3D tilt state for the main card
  const cardRef = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const handleCardMouse = useCallback((e) => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: y * -6, y: x * 6 }) // max ±3° rotation
  }, [])
  const resetTilt = useCallback(() => setTilt({ x: 0, y: 0 }), [])

  return (
    <main className="min-h-screen flex items-center justify-center relative overflow-hidden bg-black">

      {/* Particle grid background */}
      <CyberCanvas opacity={0.7} />

      {/* Ambient glow orbs */}
      <motion.div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(34,197,94,0.04) 0%, transparent 70%)" }}
        animate={prefersReducedMotion ? { opacity: 0.55 } : { scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={prefersReducedMotion ? { duration: DUR_BASE, ease } : { duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="w-full max-w-md space-y-6 relative z-10 px-4 sm:px-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR_BASE, ease }}
      >
        {/* ── Lock Icon ── */}
        <motion.div
          className="flex justify-center"
          initial={{ opacity: 0, scale: 0.5, rotate: -10 }}
          animate={prefersReducedMotion ? { opacity: 1, scale: 1, rotate: 0 } : { opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: DUR_SLOW, delay: 0.05, ease }}
        >
          <div className="w-12 h-12 rounded-full border border-green-500/20 bg-green-500/5 flex items-center justify-center animate-float">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-500">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
        </motion.div>

        {/* ── Title ── */}
        <motion.div
          className="text-center space-y-2"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR_SLOW, delay: 0.15, ease }}
        >
          <h1 className="text-2xl font-bold tracking-tight text-green-500 animate-flicker">
            {">"}redacted.chat
          </h1>
          <motion.p
            className="text-zinc-500 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR_BASE, delay: 0.4, ease }}
          >
            {"A private, self-destructing chat room.".split("").map((ch, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={prefersReducedMotion ? { opacity: 1, filter: "blur(0px)" } : { opacity: 1, filter: "blur(0px)" }}
                transition={{ duration: DUR_FAST, delay: 0.5 + i * 0.02, ease }}
              >{ch}</motion.span>
            ))}
          </motion.p>
        </motion.div>

        {/* ── Card ── */}
        <motion.div
          ref={cardRef}
          className="glass p-6 rounded-sm relative overflow-hidden card-3d"
          initial={{ opacity: 0, y: 20 }}
          animate={prefersReducedMotion ? { opacity: 1, y: 0, rotateX: 0, rotateY: 0 } : { opacity: 1, y: 0, rotateX: tilt.x, rotateY: tilt.y }}
          transition={{ duration: DUR_SLOW, delay: 0.25, ease, rotateX: { duration: DUR_FAST }, rotateY: { duration: DUR_FAST } }}
          onMouseMove={prefersReducedMotion ? undefined : handleCardMouse}
          onMouseLeave={prefersReducedMotion ? undefined : resetTilt}
        >
          {/* Shimmer overlay on card */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: DUR_BASE, ease }}
            >
            <div className="animate-shimmer absolute inset-0 rounded-sm" />
          </motion.div>

          <div className="space-y-5 relative z-10">
            {/* Identity label */}
            <motion.div
              className="space-y-3"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: DUR_BASE, delay: 0.35, ease }}
            >
              <label className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-widest font-bold">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Your Identity
              </label>

              {authUser ? (
                /* ── Authenticated user: editable profile ── */
                <div className="flex flex-col items-center gap-3">

                  {/* Profile photo */}
                  <div className="relative group">
                    <motion.button
                      onClick={() => avatarInputRef.current?.click()}
                      className="relative w-16 h-16 rounded-full border-2 border-zinc-700 hover:border-green-500/50 bg-zinc-900 flex items-center justify-center overflow-hidden transition-all cursor-pointer"
                      whileHover={prefersReducedMotion ? {} : { scale: 1.05 }}
                      whileTap={prefersReducedMotion ? {} : { scale: 0.95 }}
                      disabled={avatarUploading}
                    >
                      {authUser.avatar ? (
                        <img src={authUser.avatar} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-500">
                          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      )}
                      {/* Camera overlay on hover */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
                        {avatarUploading ? (
                          <motion.svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                            <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                          </motion.svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white">
                            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                        )}
                      </div>
                    </motion.button>
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </div>

                  {/* Editable username */}
                  {isEditingUsername ? (
                    <div className="w-full space-y-2">
                      <div className="relative">
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => handleUsernameChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && usernameAvailable !== false && !usernameChecking) saveUsername()
                            if (e.key === "Escape") cancelEditUsername()
                          }}
                          maxLength={30}
                          autoFocus
                          className="w-full bg-zinc-950 border border-zinc-700 focus:border-green-500/50 p-2 text-sm text-zinc-300 font-mono text-center rounded-sm outline-none transition-colors"
                        />
                        {/* Availability indicator */}
                        {editUsername.trim() && editUsername.trim().toLowerCase() !== authUser?.username?.toLowerCase() && (
                          <div className="absolute right-2 top-1/2 -translate-y-1/2">
                            {usernameChecking ? (
                              <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-500" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                              </motion.svg>
                            ) : usernameAvailable === true ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : usernameAvailable === false ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-400">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            ) : null}
                          </div>
                        )}
                      </div>
                      {usernameAvailable === false && editUsername.trim().length >= 3 && (
                        <p className="text-red-400 text-[10px] font-bold text-center">Username taken</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={cancelEditUsername}
                          className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-zinc-700 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-400 rounded-sm transition-colors"
                        >
                          Cancel
                        </button>
                        <motion.button
                          onClick={saveUsername}
                          disabled={usernameSaving || usernameAvailable === false || usernameChecking || !editUsername.trim() || editUsername.trim().length < 3}
                          className="flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider border border-green-500/30 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          whileTap={prefersReducedMotion ? {} : { scale: 0.97 }}
                        >
                          {usernameSaving ? "Saving..." : "Save"}
                        </motion.button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={startEditUsername}
                      className="group flex items-center gap-2 cursor-pointer"
                      title="Edit username"
                    >
                      <span className="text-sm text-green-400 font-mono font-bold">{displayName}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600 group-hover:text-green-400 transition-colors">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  )}
                  <span className="text-[9px] text-green-600/60 uppercase tracking-widest font-bold">Authenticated</span>
                </div>
              ) : (
                /* ── Guest user: read-only ── */
                <div className="flex items-center gap-3">
                  <motion.div
                    className="flex-1 bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-400 font-mono text-center rounded-sm"
                    initial={{ opacity: 0, scaleX: 0.8 }}
                    animate={{ opacity: 1, scaleX: 1 }}
                    transition={{ duration: DUR_BASE, delay: 0.45, ease }}
                  >
                    {displayName}
                  </motion.div>
                </div>
              )}
            </motion.div>

            {/* Create room button — opens modal */}
            <motion.button
              onClick={() => setShowCreateModal(true)}
              disabled={isPending}
              className="w-full bg-zinc-200 text-black p-3 text-sm font-bold hover:bg-white transition-all mt-2 cursor-pointer disabled:opacity-50 rounded-sm relative overflow-hidden group scan-line-btn"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR_BASE, delay: 0.55, ease }}
              whileHover={prefersReducedMotion ? {} : { scale: 1.015 }}
              whileTap={prefersReducedMotion ? {} : { scale: 0.985 }}
              onHoverStart={() => setIsHovered(true)}
              onHoverEnd={() => setIsHovered(false)}
            >
              {/* Subtle shine sweep on hover */}
              <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12"
              initial={{ x: "-100%" }}
              animate={prefersReducedMotion ? { x: "-100%" } : (isHovered ? { x: "200%" } : { x: "-100%" })}
              transition={{ duration: DUR_SLOW, ease: "easeInOut" }}
            />
              <span className="relative z-10">Create a Secure Room</span>
            </motion.button>
          </div>
        </motion.div>

        {/* ── Join Room Section ── */}
        <motion.div
          className="glass p-5 rounded-sm relative overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR_SLOW, delay: 0.4, ease }}
        >
          <div className="space-y-3 relative z-10">
            <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Join Existing Room
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                placeholder="Enter Room ID"
                className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
              />
              <motion.button
                onClick={handleJoinRoom}
                disabled={!joinRoomId.trim() || isJoining}
                className="bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 hover:border-green-400/40 text-green-400 hover:text-green-300 px-5 py-2.5 text-sm font-bold rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                whileHover={prefersReducedMotion ? {} : (joinRoomId.trim() ? { scale: 1.03 } : {})}
                whileTap={prefersReducedMotion ? {} : (joinRoomId.trim() ? { scale: 0.97 } : {})}
              >
                {isJoining ? (
                  <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                  </motion.svg>
                ) : "Join"}
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* ── Bottom note ── */}
        <motion.p
          className="text-center text-[10px] text-zinc-600 tracking-wide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR_BASE, delay: 0.8, ease }}
        >
          End-to-end encrypted · Messages auto-delete · No logs
        </motion.p>

        {/* Auth link */}
        {!authUser && (
          <motion.div
            className="text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR_BASE, delay: 0.9, ease }}
          >
            <Link
              href="/auth"
              className="text-green-600 text-xs hover:text-green-400 transition-colors font-bold uppercase tracking-wider"
            >
              Sign In / Sign Up →
            </Link>
          </motion.div>
        )}
      </motion.div>

      {/* ── Modals ── */}
      <CreateRoomModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={(config) => createRoom(config)}
        isPending={isPending}
      />

      <VerifyRoomModal
        isOpen={verifyModal.open}
        onClose={() => setVerifyModal(v => ({ ...v, open: false }))}
        roomId={verifyModal.roomId}
        hasPassword={verifyModal.hasPassword}
        securityQuestion={verifyModal.securityQuestion}
        secure={verifyModal.secure}
        roomSaltHex={verifyModal.roomSaltHex}
        kdfIterations={verifyModal.kdfIterations}
        onVerified={() => {
          setVerifyModal(v => ({ ...v, open: false }))
          router.push(`/room/${verifyModal.roomId}`)
        }}
      />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}
