"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useRef, useState } from "react"

/* ── Load html2canvas (cached at module level for instant re-use) ── */

let _cachedRenderer = null
async function loadRenderer() {
    if (_cachedRenderer) return _cachedRenderer
    try {
        const m = await import("html2canvas-pro")
        if (typeof m?.default === "function") { _cachedRenderer = m.default; return _cachedRenderer }
    } catch { /* fall through */ }
    const l = await import("html2canvas")
    _cachedRenderer = l.default
    return _cachedRenderer
}

// Eagerly pre-load the renderer so it's ready when needed
if (typeof window !== "undefined") { loadRenderer().catch(() => { }) }

/* ── Weighted random distribution (Red Stapler technique) ──
   Pixels near position `peak` are most likely to land in the
   canvas at index `peak`. This creates a spatial dissolve wave. */

function weightedRandomDistrib(peak, canvasCount) {
    const prob = []
    const seq = []
    for (let i = 0; i < canvasCount; i++) {
        prob.push(Math.pow(canvasCount - Math.abs(peak - i), 3))
        seq.push(i)
    }
    // Weighted random pick without chance.js
    const total = prob.reduce((s, v) => s + v, 0)
    let r = Math.random() * total
    for (let i = 0; i < canvasCount; i++) {
        r -= prob[i]
        if (r <= 0) return seq[i]
    }
    return seq[canvasCount - 1]
}

/* ── Create a canvas from raw pixel data ── */

function newCanvasFromImageData(pixelArray, w, h) {
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (ctx) {
        ctx.putImageData(new ImageData(pixelArray, w, h), 0, 0)
    }
    return canvas
}

/* ── Animate blur via requestAnimationFrame ── */

