/**
 * dsh-session-delete-plugin — browser half.
 *
 * Adds one 「删除对话（本地记录）」 row to every sidebar conversation's "…"
 * menu (`sidebar.workspaces.session.menu.item`), raising a confirmation
 * dialog mounted in `shell.overlay` (the row menu unmounts with the menu, so
 * the dialog lives outside it, following the built-in rename/archive pattern).
 * Confirming POSTs to the host half's route, which permanently deletes the
 * conversation's local records; the sidebar row disappears through the
 * existing `api-session/removed` relay.
 */
window.__ModuleLoader__.load({
	id: "dsh-session-delete-plugin",
	factory: (require) => {
		const react = require("react");
		const JSX = require("react/jsx-runtime");
		const jsx = JSX.jsx;
		const jsxs = JSX.jsxs;
		const P = require("@deepseek-ai/dsh-client-ui-primitives");
		const { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");

		/** Red danger button + status lines, on the same design tokens the built-in workspace dialogs use. */
		const css =
			".sdp_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}" +
			".sdp_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}" +
			".sdp_deleteError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-session-delete-plugin"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-delete-plugin";
			tag.dataset.pluginCss = "dsh-session-delete-plugin";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Dictionary namespace owned by this plugin. */
		const NS = "session-delete";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"menu.deleteSession": "删除对话（本地记录）",
			"confirm.title": "删除对话",
			"confirm.desc": "将永久删除对话「{title}」在本机的全部聊天记录，此操作不可恢复。",
			"confirm.action": "彻底删除",
			"confirm.pending": "正在删除…",
			"confirm.live": "该对话正在使用中，请先切换到其他对话再删除。",
			close: "关闭",
			cancel: "取消"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"menu.deleteSession": "Delete conversation (local records)",
			"confirm.title": "Delete conversation",
			"confirm.desc": "Permanently delete all local records of “{title}” on this machine. This cannot be undone.",
			"confirm.action": "Delete permanently",
			"confirm.pending": "Deleting…",
			"confirm.live": "This conversation is in use; switch to another one before deleting it.",
			close: "Close",
			cancel: "Cancel"
		};

		/** The one pending confirmation request, shared by the menu rows and the overlay dialog. */
		const deleteRequest = createSnapshotStore(null);

		/** Map one host refusal code to localized copy. */
		const refusalText = (code, t) => (code === "live" ? t("confirm.live") : `${t("confirm.failed")}: ${code}`);

		/**
		 * Menu row (order 475, after the built-in items): raise the delete request.
		 * @param props - Row identity, menu open state, and the locale seat.
		 * @returns the menu row.
		 */
		function DeleteSessionMenuItem({ sessionId, useMenuOpenState, t }) {
			const [, setMenuOpen] = useMenuOpenState();
			return jsx(P.MenuItemButton, {
				icon: jsx(P.IconTrashOutlineRegular, {}),
				onSelect: () => {
					setMenuOpen(false);
					deleteRequest.set({ sessionId });
				},
				children: t("menu.deleteSession")
			});
		}

		/**
		 * The `shell.overlay` entry: nothing while no deletion is requested, otherwise
		 * one confirmation dialog (keyed by the session, so a new request starts fresh).
		 * @param props - The request hook and the locale seat.
		 * @returns the open dialog, or null.
		 */
		function SessionDeleteConfirmDialog({ useDeleteRequest, t }) {
			const request = useDeleteRequest((current) => current);
			const [deleting, setDeleting] = react.useState(false);
			const [error, setError] = react.useState(null);
			react.useEffect(() => {
				setDeleting(false);
				setError(null);
			}, [request]);
			if (request === null) return null;
			const close = () => {
				if (deleting) return;
				deleteRequest.set(null);
			};
			const confirm = () => {
				if (deleting) return;
				setDeleting(true);
				setError(null);
				fetch("/.dsh-session-delete/delete", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId: request.sessionId })
				})
					.then(async (response) => {
						const body = await response.json().catch(() => ({}));
						if (!response.ok) throw new Error(refusalText(body.error ?? `HTTP ${String(response.status)}`, t));
						deleteRequest.set(null);
					})
					.catch((reason) => {
						setDeleting(false);
						setError(reason instanceof Error ? reason.message : String(reason));
					});
			};
			return jsx(P.Modal, {
				open: true,
				onClose: close,
				closeLabel: t("close"),
				title: t("confirm.title"),
				description: t("confirm.desc", { title: request.displayTitle ?? request.sessionId }),
				footer: jsxs(react.Fragment, {
					children: [
						jsx(P.Button, {
							variant: "outline",
							disabled: deleting,
							onClick: close,
							children: t("cancel")
						}),
						jsx(P.Button, {
							variant: "outline",
							className: "sdp_deleteAction",
							disabled: deleting,
							onClick: confirm,
							children: t("confirm.action")
						})
					]
				}),
				children: [
					deleting && jsx("div", { className: "sdp_deleteStatus", role: "status", children: t("confirm.pending") }),
					error !== null && jsx("div", { className: "sdp_deleteError", role: "alert", children: error })
				]
			});
		}

		/** Fire-and-forget self-report to the host's log, so activation is verifiable without the browser console. */
		function reportClient(phase) {
			console.error(`[dsh-session-delete-plugin] client ${phase}`);
			try {
				void fetch("/.dsh-session-delete/client-log", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ phase })
				}).catch(() => {});
			} catch {
				// Diagnostics must never break the plugin.
			}
		}

		/** Services required by this plugin. */
		const inject = ["slots", "locale"];
		/**
		 * Register the menu row and the confirmation dialog.
		 * @param ctx - Browser root context.
		 */
		function apply(ctx) {
			reportClient("apply entered");
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-delete: dictionaries");
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => {
				reportClient("menu item registering");
				return ctx.slots.register(
					{
						name: "sidebar.workspaces.session.menu.item",
						id: "session-delete",
						order: 475,
						locale: NS
					},
					DeleteSessionMenuItem
				);
			});
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register(
					{
						name: "shell.overlay",
						id: "session-delete-confirm",
						locale: NS,
						inject: () => ({ hooks: { deleteRequest } })
					},
					SessionDeleteConfirmDialog
				)
			);
			reportClient("apply done");
		}

		return { name: "dsh-session-delete-plugin", inject, apply };
	}
});
