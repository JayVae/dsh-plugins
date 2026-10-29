/**
 * dsh-session-delete-plugin — host half.
 *
 * Registers one authenticated HTTP route on the DSH web server:
 *
 *   POST /.dsh-session-delete/delete   body: { sessionId }
 *
 * The route permanently deletes one stored session's local records:
 *   1. refuses while the session is live (open or running in this process);
 *   2. unpins / unarchives the session in the workspace registry and detaches
 *      it from every workspace's session accounting;
 *   3. removes the session's log directory under the session persistence root
 *      (`~/.dsh/sessions/<project>/<sessionId>/`);
 *   4. removes the projection cache file
 *      (`~/.dsh/storages/session_projcache/sessions/<sessionId>.json`);
 *   5. emits `api-session/removed` so every connected browser drops the row
 *      immediately (the full-text search index reconciles itself against the
 *      persistence listing and forgets the session on its next sync).
 *
 * Nothing outside the DSH home is touched, and the workspace directory itself
 * is never deleted — only this one conversation's records.
 */
import { homedir } from "node:os";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readdir, rm, stat } from "node:fs/promises";

/** Route prefix registered on the DSH web server. */
export const ROUTE_PREFIX = "/.dsh-session-delete";
/** `POST { sessionId }` — permanently delete one stored session's local records. */
export const ROUTE_DELETE = `${ROUTE_PREFIX}/delete`;

/** `POST { phase }` — client-side activation self-report, appended to the boot log. */
export const CLIENT_LOG_ROUTE = `${ROUTE_PREFIX}/client-log`;

/** Session ids are `session-<uuid>`; the strict shape doubles as path-safety. */
const SESSION_ID_RE = /^session-[A-Za-z0-9._-]{1,200}$/;

/** Deletion refused because the session is open or running in this process. */
export class SessionLiveError extends Error {
	constructor(sessionId) {
		super(`session '${sessionId}' is live in this process; close it before deleting`);
		this.name = "SessionLiveError";
		this.code = "SESSION_LIVE";
		this.sessionId = sessionId;
	}
}

/** Deletion refused because no local record for the session was found. */
export class SessionRecordNotFoundError extends Error {
	constructor(sessionId) {
		super(`no local record found for session '${sessionId}'`);
		this.name = "SessionRecordNotFoundError";
		this.code = "SESSION_RECORD_NOT_FOUND";
		this.sessionId = sessionId;
	}
}

/** Resolve the DSH home the same way the WeChat channel does. */
function resolveHome(ctx) {
	const home = ctx.get("homePaths");
	return home?.home ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Best-effort persistence root: the jsonl backend exposes its root directly. */
function resolveSessionsRoot(ctx, home) {
	try {
		const persistence = ctx.get("sessionPersistence") ?? ctx.sessionPersistence;
		if (typeof persistence?.root === "string" && persistence.root !== "") return persistence.root;
	} catch {
		// Fall through to the default layout below.
	}
	return join(home, "sessions");
}

/** The workspace registry service, or undefined when this profile lacks one. */
function resolveRegistry(ctx) {
	try {
		return ctx.workspaceRegistry ?? ctx.get("workspaceRegistry");
	} catch {
		return undefined;
	}
}

/** Read and parse one JSON request body. */
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (chunks.length === 0) return {};
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	} catch {
		throw new Error("request body is not valid JSON");
	}
}

/** Send one JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

/** Describe an unknown throwable for the error body. */
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * Delete one stored session's local records. See the module docblock for the
 * full step list.
 * @param ctx - Host cordis context.
 * @param sessionId - The stored session to delete.
 * @returns a summary of what was removed.
 */
