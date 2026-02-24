"use client"

import { DomNukeOverlay } from "./dom-nuke-overlay"

/**
 * @param {{
 *  active: boolean
 *  onComplete: () => void
 *  reduced?: boolean
 * }} props
 */
export function NukeController({
    active,
    onComplete,
    reduced = false,
}) {
    if (!active) return null

    return (
        <DomNukeOverlay
            active={active}
            reduced={reduced}
            onComplete={onComplete}
        />
    )
}
