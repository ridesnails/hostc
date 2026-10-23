/** Bumped on any incompatible wire change. Client and server must match exactly. */
export const PROTOCOL_VERSION = 5;

/** Request header carrying PROTOCOL_VERSION on tunnel API calls. */
export const PROTOCOL_HEADER = "hostc-protocol";

/**
 * Text messages on the client connection. Everything else is a binary frame.
 * The runtime answers PING on every WebSocket of the tunnel, visitors' included, so it must be a
 * message no app sends; a plain "ping" would be swallowed by apps with their own heartbeat.
 */
export const PING = "hostc:ping";
export const PONG = "hostc:pong";

/** How often the client pings, and how long it waits for the pong. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;

/** The server treats the client as gone when its last ping is older than this. */
export const CLIENT_STALE_MS = 45_000;

/** Largest DATA payload for an HTTP body chunk. */
export const MAX_CHUNK_BYTES = 64 * 1024;

/** Per-stream, per-direction flow control window for HTTP bodies. */
export const STREAM_WINDOW_BYTES = 256 * 1024;

/** WebSocket messages are forwarded whole and never split. */
export const MAX_WEBSOCKET_MESSAGE_BYTES = 1024 * 1024 - 64;

/** Concurrent streams (HTTP requests + WebSockets) per tunnel. */
export const MAX_STREAMS = 256;

/** How long the server waits for the local server to start responding. */
export const RESPONSE_TIMEOUT_MS = 120_000;

/** A new tunnel must be connected within this window. */
export const CONNECT_GRACE_MS = 2 * 60_000;

/** A disconnected tunnel keeps its URL for this long, waiting for a reconnect. */
export const RECONNECT_GRACE_MS = 10 * 60_000;

/** Close code the client uses when it shuts down on purpose; the tunnel is released at once. */
export const CLOSE_SHUTDOWN = 4000;

/** Close code the server uses when a newer connection replaced this one. */
export const CLOSE_REPLACED = 4001;

/** Close code for protocol violations. */
export const CLOSE_PROTOCOL_ERROR = 1002;

export const API_TUNNELS_PATH = "/api/tunnels";

/** Lowercase letters and digits without the look-alikes 0, 1, l and o. */
export const TUNNEL_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const TUNNEL_ID_LENGTH = 12;

export function isTunnelId(value: string): boolean {
	if (value.length !== TUNNEL_ID_LENGTH) {
		return false;
	}
	for (const char of value) {
		if (!TUNNEL_ID_ALPHABET.includes(char)) {
			return false;
		}
	}
	return true;
}

/**
 * Fork extension (ridesnails/hostc, not upstream): a tunnel may claim a fixed name
 * instead of a random id, so its public URL stays stable across restarts.
 *
 * A name is 3-32 chars of lowercase letters, digits and hyphens, starting and ending
 * with a letter or digit. A name never collides with a random id: anything that
 * `isTunnelId` accepts is not a name. Claiming a name requires the server's
 * NAMED_TUNNEL_TOKEN; random tunnels stay anonymous as before.
 */
export function isTunnelName(value: string): boolean {
	if (value.length < 3 || value.length > 32 || isTunnelId(value)) {
		return false;
	}
	return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

/** What may appear as the `<label>` in `<label>.<TUNNEL_DOMAIN>`: a random id or a claimed name. */
export function isTunnelLabel(value: string): boolean {
	return isTunnelId(value) || isTunnelName(value);
}

/** Request body of `POST /api/tunnels`. Empty for a random tunnel; `name` claims a fixed name. */
export type CreateTunnelRequest = {
	name?: string;
};

/** Response body of `POST /api/tunnels`. */
export type CreateTunnelResponse = {
	id: string;
	url: string;
	connectUrl: string;
	token: string;
};

export function isCreateTunnelResponse(value: unknown): value is CreateTunnelResponse {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === "string" &&
		typeof record.url === "string" &&
		typeof record.connectUrl === "string" &&
		typeof record.token === "string"
	);
}