export async function deleteSessionRecord(ctx, sessionId) {
	if (typeof sessionId !== "string" || !SESSION_ID_RE.test(sessionId)) {
		throw new Error("invalid session id");
	}
	const sessions = ctx.get("sessions");
	if (sessions?.get?.(sessionId) !== undefined) throw new SessionLiveError(sessionId);

	const registry = resolveRegistry(ctx);
	const detachedFrom = [];
	if (registry) {
		try {
			await registry.unpinSession?.(sessionId);
		} catch {
			// Pin cleanup is cosmetic; deletion proceeds.
		}
		try {
			await registry.unarchiveSession?.(sessionId);
		} catch {
			// Archive cleanup is cosmetic; deletion proceeds.
		}
		try {
			for (const entity of registry.list?.() ?? []) {
				const record = entity?.record;
				if (Array.isArray(record?.sessionIds) && record.sessionIds.includes(sessionId)) {
					await entity.detachSession(sessionId);
					detachedFrom.push(entity.id);
				}
			}
		} catch {
			// Accounting cleanup is cosmetic; deletion proceeds.
		}
	}

	const home = resolveHome(ctx);
	const root = resolveSessionsRoot(ctx, home);
	let logDir;
	try {
		const projects = await readdir(root, { withFileTypes: true });
		for (const project of projects) {
			if (!project.isDirectory()) continue;
			const candidate = join(root, project.name, sessionId);
			try {
				if ((await stat(candidate)).isDirectory()) {
					logDir = candidate;
					break;
				}
			} catch {
				// Not here; keep scanning.
			}
		}
	} catch (error) {
		console.error(`dsh-session-delete-plugin: cannot scan sessions root '${root}': ${describeError(error)}`);
	}

	let cacheDeleted = false;
	const cacheFile = join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
	try {
		await rm(cacheFile, { force: true });
		cacheDeleted = true;
	} catch (error) {
		console.error(`dsh-session-delete-plugin: cannot remove projection cache '${cacheFile}': ${describeError(error)}`);
	}

	if (logDir !== undefined) {
		await rm(logDir, { recursive: true, force: true });
	} else if (!cacheDeleted) {
		throw new SessionRecordNotFoundError(sessionId);
	}

	try {
		ctx.emit("api-session/removed", sessionId);
	} catch (error) {
		console.error(`dsh-session-delete-plugin: removed-event emission failed: ${describeError(error)}`);
	}

	return { sessionId, logDir: logDir ?? null, cacheDeleted, detachedFrom };
}

/** Route one HTTP request. */
async function route(req, res, ctx) {
	const url = new URL(req.url ?? "/", "http://localhost");
	try {
		if (url.pathname === ROUTE_DELETE && req.method === "POST") {
			const body = await readJson(req);
			const summary = await deleteSessionRecord(ctx, body.sessionId);
			bootLog(ctx, `delete ok: ${JSON.stringify(summary)}`);
			return json(res, 200, { ok: true, ...summary });
		}
		if (url.pathname === CLIENT_LOG_ROUTE && req.method === "POST") {
			const body = await readJson(req);
			bootLog(ctx, `client[${typeof body.phase === "string" ? body.phase : "unknown"}]`);
			return json(res, 200, { ok: true });
		}
		return json(res, 404, { error: "not found" });
	} catch (error) {
		if (error instanceof SessionLiveError) return json(res, 409, { error: "live" });
		if (error instanceof SessionRecordNotFoundError) return json(res, 404, { error: "not-found" });
		bootLog(ctx, `delete failed: ${describeError(error)}`);
		console.error(`dsh-session-delete-plugin: delete failed: ${describeError(error)}`);
		return json(res, 500, { error: describeError(error) });
	}
}

/** Best-effort boot/diagnostic log under the DSH home, so failures are visible without the launcher console. */
function bootLog(ctx, line) {
	try {
		const file = join(resolveHome(ctx), "session-delete.log");
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${new Date().toISOString()} ${line}\n`, "utf-8");
	} catch {
		// Diagnostics must never break the plugin.
	}
}

/** Log whether the client-module graph contains this plugin's client bundle. */
function logClientGraph(ctx) {
	try {
		const modules = ctx.get("clientModules") ?? ctx.clientModules;
		const graph = modules?.graph?.();
		const entry = Array.isArray(graph?.entries) ? graph.entries.find((row) => row?.id === "dsh-session-delete-plugin") : undefined;
		if (entry === undefined) {
			bootLog(ctx, "client graph: dsh-session-delete-plugin NOT in entries");
			return;
		}
		bootLog(ctx, `client graph entry: ${JSON.stringify(entry)}`);
	} catch (error) {
		bootLog(ctx, `client graph read failed: ${describeError(error)}`);
	}
}

/**
 * Mount the deletion route.
 * @param ctx - Host cordis context.
 */
export function apply(ctx) {
	bootLog(ctx, "apply entered");
	// The webServer service may start after this plugin applies; defer route
	// registration until it is available (same pattern client-modules uses).
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.get("webServer");
		if (webServer === undefined) {
			bootLog(webCtx, "webServer inject resolved without a service");
			console.error("dsh-session-delete-plugin: no webServer service; deletion route unavailable");
			return undefined;
		}
		bootLog(webCtx, "webServer ready; registering route");
		return webServer.register({
			kind: "prefix",
			path: ROUTE_PREFIX,
			handler: (req, res) => {
				void route(req, res, webCtx);
			}
		});
	});
	// Diagnostics: once the client module system has composed, confirm whether
	// this plugin's client bundle is part of the boot graph.
	ctx.inject(["clientModules"], (moduleCtx) => {
		logClientGraph(moduleCtx);
	});
}