function animateBlur(el, targetRadius, duration) {
    const start = performance.now()
    const tick = (now) => {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        // easeOutQuad
        const eased = 1 - (1 - progress) * (1 - progress)
        const current = eased * targetRadius
        el.style.filter = `blur(${current}px)`
        if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
}

/* ── Animate transform (translate + rotate) via rAF ── */

function animateTransform(el, sx, sy, angle, duration) {
    const start = performance.now()
    const tick = (now) => {
        const elapsed = now - start
        const progress = Math.min(elapsed / duration, 1)
        // easeInQuad
        const eased = progress * progress
        const tx = eased * sx
        const ty = eased * sy
        const td = eased * angle
        el.style.transform = `rotate(${td}deg) translate(${tx}px, ${ty}px)`
        if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
}

/* ── Animate fade out via rAF ── */

function animateFadeOut(el, delay, duration, easeExp = 3) {
    const start = performance.now()
    const tick = (now) => {
        const elapsed = now - start - delay
        if (elapsed < 0) { requestAnimationFrame(tick); return }
        const progress = Math.min(elapsed / duration, 1)
        // easeInCubic (or easeInQuint with higher exponent)
        const eased = Math.pow(progress, easeExp)
        el.style.opacity = String(1 - eased)
        if (progress < 1) {
            requestAnimationFrame(tick)
        } else {
            el.remove()
        }
    }
    requestAnimationFrame(tick)
}

/* ── Component ── */

/**
 * @param {{
 *  active: boolean
 *  reduced?: boolean
 *  onComplete: () => void
 * }} props
 */
export function DomNukeOverlay({
    active,
    reduced = false,
    onComplete,
}) {
    const [phase, setPhase] = useState("idle")
    const runTokenRef = useRef(0)

    useEffect(() => {
        if (!active) return
        let cancelled = false
        const token = ++runTokenRef.current
        const dustElements = []
        let timeoutId = 0

        const finish = () => {
            if (cancelled || runTokenRef.current !== token) return
            // Clean up any remaining dust canvases
            dustElements.forEach((el) => {
                try { el.remove() } catch { /* */ }
            })
            onComplete()
        }

        const run = async () => {
            setPhase("preparing")
            const root = document.querySelector("[data-nuke-source='room']")
            if (!(root instanceof HTMLElement)) { finish(); return }

            const vw = window.innerWidth
            const vh = window.innerHeight

            // Load renderer
            let html2canvas
            try { html2canvas = await loadRenderer() } catch { finish(); return }
            if (cancelled || runTokenRef.current !== token) return

            // Single full-page snapshot
            let snapshot
            try {
                snapshot = await html2canvas(root, {
                    backgroundColor: "#0a0a0a",
                    scale: 0.5,
                    useCORS: true,
                    logging: false,
                    removeContainer: true,
                    foreignObjectRendering: false,
                    scrollX: 0, scrollY: 0,
                    windowWidth: vw, windowHeight: vh,
                    ignoreElements: (el) => {
                        if (!(el instanceof HTMLElement)) return false
                        return el.classList.contains("nuke-overlay-root") || Boolean(el.closest(".nuke-overlay-root"))
                    },
                    onclone: (doc) => {
                        if (doc?.head) {
                            const s = doc.createElement("style")
                            s.textContent = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`
                            doc.head.appendChild(s)
                        }
                    },
                })
            } catch { finish(); return }
            if (cancelled || runTokenRef.current !== token) return

            // Get pixel data from the snapshot
            const ctx = snapshot.getContext("2d")
            if (!ctx) { finish(); return }

            const w = snapshot.width
            const h = snapshot.height
            let imageData
            try { imageData = ctx.getImageData(0, 0, w, h) } catch { finish(); return }
            const pixelArr = imageData.data

            // Number of dust canvases
            const canvasCount = reduced ? 8 : 16

            // Create blank pixel arrays for each canvas
            const imageDataArrays = []
            for (let i = 0; i < canvasCount; i++) {
                imageDataArrays.push(new Uint8ClampedArray(pixelArr.length))
            }

            // Distribute pixels using weighted randomization
            // Pixels near the top → early canvases, pixels near bottom → later canvases
            for (let i = 0; i < pixelArr.length; i += 4) {
                if (pixelArr[i + 3] < 10) continue // skip nearly transparent pixels
                const peak = Math.floor((i / pixelArr.length) * canvasCount)
                const target = weightedRandomDistrib(peak, canvasCount)
                imageDataArrays[target][i] = pixelArr[i]
                imageDataArrays[target][i + 1] = pixelArr[i + 1]
                imageDataArrays[target][i + 2] = pixelArr[i + 2]
                imageDataArrays[target][i + 3] = pixelArr[i + 3]
            }

            // Create dust canvases and append to the overlay
            const overlayRoot = document.querySelector(".nuke-overlay-root")
            if (!overlayRoot) { finish(); return }

            for (let i = 0; i < canvasCount; i++) {
                const c = newCanvasFromImageData(imageDataArrays[i], w, h)
                c.classList.add("dust")
                c.style.position = "absolute"
                c.style.top = "0"
                c.style.left = "0"
                c.style.width = `${vw}px`
                c.style.height = `${vh}px`
                c.style.pointerEvents = "none"
                overlayRoot.appendChild(c)
                dustElements.push(c)
            }

            if (cancelled || runTokenRef.current !== token) return

            // ── Start animation ──
            setPhase("running")

            // Fade out the real content
            const nukeEls = root.querySelectorAll("[data-nuke-el]")
            nukeEls.forEach((el) => {
                if (el instanceof HTMLElement) {
                    el.classList.add("nuke-dissolving")
                }
            })

            // ── Timing: tuned for exactly 2s total animation ──
            // last canvas delay = stagger * (count-1)
            // last canvas duration = baseDuration + stagger * (count-1)
            // total = 2 * stagger * (count-1) + baseDuration = 2000ms
            const count = dustElements.length
            const staggerMs = reduced ? 25 : 40
            const baseDuration = reduced ? 1050 : 800

            dustElements.forEach((dustCanvas, index) => {
                // Blur animation
                animateBlur(dustCanvas, 0.8, baseDuration)

                // Transform animation (staggered)
                window.setTimeout(() => {
                    if (cancelled || runTokenRef.current !== token) return
                    const translateX = 40 + Math.random() * 80
                    const translateY = -(30 + Math.random() * 80)
                    const rotation = (Math.random() - 0.5) * 30 // -15 to 15 degrees
                    const transformDuration = baseDuration + (staggerMs * index)
                    animateTransform(dustCanvas, translateX, translateY, rotation, transformDuration)
                }, staggerMs * index)

                // Fade out animation (staggered)
                const fadeDelay = staggerMs * index
                const fadeDuration = baseDuration + (staggerMs * index)
                animateFadeOut(dustCanvas, fadeDelay, fadeDuration, 2.5)
            })

            // Finish exactly at 2s
            timeoutId = window.setTimeout(() => finish(), 2000)
        }

        run()

        return () => {
            cancelled = true
            if (timeoutId) clearTimeout(timeoutId)
            dustElements.forEach((el) => {
                try { el.remove() } catch { /* */ }
            })
            // Remove dissolving class from elements
            const root = document.querySelector("[data-nuke-source='room']")
            if (root) {
                root.querySelectorAll(".nuke-dissolving").forEach((el) => {
                    if (el instanceof HTMLElement) el.classList.remove("nuke-dissolving")
                })
            }
            setPhase("idle")
        }
    }, [active, onComplete, reduced])

    return (
        <AnimatePresence>
            {active && (
                <motion.div
                    className="nuke-overlay-root"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                />
            )}
        </AnimatePresence>
    )
}
