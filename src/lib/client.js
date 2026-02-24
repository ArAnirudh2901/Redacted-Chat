import { treaty } from '@elysiajs/eden'

const SERVER_API_ORIGIN =
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    'http://localhost:3000'

// Create the Eden Treaty client
/** @type {ReturnType<typeof treaty<import('@/app/api/[[...slugs]]/route').app>>} */
const _client = treaty(typeof window !== 'undefined' ? window.location.origin : SERVER_API_ORIGIN, {
    fetch: {
        credentials: 'include'
    }
})
// Elysia route inference is unreliable in JS + checkJs projects, so use a widened client type.
/** @type {any} */
export const client = _client.api
