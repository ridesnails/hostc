import { parseArgs } from "node:util";

import { isTunnelName } from "@hostc/protocol";

export type Command =
	| { kind: "run"; target: URL; server: string; qr: boolean; name?: string }
	| { kind: "codex"; server: string; qr: boolean; here: boolean }
	| { kind: "help" }
	| { kind: "version" }
	| { kind: "error"; message: string };

export const USAGE = `Usage: hostc <target> [options]
       hostc codex [options]

Expose a local HTTP/WebSocket server through a public URL.
"hostc codex" (experimental) opens Codex from any browser, through a private link\nthat can read any file and run any command as you.

Target:
  3000                     http://localhost:3000
  127.0.0.1:8080           http://127.0.0.1:8080
  https://localhost:5173   any http(s) origin

Options:
  --server <url>   tunnel server (env HOSTC_SERVER)
  --name <name>    claim a fixed tunnel name, e.g. --name magpie gives
                   https://magpie.<tunnel-domain> (env HOSTC_NAME);
                   needs env HOSTC_ADMIN_TOKEN with the server's named-tunnel token
  --qr             print a QR code of the public URL
  --here           hostc codex: show only this directory (commands still reach
                   the whole machine)
  -h, --help       show this help
  -v, --version    show the version`;

export function parseCommand(argv: string[], env: Record<string, string | undefined>, defaultServer: string): Command {
	let parsed: ReturnType<typeof parse>;
	try {
		parsed = parse(argv);
	} catch (error) {
		return { kind: "error", message: (error as Error).message };
	}
	const { values, positionals } = parsed;
	if (values.help) {
		return { kind: "help" };
	}
	if (values.version) {
		return { kind: "version" };
	}
	const [input, ...rest] = positionals;
	if (!input) {
		return { kind: "help" };
	}
	if (rest.length > 0) {
		return { kind: "error", message: `Unexpected argument: ${rest[0]}` };
	}
	const target = input === "codex" ? null : parseTarget(input);
	if (input !== "codex" && !target) {
		return { kind: "error", message: `Invalid target "${input}". Use a port like 3000, host:port, or an http(s) URL.` };
	}
	const server = values.server ?? env.HOSTC_SERVER ?? defaultServer;
	if (!URL.canParse(server) || !/^https?:$/.test(new URL(server).protocol)) {
		return { kind: "error", message: `Invalid server URL "${server}".` };
	}
	const qr = values.qr ?? false;
	const here = values.here ?? false;
	const name = values.name ?? env.HOSTC_NAME;
	if (name !== undefined && !isTunnelName(name)) {
		return {
			kind: "error",
			message: `Invalid tunnel name "${name}". Use 3-32 lowercase letters, digits or hyphens.`,
		};
	}
	if (target && here) {
		return { kind: "error", message: "--here only applies to hostc codex." };
	}
	return target ? { kind: "run", target, server, qr, name } : { kind: "codex", server, qr, here };
}

function parse(argv: string[]) {
	return parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			server: { type: "string" },
			name: { type: "string" },
			qr: { type: "boolean" },
			here: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
}

/** Accepts `3000`, `host:port`, or an http(s) URL; returns the origin to forward to. */
export function parseTarget(input: string): URL | null {
	if (/^\d+$/.test(input)) {
		return isPort(Number(input)) ? new URL(`http://localhost:${input}`) : null;
	}
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
	// Without a scheme, require host:port so a typo is not mistaken for a hostname on port 80.
	if (!hasScheme && !/:\d+$/.test(input)) {
		return null;
	}
	const candidate = hasScheme ? input : `http://${input}`;
	if (!URL.canParse(candidate)) {
		return null;
	}
	const url = new URL(candidate);
	if (!/^https?:$/.test(url.protocol) || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
		return null;
	}
	return new URL(url.origin);
}

function isPort(value: number): boolean {
	return Number.isInteger(value) && value > 0 && value < 65_536;
}
