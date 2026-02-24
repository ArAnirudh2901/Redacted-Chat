"use client"

import { useEffect, useState } from "react"

export function useNukeCapabilities() {
    const [reduced, setReduced] = useState(false)

    useEffect(() => {
        if (typeof window === "undefined") return
        const media = window.matchMedia("(prefers-reduced-motion: reduce)")

        const update = () => setReduced(media.matches)
        update()

        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", update)
            return () => media.removeEventListener("change", update)
        }

        media.addListener(update)
        return () => media.removeListener(update)
    }, [])

    return { reduced }
}
