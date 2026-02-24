"use client"

import { Suspense, useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useRouter, useSearchParams } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import Link from "next/link"

const ease = /** @type {[number, number, number, number]} */ ([0.22, 1, 0.36, 1])

export default function AuthPage() {
    return (
        <Suspense fallback={null}>
            <AuthContent />
        </Suspense>
    )
}

function AuthContent() {
    const [mode, setMode] = useState("login") // "login" | "signup"
    const [username, setUsername] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const { login, signup } = useAuth()
    const router = useRouter()
    const searchParams = useSearchParams()

    useEffect(() => {
        const googleError = searchParams.get("google")
        if (!googleError) return

        const googleErrorMessages = {
            config: "Google sign-in is not configured yet. Set Google OAuth environment variables.",
            state_mismatch: "Google sign-in session expired. Please try again.",
            oauth_failed: "Google sign-in could not be completed. Please try again.",
            profile_failed: "Google profile could not be loaded. Please try again.",
            invalid_profile: "Google account is missing required profile data.",
            account_failed: "Could not create or link your account from Google sign-in.",
        }

        setError(googleErrorMessages[googleError] || "Google sign-in failed. Please try again.")
    }, [searchParams])

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError("")
        setIsLoading(true)
        try {
            if (mode === "signup") {
                await signup(username, email, password)
            } else {
                await login(email, password)
            }
            router.push("/")
        } catch (err) {
            setError(err.message || "Something went wrong")
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <main className="min-h-screen flex items-center justify-center relative overflow-hidden landing-grid-bg">
            {/* Ambient glow */}
            <motion.div
                className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
                style={{ background: "radial-gradient(circle, rgba(34,197,94,0.04) 0%, transparent 70%)" }}
                animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />

            <motion.div
                className="w-full max-w-sm relative z-10 px-4 sm:px-0"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease }}
            >
                {/* Lock icon */}
                <motion.div
                    className="flex justify-center mb-6"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.05, ease }}
                >
                    <div className="w-12 h-12 rounded-full border border-green-500/20 bg-green-500/5 flex items-center justify-center">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-500">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                            <path d="M12 6a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
                            <path d="M5.5 18.5c1.5-2.5 3.8-3.5 6.5-3.5s5 1 6.5 3.5" />
                        </svg>
                    </div>
                </motion.div>

                {/* Title */}
                <div className="text-center mb-6">
                    <Link href="/">
                        <h1 className="text-2xl font-bold tracking-tight text-green-500 animate-flicker">{">"}redacted.chat</h1>
                    </Link>
                    <p className="text-zinc-500 text-sm mt-1">
                        {mode === "login" ? "Sign in to your account" : "Create a new account"}
                    </p>
                </div>

                {/* Form card */}
                <motion.div
                    className="border border-zinc-800 bg-zinc-900/50 backdrop-blur-md rounded-sm overflow-hidden"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.15, ease }}
                >
                    {/* Mode toggle */}
                    <div className="flex border-b border-zinc-800/60">
                        {["login", "signup"].map((m) => (
                            <button
                                key={m}
                                onClick={() => { setMode(m); setError("") }}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest transition-colors relative ${mode === m ? "text-green-400" : "text-zinc-600 hover:text-zinc-400"
                                    }`}
                            >
                                {m === "login" ? "Sign In" : "Sign Up"}
                                {mode === m && (
                                    <motion.div
                                        layoutId="authTab"
                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500"
                                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
                        <AnimatePresence mode="wait">
                            {mode === "signup" && (
                                <motion.div
                                    key="username"
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                >
                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-400">
                                                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                                            </svg>
                                            Username
                                        </label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            placeholder="Choose a username"
                                            required={mode === "signup"}
                                            minLength={3}
                                            maxLength={30}
                                            className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                                </svg>
                                Email
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="your@email.com"
                                required
                                className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="flex items-center gap-2 text-zinc-500 text-[10px] uppercase tracking-widest font-bold">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
                                </svg>
                                Password
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={mode === "signup" ? "Min 8 characters" : "Enter password"}
                                required
                                minLength={mode === "signup" ? 8 : 1}
                                className="w-full bg-zinc-950 border border-zinc-800 focus:border-green-500/40 p-2.5 text-sm text-zinc-300 font-mono rounded-sm outline-none transition-colors placeholder:text-zinc-600"
                            />
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.div
                                    className="text-red-400 text-xs font-bold bg-red-950/30 border border-red-900/30 px-3 py-2 rounded-sm"
                                    initial={{ opacity: 0, y: -5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                >
                                    ⚠ {error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <motion.button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 hover:border-green-400/40 text-green-400 hover:text-green-300 py-2.5 text-sm font-bold rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                        >
                            {isLoading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <motion.svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-400" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                                        <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
                                    </motion.svg>
                                    {mode === "login" ? "Signing in..." : "Creating account..."}
                                </span>
                            ) : (
                                mode === "login" ? "Sign In" : "Create Account"
                            )}
                        </motion.button>

                        <div className="flex items-center gap-3 py-1">
                            <div className="h-px flex-1 bg-zinc-800" />
                            <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">or</span>
                            <div className="h-px flex-1 bg-zinc-800" />
                        </div>

                        <a
                            href="/api/auth/google"
                            className="w-full flex items-center justify-center gap-2 bg-zinc-950 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900 text-zinc-300 py-2.5 text-sm font-bold rounded-sm transition-colors"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M21.35 11.1H12v2.92h5.35c-.5 2.34-2.55 3.98-5.35 3.98a5.98 5.98 0 010-11.96c1.53 0 2.89.58 3.92 1.53l2.14-2.14A8.95 8.95 0 0012 3a9 9 0 100 18c5.2 0 8.62-3.66 8.62-8.8 0-.59-.06-1.03-.17-1.5z" fill="currentColor" />
                            </svg>
                            Continue with Google
                        </a>
                    </form>
                </motion.div>

                {/* Guest option */}
                <motion.div
                    className="text-center mt-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                >
                    <Link
                        href="/"
                        className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
                    >
                        Continue as Guest →
                    </Link>
                </motion.div>
            </motion.div>
        </main>
    )
}
