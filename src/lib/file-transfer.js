import { nanoid } from "nanoid"

const CHUNK_SIZE = 64 * 1024 // 64KB per chunk
const MAX_BUFFERED_AMOUNT = 4 * 1024 * 1024 // 4MB
const BUFFER_POLL_MS = 20
const DEFAULT_ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
]

function parseIceServersFromEnv() {
    const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON
    if (!raw) return DEFAULT_ICE_SERVERS
    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return DEFAULT_ICE_SERVERS
        }

        const normalized = parsed
            .map((entry) => {
                if (!entry || typeof entry !== "object") return null
                const urls = entry.urls
                if (!(typeof urls === "string" || (Array.isArray(urls) && urls.every((value) => typeof value === "string")))) {
                    return null
                }

                /** @type {{ urls: string | string[], username?: string, credential?: string }} */
                const ice = { urls }
                if (typeof entry.username === "string") ice.username = entry.username
                if (typeof entry.credential === "string") ice.credential = entry.credential
                return ice
            })
            .filter(Boolean)

        return normalized.length > 0 ? normalized : DEFAULT_ICE_SERVERS
    } catch {
        return DEFAULT_ICE_SERVERS
    }
}

const ICE_SERVERS = parseIceServersFromEnv()

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * File sender — creates WebRTC peer connection and sends file via data channel.
 *
 * Flow:
 *   1. sendOffer()           → emits file.offer (metadata only)
 *   2. handleAccepted()      → receiver acked → calls createConnection()
 *   3. createConnection()    → creates PC + data channel + SDP offer → emits file.sdp-offer
 *   4. handleAnswer(sdp)     → sets remote SDP answer
 *   5. data channel opens    → _sendFileData()
 */
export class FileSender {
    /**
     * @param {{ file: File, roomId: string, username: string, to: string, emitSignal: (event: string, data: any) => void }} opts
     */
    constructor({ file, roomId, username, to, emitSignal }) {
        this.file = file
        this.roomId = roomId
        this.username = username
        this.to = to
        this.emitSignal = emitSignal
        this.offerId = nanoid(12)
        /** @type {RTCPeerConnection | null} */
        this.pc = null
        /** @type {RTCDataChannel | null} */
        this.channel = null
        this.progress = 0
        /** @type {((p: number) => void) | null} */
        this.onProgress = null
        /** @type {(() => void) | null} */
        this.onComplete = null
        /** @type {((e: any) => void) | null} */
        this.onError = null
        /** @type {((reason: string) => void) | null} */
        this.onCancel = null
        this.isCancelled = false
        this.isCompleted = false
        this.hasFailed = false
        this.isCleanedUp = false
        /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
        this._reader = null
    }

    /** Step 1 — broadcast file offer (metadata only, no WebRTC yet) */
    async sendOffer() {
        await this.emitSignal("file.offer", {
            from: this.username,
            to: this.to,
            filename: this.file.name,
            fileSize: this.file.size,
            fileType: this.file.type || "application/octet-stream",
            offerId: this.offerId,
        })
    }

    /** Step 2 — receiver acknowledged, NOW we create the WebRTC connection */
    async handleAccepted() {
        if (this.pc) return
        await this.createConnection()
    }

