# 🔒 Redacted Chat

A real-time, zero-trace chat application built for absolute privacy. Messages are ephemeral, rooms self-destruct, and the server never sees your data.

> _Conversations that leave no metadata, no server logs, and absolutely no trace._

---

## ✨ Features

- **Ephemeral Rooms** — Every room is bound to a strict 10-minute TTL. When time runs out, the data is dropped completely from the database.
- **Instant Nuke** — The room creator can hit "Destroy Now" to forcefully disconnect all users and wipe the room from existence immediately.
- **Token-Based Access Control** — Users are issued secure, `httpOnly` auth tokens via a middleware proxy on room entry. No passwords, no accounts.
- **2-Person Rooms** — Rooms are capped at two participants. If the room is full, newcomers are redirected back to the lobby.
- **Anonymous Identities** — Users are auto-assigned randomized codenames (e.g. `anonymous-Wolf-x8kQ2`) stored only in their browser's local storage.
- **Real-Time Messaging** — Powered by Upstash Realtime for instant message delivery over server-sent events.
- **Schema-Validated Payloads** — All API inputs are validated with Zod to prevent malformed or oversized payloads.

---

## 🏗️ Architecture

```
┌─────────────┐       Eden Treaty        ┌──────────────────┐
│   Browser    │ ◄────────────────────► │  Next.js + Elysia │
│  (React 19)  │                         │    API Routes     │
└──────┬───────┘                         └────────┬─────────┘
       │                                          │
       │  SSE (Upstash Realtime)                  │  Redis Commands
       │                                          │
       ▼                                          ▼
┌──────────────┐                         ┌──────────────────┐
│   Realtime   │ ◄──────────────────── │  Upstash Redis    │
│   Client     │                         │  (Serverless)     │
└──────────────┘                         └──────────────────┘
```

**How it works:**

1. A user creates a room → the server generates a unique Room ID and stores metadata in Redis with a TTL.
2. When a second user navigates to the room URL, the middleware proxy validates room capacity, issues an auth token cookie, and registers them in Redis.
3. Messages flow in real-time via Upstash Realtime (SSE). The Elysia API handles message posting with Zod-validated schemas.
4. When the TTL expires (or the creator hits "Destroy"), Redis drops all room data — messages, metadata, everything.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router) |
| **UI** | [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/) |
| **API** | [Elysia.js](https://elysiajs.com/) (running inside Next.js API routes) |
| **Client SDK** | [Eden Treaty](https://elysiajs.com/eden/treaty) (end-to-end type-safe API client) |
| **Database** | [Upstash Redis](https://upstash.com/redis) (serverless, with TTL support) |
| **Realtime** | [Upstash Realtime](https://upstash.com/docs/realtime) (server-sent events) |
| **Validation** | [Zod](https://zod.dev/) (runtime schema validation) |
| **State Management** | [TanStack React Query](https://tanstack.com/query) |
| **ID Generation** | [nanoid](https://github.com/ai/nanoid) |
| **Runtime** | [Bun](https://bun.sh/) |

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- An [Upstash](https://upstash.com/) account (for Redis and Realtime)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/ArAnirudh2901/Redacted-Chat.git
   cd Redacted-Chat
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Configure environment variables**

   Create a `.env.local` file in the project root:

   ```env
   UPSTASH_REDIS_REST_URL=your_redis_url
   UPSTASH_REDIS_REST_TOKEN=your_redis_token
   ```

4. **Start the dev server**

   ```bash
   bun dev
   ```

   The app will be running at [http://localhost:3000](http://localhost:3000).

---

## 📁 Project Structure

```
src/
├── app/
│   ├── api/[[...slugs]]/
│   │   ├── route.js          # Elysia API routes (room creation, messaging)
│   │   └── auth.js           # Auth middleware (token validation)
│   ├── realtime/
│   │   └── route.js          # Upstash Realtime SSE handler
│   ├── room/[roomId]/
│   │   └── page.jsx          # Chat room UI
│   ├── page.js               # Landing page (room creation)
│   └── layout.js             # Root layout with providers
├── components/
│   └── providers.jsx         # React Query + Realtime providers
├── lib/
│   ├── client.js             # Eden Treaty API client
│   ├── redis.js              # Upstash Redis instance
│   ├── realtime.js           # Server-side Realtime instance + schemas
│   └── realtime-client.js    # Client-side Realtime hooks
└── proxy.js                  # Middleware proxy (room access control)
```

---

## 📝 License

This project is open source and available under the [MIT License](LICENSE).
