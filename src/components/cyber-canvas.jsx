"use client"

import { useEffect, useRef } from "react"

/**
 * CyberCanvas — Matrix-style digital rain background
 * Falling green characters (hex digits, katakana, symbols) at varied speeds.
 *
 * @param {{ className?: string, opacity?: number, speed?: number, density?: number }} props
 */
export function CyberCanvas({ className = "", opacity = 1.5, speed = 1.5, density = 1.1 }) {
    const canvasRef = useRef(null)
    const rafRef = useRef(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext("2d")
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        // Characters: hex digits + some symbols
        const chars = "0123456789ABCDEF>|:;{}[]<>/\\=+*#@$%&!?"
        const fontSize = 13
        let columns = 0
        let drops = []

        const resize = () => {
            const w = window.innerWidth
            const h = window.innerHeight
            canvas.width = w * dpr
            canvas.height = h * dpr
            canvas.style.width = `${w}px`
            canvas.style.height = `${h}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

            const newColumns = Math.floor((w / fontSize) * density)
            // Preserve existing drop positions where possible
            const newDrops = []
            for (let i = 0; i < newColumns; i++) {
                newDrops[i] = drops[i] !== undefined ? drops[i] : -Math.random() * 80
            }
            columns = newColumns
            drops = newDrops
        }

        resize()
        window.addEventListener("resize", resize)

        let lastTime = 0
        const step = 20 / speed // ms per rain step

        const draw = (timestamp) => {
            const w = canvas.width / dpr
            const h = canvas.height / dpr

            // Semi-transparent black overlay — slower fade = longer softer trails
            ctx.fillStyle = "rgba(0, 0, 0, 0.04)"
            ctx.fillRect(0, 0, w, h)

            ctx.font = `${fontSize}px monospace`

            // Only advance drops on the step interval (smooth rendering in between)
            const shouldStep = timestamp - lastTime >= step
            if (shouldStep) lastTime = timestamp

            for (let i = 0; i < columns; i++) {
                const x = i * (fontSize / density)
                const y = drops[i] * fontSize

                if (drops[i] > 0 && y < h) {
                    // Head character — subtle green
                    const char = chars[Math.floor(Math.random() * chars.length)]
                    ctx.fillStyle = "rgba(34, 197, 94, 0.45)"
                    ctx.fillText(char, x, y)

                    // Faint trail one step behind
                    if (y - fontSize > 0) {
                        const trailChar = chars[Math.floor(Math.random() * chars.length)]
                        ctx.fillStyle = "rgba(34, 197, 94, 0.13)"
                        ctx.fillText(trailChar, x, y - fontSize)
                    }
                }

                if (shouldStep) drops[i]++

                // Reset with randomness for organic feel
                if (drops[i] * fontSize > h && Math.random() > 0.975) {
                    drops[i] = -Math.random() * 40
                }
            }

            rafRef.current = requestAnimationFrame(draw)
        }

        rafRef.current = requestAnimationFrame(draw)

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current)
            window.removeEventListener("resize", resize)
        }
    }, [speed, density])

    return (
        <canvas
            ref={canvasRef}
            className={`fixed inset-0 pointer-events-none z-0 ${className}`}
            style={{ opacity }}
        />
    )
}
