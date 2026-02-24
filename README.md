<div align="center">
  <h1>🔒 Cypher Chat </h1>
  <p><strong>A real-time, zero-trace, peer-to-peer chat application built for absolute privacy.</strong></p>
  <i>Conversations that leave no metadata, no server logs, and absolutely no trace.</i>
  
  <br />
  <br />

  ![Next JS](https://img.shields.io/badge/Next-white?logo=next.js&style=for-the-badge)
  ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
  ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
  ![Redis](https://img.shields.io/badge/redis-%23DD0031.svg?&style=for-the-badge&logo=redis&logoColor=white)
  ![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white)
  ![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)

</div>

---

## ✨ Why Cypher Chat?

Cypher Chat combines ephemeral messaging with modern peer-to-peer technologies for a secure communicating experience.

- ⏳ **Self-Destructing Rooms** — Every room has a strict 10-minute timer. When time runs out, the room and all messages are permanently erased from the server.
- 🖼️ **Image Steganography** — Hide sensitive text inside PNG cover images using lossless LSB encoding.
- 🎯 **RDS3 Seeded-Lossless Stego** — Secure stego uses deterministic seeded random pixel walks keyed by the room key, with CRC integrity checks.
- 📁 **P2P File Transfer** — Share unlimited files directly user-to-user over WebRTC. Files never touch a central server.
- 🔐 **End-to-End Encryption** — Messages and files are secured client-side using AES-GCM envelopes before being transmitted.
- ☢️ **Instant "Nuke"** — Destroy the room instantly with the click of a button, triggering a cinematic disintegration UI effect.
- 🕵️ **Anonymous & Accountless** — No accounts required. You are assigned a random codename, and access is controlled via temporary `httpOnly` tokens.
- ⚡ **Lightning Fast** — Built with Upstash Realtime Server-Sent Events (SSE) and Elysia.js for blazing fast delivery.

---

## 🏗️ How It Works

Cypher Chat's architecture is built to guarantee privacy by design.

1. **The Sandbox:** You create a room with a security question. Clients derive a room key locally (PBKDF2), while the server stores only room/session metadata with TTL.
2. **The Connection:** Your partner joins. Messages are instantly streamed via Upstash **Server-Sent Events (SSE)**.
3. **The Data Path:** 
   - **Encrypted Text:** AES-GCM-encrypted on-device and relayed via Upstash streams/realtime.
   - **Secure Stego Images:** Built client-side in a Web Worker (RDS3 seeded-lossless), then sent via direct **WebRTC P2P**. The server acts as a blind relay for signaling only.
4. **The Cleanup:** When the timer hits zero (or "Destroy" is pressed), everything drops. No traces are kept.

<details>
<summary><b>View Architecture Diagram</b></summary>

```mermaid
flowchart TD
    ClientA[Browser Client A] <-->|WebRTC Data Channel| ClientB[Browser Client B]
    ClientA <-->|Elysia API| NextJS[Next.js Backend]
    ClientB <-->|Elysia API| NextJS
    ClientA <-->|Real-Time SSE| UpstashRealtime[Upstash Realtime]
    ClientB <-->|Real-Time SSE| UpstashRealtime
    NextJS -->|Push Events| UpstashRealtime
    NextJS <-->|Timers & state| UpstashRedis[(Upstash Redis)]
```

</details>

---

## 🚀 Getting Started

Want to run your own zero-trace server?

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- An [Upstash](https://upstash.com/) account (for Redis and Realtime)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ArAnirudh2901/Redacted-Chat.git
   cd Redacted-Chat
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env.local
   ```
   Add your Upstash Redis credentials to `.env.local`.

4. **Launch the app**
   ```bash
   bun dev
   ```
   Visit [http://localhost:3000](http://localhost:3000) 

---

## �️ The Technology Behind Cypher Chat

- **Core:** Next.js (App Router), React, Tailwind CSS 4, Framer Motion
- **Backend / APIs:** Elysia.js, Eden Treaty SDK, Zod (Validation)
- **Real-Time Data:** Upstash Realtime (SSE)
- **Database / State:** Upstash Redis (TTL Caching)
- **P2P & Crypto:** WebRTC (`simple-peer`), Native Web Crypto API (AES-GCM)
- **Steganography:** Sharp (Lossless PNG manipulation) 

---

## 🔐 RDS3 Secure Stego (Default)

- **Gatekeeper-derived key:** Room key is derived client-side via PBKDF2 and never sent to the server.
- **Seeded random walk:** Pixel selection is deterministic and non-repeating, generated from the room key.
- **Embedding model:** Encrypted payload bits are written to LSBs of R/G/B channels on selected pixels.
- **Integrity check:** CRC32 validates payload integrity before decrypt.
- **Format:** `RDS3` header + metadata + encrypted ciphertext, output as strict `PNG` at `1920x1080`.
- **Fail-closed behavior:** If Worker/Canvas/WebCrypto prerequisites are missing, secure stego send is blocked.

### Compatibility

- Legacy formats are still decodable for backwards compatibility: `RDS3 -> RDS2 -> legacy STEG`.
- Legacy server-side stego endpoints remain available for compatibility, but are not used by the secure default flow.

---

## 📝 License

This project is open source and available under the [MIT License](LICENSE).