    /** Step 4 — receiver sent SDP answer */
    async handleAnswer(sdp) {
        if (!this.pc) return
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }))
    }

    /** Handle ICE candidate from receiver */
    async handleIceCandidate(candidate) {
        if (!this.pc) return
        try {
            const parsed = typeof candidate === "string" ? JSON.parse(candidate) : candidate
            await this.pc.addIceCandidate(new RTCIceCandidate(parsed))
        } catch { /* ignore failed candidates */ }
    }

    /** Create the peer connection and data channel, emit SDP offer */
    async createConnection() {
        if (this.pc) return
        this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.emitSignal("file.ice-candidate", {
                    offerId: this.offerId,
                    candidate: JSON.stringify(e.candidate),
                    from: this.username,
                    to: this.to,
                })
            }
        }

        this.channel = this.pc.createDataChannel("fileTransfer", { ordered: true })
        this.channel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2
        this.channel.binaryType = "arraybuffer"
        this.channel.onopen = () => this._sendFileData()
        this.channel.onerror = (e) => this._notifyError(e)
        this.channel.onclose = () => {
            if (!this.isCancelled && !this.isCompleted) {
                this._notifyError(new Error("Transfer channel closed before completion"))
            }
        }

        const offer = await this.pc.createOffer()
        await this.pc.setLocalDescription(offer)

        await this.emitSignal("file.sdp-offer", {
            offerId: this.offerId,
            sdp: offer.sdp,
            from: this.username,
            to: this.to,
        })
    }

    _notifyError(err) {
        if (this.isCancelled || this.isCompleted || this.hasFailed) return
        this.hasFailed = true
        this.onError?.(err)
        this.cleanup()
    }

    async _waitForBufferedAmount(channel, limit = MAX_BUFFERED_AMOUNT) {
        while (!this.isCancelled && channel.readyState === "open" && channel.bufferedAmount > limit) {
            await wait(BUFFER_POLL_MS)
        }
        if (this.isCancelled) throw new Error("Transfer cancelled")
        if (channel.readyState !== "open") throw new Error("Data channel is not open")
    }

    async _sendFileData() {
        if (!this.channel || this.isCancelled || this.isCompleted) return
        const channel = this.channel
        const reader = this.file.stream().getReader()
        this._reader = reader
        let sent = 0

        try {
            while (!this.isCancelled) {
                const { done, value } = await reader.read()
                if (done) break
                if (!value?.length) continue

                for (let i = 0; i < value.length; i += CHUNK_SIZE) {
                    if (this.isCancelled) break
                    const chunk = value.slice(i, i + CHUNK_SIZE)

                    await this._waitForBufferedAmount(channel)
                    channel.send(chunk)
                    sent += chunk.byteLength
                    this.progress = this.file.size > 0 ? Math.min(1, sent / this.file.size) : 1
                    this.onProgress?.(this.progress)
                }
            }

            if (this.isCancelled) return

            // Make sure all chunk data is flushed before EOF and teardown.
            await this._waitForBufferedAmount(channel, 0)

            // Signal end of transfer with zero-length buffer
            channel.send(new ArrayBuffer(0))
            await this._waitForBufferedAmount(channel, 0)
            this.isCompleted = true
            this.progress = 1
            this.onProgress?.(1)
            this.onComplete?.()
            this.cleanup()
        } catch (err) {
            this._notifyError(err)
        } finally {
            try {
                reader.releaseLock()
            } catch { /* ignore */ }
            this._reader = null
        }
    }

    async cancel(reason = "Transfer cancelled", opts = {}) {
        const notifyPeer = opts.notifyPeer !== false
        if (this.isCompleted || this.isCancelled) return

        this.isCancelled = true
        try {
            await this._reader?.cancel(reason)
        } catch { /* ignore */ }

        if (notifyPeer) {
            try {
                await this.emitSignal("file.cancel", {
                    offerId: this.offerId,
                    from: this.username,
                    to: this.to,
                    reason,
                })
            } catch { /* ignore relay errors */ }
        }

        this.cleanup()
        this.onCancel?.(reason)
    }

    cleanup() {
        if (this.isCleanedUp) return
        this.isCleanedUp = true

        if (this.channel) {
            this.channel.onopen = null
            this.channel.onerror = null
            this.channel.onclose = null
            try {
                this.channel.close()
            } catch { /* ignore */ }
            this.channel = null
        }
        if (this.pc) {
            this.pc.onicecandidate = null
            try {
                this.pc.close()
            } catch { /* ignore */ }
            this.pc = null
        }
    }
}

/**
 * File receiver — handles incoming WebRTC connection and receives file data.
 *
 * Flow:
 *   1. Created when user accepts file.offer toast
 *   2. sendAccepted()      → emits file.accepted (tells sender to create PC)
 *   3. acceptOffer(sdp)    → called when file.sdp-offer arrives → creates PC, creates answer
 *   4. answer auto-emitted → sender sets remote → data channel opens
 */
export class FileReceiver {
    /**
     * @param {{ offerId: string, filename: string, fileSize: number, fileType: string, username: string, from: string, emitSignal: (event: string, data: any) => void }} opts
     */
    constructor({ offerId, filename, fileSize, fileType, username, from, emitSignal }) {
        this.offerId = offerId
        this.filename = filename
        this.fileSize = fileSize
        this.fileType = fileType
        this.username = username
        this.from = from
        this.emitSignal = emitSignal
        /** @type {RTCPeerConnection | null} */
        this.pc = null
        /** @type {RTCDataChannel | null} */
        this.channel = null
        /** @type {ArrayBuffer[]} */
        this.chunks = []
        this.writeChain = Promise.resolve()
        /** @type {any | null} */
        this.fileWriter = null
        this.received = 0
        this.progress = 0
        /** @type {((p: number) => void) | null} */
        this.onProgress = null
        /** @type {(() => void) | null} */
        this.onComplete = null
        /** @type {((e: any) => void) | null} */
        this.onError = null
        /** @type {((reason: string) => void) | null} */
        this.onCancel = null
        this.isCancelled = false
        this.isCompleted = false
        this.hasFailed = false
        this.isCleanedUp = false
    }

    /** Step 2 — tell the sender "I accept, go ahead and create your connection" */
    async sendAccepted() {
        await this.emitSignal("file.accepted", {
            offerId: this.offerId,
            from: this.username,
            to: this.from,
        })
    }

    /**
     * For large files, stream directly to disk if the browser supports it.
     * Must be called from a user-gesture handler to allow the save picker.
     * @returns {Promise<boolean>}
     */
    async prepareWritableTarget() {
        if (typeof window === "undefined") return false
        const picker = /** @type {any} */ (window).showSaveFilePicker
        if (typeof picker !== "function") return false

        const handle = await picker({ suggestedName: this.filename })
        this.fileWriter = await handle.createWritable()
        return true
    }

