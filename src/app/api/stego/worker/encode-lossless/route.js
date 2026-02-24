import { NextResponse } from "next/server"
import z from "zod"
import { encodeLosslessStegoPng } from "@/lib/server/stego-lossless"

const schema = z.object({
    roomId: z.string().min(1).max(128).optional(),
    coverBase64: z.string().min(32),
    secretCipherHex: z.string().min(2).max(600_000),
    secretMeta: z.record(z.string(), z.any()).optional(),
})

export async function POST(req) {
    try {
        const body = schema.parse(await req.json())
        const png = await encodeLosslessStegoPng(body)
        return new Response(png, {
            status: 200,
            headers: {
                "content-type": "image/png",
                "cache-control": "no-store",
            },
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: "Invalid worker lossless payload", details: error.issues }, { status: 422 })
        }
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Worker lossless encode failed" },
            { status: 500 },
        )
    }
}
