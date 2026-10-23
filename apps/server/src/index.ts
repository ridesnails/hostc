import {
	API_TUNNELS_PATH,
	type CreateTunnelRequest,
	type CreateTunnelResponse,
	isTunnelLabel,
	isTunnelName,
	PROTOCOL_HEADER,
	PROTOCOL_VERSION,
	TUNNEL_ID_ALPHABET,
	TUNNEL_ID_LENGTH,
} from "@hostc/protocol";

import { errorResponse, pages } from "./pages.ts";
import { signConnectToken, verifyConnectToken } from "./token.ts";
import { CONNECT_URL } from "./tunnel.ts";

export { Tunnel } from "./tunnel.ts";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const tunnelId = tunnelIdFromHost(url.host, env.TUNNEL_DOMAIN);
		if (tunnelId !== undefined) {
			return handleTunnelRequest(request, env, tunnelId);
		}

		if (url.pathname === "/api/health") {
			return Response.json({ ok: true });
		}
		if (url.pathname.startsWith(API_TUNNELS_PATH)) {
			// Checked before routing, so clients on any older protocol (including their old paths)
			// get the 426 they know how to show as "please upgrade".
			const mismatch = checkProtocol(request);
			if (mismatch) {
				return mismatch;
			}
		}
		if (url.pathname === API_TUNNELS_PATH) {
			return request.method === "POST" ? createTunnel(request, env, url) : jsonError(405, "Method not allowed");
		}
		const connect = url.pathname.match(/^\/api\/tunnels\/([^/]+)\/connect$/);
		if (connect?.[1]) {
			return connectTunnel(request, env, connect[1]);
		}
		return jsonError(404, "Not found");
	},
} satisfies ExportedHandler<Env>;

/**
 * `undefined` when the host is not under the tunnel domain,
 * `null` when it is but the label is not a valid tunnel id.
 */
export function tunnelIdFromHost(host: string, tunnelDomain: string): string | null | undefined {
	const suffix = `.${tunnelDomain.toLowerCase()}`;
	const normalized = host.toLowerCase();
	if (!normalized.endsWith(suffix)) {
		return undefined;
	}
	const label = normalized.slice(0, -suffix.length);
	return isTunnelLabel(label) ? label : null;
}

function handleTunnelRequest(request: Request, env: Env, tunnelId: string | null): Promise<Response> | Response {
	if (tunnelId === null) {
		return errorResponse(request, pages.notFound);
	}
	return env.TUNNEL.getByName(tunnelId).fetch(request);
}

async function createTunnel(request: Request, env: Env, url: URL): Promise<Response> {
	const client = request.headers.get("cf-connecting-ip") ?? "local";
	const { success } = await env.CREATE_LIMIT.limit({ key: client });
	if (!success) {
		return jsonError(429, "Too many tunnels created. Try again in a minute.");
	}

	// Fork extension: an optional JSON body { name } claims a fixed tunnel name.
	// Random tunnels (no body) stay anonymous; a name is only handed out to a
	// caller presenting the NAMED_TUNNEL_TOKEN secret, so names cannot be squatted.
	let id: string;
	const requested = await readRequestedName(request);
	if (requested instanceof Response) {
		return requested;
	}
	if (requested !== undefined) {
		if (!isTunnelName(requested)) {
			return jsonError(400, `Invalid tunnel name "${requested}". Use 3-32 lowercase letters, digits or hyphens.`);
		}
		if (!(await isNamedTunnelAdmin(request, env))) {
			return jsonError(401, "Claiming a tunnel name requires the named-tunnel token.");
		}
		id = requested;
	} else {
		id = randomTunnelId();
	}
	await env.TUNNEL.getByName(id).init();

	const connectUrl = new URL(`${API_TUNNELS_PATH}/${id}/connect`, url);
	connectUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const body: CreateTunnelResponse = {
		id,
		url: `${url.protocol}//${id}.${env.TUNNEL_DOMAIN}`,
		connectUrl: connectUrl.toString(),
		token: await signConnectToken(env.TOKEN_SECRET, id),
	};
	return Response.json(body, { status: 201 });
}

async function connectTunnel(request: Request, env: Env, id: string): Promise<Response> {
	if (!isTunnelLabel(id)) {
		return jsonError(404, "Tunnel not found");
	}
	if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return jsonError(426, "Expected a WebSocket upgrade");
	}
	const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
	if (!token || !(await verifyConnectToken(env.TOKEN_SECRET, id, token))) {
		return jsonError(401, "Invalid tunnel token");
	}
	return env.TUNNEL.getByName(id).fetch(new Request(CONNECT_URL, request));
}

function checkProtocol(request: Request): Response | null {
	if (request.headers.get(PROTOCOL_HEADER) === String(PROTOCOL_VERSION)) {
		return null;
	}
	return jsonError(426, "This hostc version is not supported by the server. Run `npx hostc@latest` to upgrade.");
}

/**
 * The optional `name` from a create request's JSON body.
 * Returns undefined for an anonymous (random) tunnel, or an error Response.
 */
async function readRequestedName(request: Request): Promise<string | undefined | Response> {
	const text = await request.text();
	if (!text) {
		return undefined;
	}
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return jsonError(400, "Create request body must be JSON.");
	}
	const name = (body as CreateTunnelRequest | null)?.name;
	if (name === undefined) {
		return undefined;
	}
	if (typeof name !== "string") {
		return jsonError(400, "Tunnel name must be a string.");
	}
	return name;
}

/** Named tunnels are authorized by `Authorization: Bearer <NAMED_TUNNEL_TOKEN>`. */
async function isNamedTunnelAdmin(request: Request, env: Env): Promise<boolean> {
	const secret = (env as { NAMED_TUNNEL_TOKEN?: string }).NAMED_TUNNEL_TOKEN;
	if (!secret) {
		return false;
	}
	const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
	if (!token) {
		return false;
	}
	// Compare SHA-256 digests so the comparison time does not leak the secret.
	const encoder = new TextEncoder();
	const [given, expected] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(token)),
		crypto.subtle.digest("SHA-256", encoder.encode(secret)),
	]);
	const a = new Uint8Array(given);
	const b = new Uint8Array(expected);
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	}
	return diff === 0;
}

function randomTunnelId(): string {
	// The alphabet has 32 characters, so masking a random byte has no bias.
	const bytes = crypto.getRandomValues(new Uint8Array(TUNNEL_ID_LENGTH));
	return Array.from(bytes, (byte) => TUNNEL_ID_ALPHABET[byte & 31]).join("");
}

function jsonError(status: number, error: string): Response {
	return Response.json({ error }, { status });
}
