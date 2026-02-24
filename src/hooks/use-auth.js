"use client"

import { useState, useEffect, createContext, useContext, useCallback } from "react"

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null) // { username, userId, authenticated, avatar }
    const [loading, setLoading] = useState(true)

    const fetchUser = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/me", { credentials: "include" })
            const data = await res.json()
            if (data.authenticated) {
                setUser({ username: data.username, userId: data.userId, authenticated: true, avatar: data.avatar || null })
            } else {
                setUser(null)
            }
        } catch {
            setUser(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchUser()
    }, [fetchUser])

    const login = useCallback(async (email, password) => {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
            credentials: "include",
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Login failed")
        await fetchUser()
        return data
    }, [fetchUser])

    const signup = useCallback(async (username, email, password) => {
        const res = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, email, password }),
            credentials: "include",
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Signup failed")
        await fetchUser()
        return data
    }, [fetchUser])

    const logout = useCallback(async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
        setUser(null)
    }, [])

    const updateUsername = useCallback(async (newUsername) => {
        const res = await fetch("/api/auth/update-username", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: newUsername }),
            credentials: "include",
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to update username")
        setUser((prev) => prev ? { ...prev, username: data.username } : prev)
        return data
    }, [])

    const updateAvatar = useCallback(async (avatarDataUrl) => {
        const res = await fetch("/api/auth/update-avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatar: avatarDataUrl }),
            credentials: "include",
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "Failed to update avatar")
        setUser((prev) => prev ? { ...prev, avatar: avatarDataUrl } : prev)
        return data
    }, [])

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, logout, refetch: fetchUser, updateUsername, updateAvatar }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error("useAuth must be used within AuthProvider")
    return ctx
}
