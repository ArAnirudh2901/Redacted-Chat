"use client"

import { useAuth } from "@/hooks/use-auth"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { DUR_BASE, DUR_FAST, EASE_STANDARD, SPRING_SNAPPY } from "@/lib/motion-tokens"

export function Sidebar() {
    const prefersReducedMotion = useReducedMotion()
    const { user, logout } = useAuth()
    const [isOpen, setIsOpen] = useState(false)
    const [isPinned, setIsPinned] = useState(() => {
        if (typeof window === "undefined") return false
        return window.localStorage.getItem("sidebar:pinned") === "1"
    })
    const [isCollapsed, setIsCollapsed] = useState(() => {
        if (typeof window === "undefined") return false
        return window.localStorage.getItem("sidebar:collapsed") === "1"
    })
    const [isMobileViewport, setIsMobileViewport] = useState(false)
    const pathname = usePathname()
    const isHomePage = pathname === "/"
    const forceVisibleOnHome = Boolean(user) && isHomePage && !isMobileViewport

    const shouldFetchRooms = Boolean(user) && (isPinned || isOpen || forceVisibleOnHome)
    const {
        data: rooms = [],
        isFetching,
    } = useQuery({
        queryKey: ["permanent-rooms", user?.userId],
        enabled: shouldFetchRooms,
        queryFn: async () => {
            const res = await fetch("/api/auth/permanent-rooms", { credentials: "include" })
            if (!res.ok) return []
            const data = await res.json()
            return Array.isArray(data.rooms) ? data.rooms : []
        },
        staleTime: 30_000,
    })

    useEffect(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem("sidebar:pinned", isPinned ? "1" : "0")
    }, [isPinned])

    useEffect(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem("sidebar:collapsed", isCollapsed ? "1" : "0")
    }, [isCollapsed])

    useEffect(() => {
        if (typeof window === "undefined") return
        const media = window.matchMedia("(max-width: 1023px)")
        const syncViewport = () => setIsMobileViewport(media.matches)
        syncViewport()

        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", syncViewport)
            return () => media.removeEventListener("change", syncViewport)
        }

        media.addListener(syncViewport)
        return () => media.removeListener(syncViewport)
    }, [])

    useEffect(() => {
        if (!isMobileViewport) return
        if (isCollapsed) setIsCollapsed(false)
    }, [isMobileViewport, isCollapsed])

    if (!user) return null

    const currentRoomId = pathname?.match(/^\/room\/(.+)$/)?.[1]
    const panelPinned = !isMobileViewport && (forceVisibleOnHome || isPinned)
    const panelVisible = panelPinned || isOpen
    const isPanelCollapsed = panelPinned && isCollapsed
    const panelWidth = isPanelCollapsed ? "w-20" : "w-72"
    const toggleLabel = panelPinned
        ? (isPanelCollapsed ? "Expand sidebar" : "Collapse sidebar")
        : (isOpen ? "Close sidebar" : "Open sidebar")
    const toggleButtonPlacement = panelPinned
        ? (isPanelCollapsed ? "left-6" : "left-4")
        : "left-3"

    const toggleSidebar = () => {
        if (panelPinned) {
            setIsCollapsed((prev) => !prev)
            return
        }
        setIsOpen((prev) => !prev)
    }

    return (
        <>
            <motion.button
                onClick={toggleSidebar}
                aria-label={toggleLabel}
                className={`fixed top-2 ${toggleButtonPlacement === "left-3" ? "left-2" : toggleButtonPlacement} z-50 w-8 h-8 flex items-center justify-center rounded-sm border border-zinc-700/50 bg-zinc-900/90 backdrop-blur-sm hover:bg-zinc-800/80 text-zinc-400 hover:text-green-400 transition-colors shadow-lg`}
                whileTap={prefersReducedMotion ? {} : { scale: 0.9 }}
                transition={{ duration: DUR_FAST, ease: EASE_STANDARD }}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                    {panelPinned ? (
                        isPanelCollapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />
                    ) : isOpen ? (
                        <path d="M18 6L6 18M6 6l12 12" />
                    ) : (
                        <>
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </>
                    )}
                </svg>
            </motion.button>

            <AnimatePresence>
                {panelVisible && (
                    <>
                        {!panelPinned && (
                            <motion.div
                                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsOpen(false)}
                            />
                        )}

                        <motion.aside
                            className={`fixed top-0 left-0 z-40 h-full ${panelWidth} max-w-[calc(100vw-3rem)] bg-zinc-950 border-r border-zinc-800/60 flex flex-col shadow-2xl transition-[width] duration-300`}
                            initial={panelPinned ? { x: 0, opacity: 1 } : { x: "-100%" }}
                            animate={{ x: 0 }}
                            exit={panelPinned ? { x: 0, opacity: 1 } : { x: "-100%" }}
                            transition={prefersReducedMotion
                                ? /** @type {import("framer-motion").Transition} */ ({ duration: DUR_BASE, ease: EASE_STANDARD })
                                : SPRING_SNAPPY}
                        >
                            <div className="px-4 pt-16 pb-4 border-b border-zinc-800/60">
                                <div className={`flex items-center ${isPanelCollapsed ? "justify-center" : "gap-3"}`}>
                                    <div className="w-9 h-9 rounded-full bg-green-950/40 border border-green-500/30 flex items-center justify-center">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-400">
                                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                                            <path d="M12 6a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
                                            <path d="M5.5 18.5c1.5-2.5 3.8-3.5 6.5-3.5s5 1 6.5 3.5" />
                                        </svg>
                                    </div>
                                    {!isPanelCollapsed && (
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-green-400 truncate">{user.username}</p>
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Authenticated</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-3">
                                {!isPanelCollapsed && (
                                    <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold px-2 mb-2">
                                        Permanent Chats
                                    </p>
                                )}
                                {isFetching ? (
                                    <div className="flex items-center justify-center py-8">
                                        <motion.div
                                            className="w-5 h-5 border-2 border-green-500/30 border-t-green-400 rounded-full"
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                        />
                                    </div>
                                ) : rooms.length === 0 ? (
                                    <div className="text-center py-8">
                                        {!isPanelCollapsed && (
                                            <>
                                                <p className="text-zinc-600 text-xs">No permanent chats yet</p>
                                                <p className="text-zinc-700 text-[10px] mt-1">Create a room with no expiry</p>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {rooms.map((room) => (
                                            <Link
                                                key={room.roomId}
                                                href={`/room/${room.roomId}`}
                                                onClick={() => { if (!panelPinned) setIsOpen(false) }}
                                                title={room.roomId}
                                                className={`flex items-center ${isPanelCollapsed ? "justify-center px-2" : "gap-3 px-3"} py-2.5 rounded-sm transition-[color,background-color,border-color,transform] duration-200 group hover:translate-x-[1px] motion-reduce:hover:translate-x-0 ${currentRoomId === room.roomId
                                                    ? "bg-green-950/30 border border-green-900/40"
                                                    : "hover:bg-zinc-800/50 border border-transparent"
                                                    }`}
                                            >
                                                <div className={`w-2 h-2 rounded-full ${currentRoomId === room.roomId ? "bg-green-400" : "bg-zinc-700 group-hover:bg-zinc-500"}`} />
                                                {!isPanelCollapsed && (
                                                    <div className="min-w-0 flex-1">
                                                        <p className={`text-xs font-mono truncate ${currentRoomId === room.roomId ? "text-green-400" : "text-zinc-400 group-hover:text-zinc-200"}`}>
                                                            {room.roomId}
                                                        </p>
                                                        <p className="text-[9px] text-zinc-600 flex items-center gap-2">
                                                            <span>{room.hasPassword ? "Private" : "Open"}</span>
                                                            <span>Max {room.maxParticipants}</span>
                                                        </p>
                                                    </div>
                                                )}
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="px-4 py-3 border-t border-zinc-800/60">
                                <div className="flex">
                                    <button
                                        onClick={async () => {
                                            await logout()
                                            setIsOpen(false)
                                            setIsPinned(false)
                                        }}
                                        title="Sign out"
                                        className={`flex items-center justify-center rounded-sm border border-zinc-700/50 bg-zinc-800/30 hover:bg-zinc-700/40 text-zinc-500 hover:text-zinc-300 transition-colors ${isPanelCollapsed
                                            ? "w-10 h-10 mx-auto"
                                            : "w-full gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider"
                                            }`}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line x1="21" y1="12" x2="9" y2="12" />
                                        </svg>
                                        {!isPanelCollapsed && "Sign Out"}
                                    </button>
                                </div>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}
