/**
 * Build a deterministic non-repeating pixel order using a partial Fisher-Yates shuffle.
 *
 * @param {number} totalPixels
 * @param {number} count
 * @param {{ randomInt: (maxExclusive: number) => Promise<number> }} prng
 */
export async function generateSeededPixelOrder(totalPixels, count, prng) {
    if (!Number.isInteger(totalPixels) || totalPixels <= 0) {
        throw new Error("totalPixels must be a positive integer")
    }
    if (!Number.isInteger(count) || count <= 0) {
        throw new Error("count must be a positive integer")
    }
    if (count > totalPixels) {
        throw new Error("Requested pixel walk exceeds total pixel capacity")
    }

    const pool = new Uint32Array(totalPixels)
    for (let i = 0; i < totalPixels; i += 1) {
        pool[i] = i
    }

    for (let i = 0; i < count; i += 1) {
        const j = i + (await prng.randomInt(totalPixels - i))
        const tmp = pool[i]
        pool[i] = pool[j]
        pool[j] = tmp
    }

    const out = new Uint32Array(count)
    out.set(pool.subarray(0, count))
    return out
}