    _notifyError(err) {
        if (this.isCancelled || this.isCompleted || this.hasFailed) return
        this.hasFailed = true
        this.onError?.(err)
        this.cleanup()
    }

    _queueDiskWrite(buf) {
        if (!this.fileWriter) return
        const writer = this.fileWriter
        this.writeChain = this.writeChain
            .then(async () => {
                if (this.isCancelled || this.isCompleted || !writer) return
                await writer.write(buf)
            })
            .catch((err) => {
                this._notifyError(err)
            })
    }

    _handleIncomingBuffer(buf) {
        if (this.isCancelled || this.isCompleted || this.hasFailed) return
        if (buf.byteLength === 0) {
            void this._finalize()
            return
        }

        if (this.fileWriter) {
            this._queueDiskWrite(buf)
        } else {
            this.chunks.push(buf)
        }

        this.received += buf.byteLength
        this.progress = this.fileSize > 0 ? Math.min(1, this.received / this.fileSize) : 1
        this.onProgress?.(this.progress)
    }

    /** Step 3 — handle SDP offer from sender, create answer */
    async acceptOffer(sdpOffer) {
        if (this.pc) return
        this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

        this.pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.emitSignal("file.ice-candidate", {
                    offerId: this.offerId,
                    candidate: JSON.stringify(e.candidate),
                    from: this.username,
                    to: this.from,
                })
            }
        }

        this.pc.ondatachannel = (event) => {
            this.channel = event.channel
            const channel = this.channel
            channel.binaryType = "arraybuffer"

            channel.onmessage = (e) => {
                const incoming = e.data
                if (incoming instanceof ArrayBuffer) {
                    this._handleIncomingBuffer(incoming)
                    return
                }
                if (incoming instanceof Blob) {
                    incoming.arrayBuffer()
                        .then((buf) => this._handleIncomingBuffer(buf))
                        .catch((err) => this._notifyError(err))
                    return
                }
                if (ArrayBuffer.isView(incoming)) {
                    const view = /** @type {ArrayBufferView} */ (incoming)
                    const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
                    this._handleIncomingBuffer(copy)
                }
            }

            channel.onerror = (err) => this._notifyError(err)
            channel.onclose = () => {
                if (!this.isCancelled && !this.isCompleted && this.received < this.fileSize) {
                    this._notifyError(new Error("Transfer channel closed before completion"))
                }
            }
        }

        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: sdpOffer }))

        const answer = await this.pc.createAnswer()
        await this.pc.setLocalDescription(answer)

        // Step 4 — send SDP answer back to sender
        await this.emitSignal("file.sdp-answer", {
            offerId: this.offerId,
            sdp: answer.sdp,
            from: this.username,
            to: this.from,
        })
    }

    async cancel(reason = "Transfer cancelled", opts = {}) {
        const notifyPeer = opts.notifyPeer === true
        if (this.isCompleted || this.isCancelled) return
        this.isCancelled = true

        if (notifyPeer) {
            try {
                await this.emitSignal("file.cancel", {
                    offerId: this.offerId,
                    from: this.username,
                    to: this.from,
                    reason,
                })
            } catch { /* ignore relay errors */ }
        }

        if (this.fileWriter) {
            try {
                await this.fileWriter.abort()
            } catch { /* ignore */ }
            this.fileWriter = null
        }
        this.chunks = []
        this.cleanup()
        this.onCancel?.(reason)
    }

    /** Handle ICE candidate from sender */
    async handleIceCandidate(candidate) {
        if (!this.pc) return
        try {
            const parsed = typeof candidate === "string" ? JSON.parse(candidate) : candidate
            await this.pc.addIceCandidate(new RTCIceCandidate(parsed))
        } catch { /* ignore */ }
    }

    async _finalize() {
        if (this.isCancelled || this.isCompleted || this.hasFailed) return
        try {
            await this.writeChain
            if (this.isCancelled || this.hasFailed) return

            if (this.fileWriter) {
                const writer = this.fileWriter
                this.fileWriter = null
                await writer.close()
            } else {
                const blob = new Blob(/** @type {BlobPart[]} */ (this.chunks), { type: this.fileType })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = this.filename
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                setTimeout(() => URL.revokeObjectURL(url), 10000)
            }

            this.chunks = []
            this.isCompleted = true
            this.progress = 1
            this.onProgress?.(1)
            this.onComplete?.()
            this.cleanup()
        } catch (err) {
            this._notifyError(err)
        }
    }

    cleanup() {
        if (this.isCleanedUp) return
        this.isCleanedUp = true

        if (!this.isCompleted && this.fileWriter) {
            this.fileWriter.abort().catch(() => { /* ignore */ })
            this.fileWriter = null
        }
        if (this.channel) {
            this.channel.onmessage = null
            this.channel.onerror = null
            this.channel.onclose = null
            try {
                this.channel.close()
            } catch { /* ignore */ }
            this.channel = null
        }
        if (this.pc) {
            this.pc.onicecandidate = null
            this.pc.ondatachannel = null
            try {
                this.pc.close()
            } catch { /* ignore */ }
            this.pc = null
        }
    }
}
