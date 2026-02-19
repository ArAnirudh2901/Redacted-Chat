import { treaty } from '@elysiajs/eden'

// Create the Eden Treaty client
/** @type {ReturnType<typeof treaty<import('@/app/api/[[...slugs]]/route').app>>} */
const _client = treaty('http://localhost:3000')
// Elysia route inference is unreliable in JS + checkJs projects, so use a widened client type.
/** @type {any} */
export const client = _client.api
