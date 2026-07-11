/**
 * ```mermaid fence — the render-primary reference plugin's grammar, built on the
 * public registration seams only. Dev/e2e harness only.
 *
 * The block is an opaque container with NO children: the diagram code lives in
 * typed plugin metadata, and `rebuildMermaidRaw` re-emits the exact fence bytes
 * from it — so an `updateOwnMetadata({ code })` commit is the whole edit path.
 * Uninstall safety is by construction: without this opener the same bytes parse
 * as plain `fencedCode` and serialize identically.
 */

import {
	declarePluginKind,
	registerBlockKind,
	registerBlockOpener,
	registerBlockCommand,
	setPluginMetadata,
	getPluginMetadata,
	matchFenceOpen,
	matchFenceClose,
	type FenceOpen,
	type CstNode
} from '$lib/plugin';

export const MERMAID = 'mermaid';

/**
 * Everything `rebuildMermaidRaw` needs to re-emit the exact bytes; all values
 * primitives (the undo clone shallow-copies metadata). `infoRaw` is the opener
 * text after the fence run, verbatim (trailing spaces included); `closerRaw` is
 * the whole closer line including its line ending, `''` when unterminated.
 */
export interface MermaidMetadata {
	code: string;
	openerIndent: string;
	fenceChar: string;
	fenceLength: number;
	infoRaw: string;
	openerLineEnding: string;
	closerRaw: string;
}

// ── Fence grammar ─────────────────────────────────────────────────────────────
// The barrel's built-in matcher, gated on the info string's first word — the
// CommonMark fence rules stay the editor's, never a plugin copy.

function matchMermaidFence(text: string): FenceOpen | null {
	const fence = matchFenceOpen(text);
	return fence && fence.info.split(/\s+/)[0] === MERMAID ? fence : null;
}

/** Recompute `raw` from metadata — the opener's inverse, and the byte path every code edit rides. */
export function rebuildMermaidRaw(node: CstNode): void {
	const meta = getPluginMetadata<MermaidMetadata>(node);
	if (!meta) return;
	node.raw =
		meta.openerIndent +
		meta.fenceChar.repeat(meta.fenceLength) +
		meta.infoRaw +
		meta.openerLineEnding +
		meta.code +
		meta.closerRaw;
}

// ── Component UI hooks ────────────────────────────────────────────────────────
// Block commands resolve to a (node, metadata-writer) context with no component
// channel, so view-state commands (edit mode, focus overlay) need a plugin-owned
// node → component bridge. The component binds its hooks per mounted node.

export interface MermaidUiHooks {
	openEdit(): void;
	openFocusView(): void;
}

const uiHooks = new Map<CstNode, MermaidUiHooks>();

export function bindMermaidUiHooks(node: CstNode, hooks: MermaidUiHooks): () => void {
	uiHooks.set(node, hooks);
	return () => uiHooks.delete(node);
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMermaidKind(): void {
	const mermaid = declarePluginKind(MERMAID);

	// mermaid.edit carries no default chord — the edit affordance is the button;
	// the minted command exists for consumer keymap bindings.
	registerBlockCommand(mermaid, 'mermaid.edit', (ctx) => {
		const hooks = uiHooks.get(ctx.node);
		if (!hooks) return false;
		hooks.openEdit();
		return true;
	});
	const focusCommand = registerBlockCommand(mermaid, 'mermaid.focus', (ctx) => {
		const hooks = uiHooks.get(ctx.node);
		if (!hooks) return false;
		hooks.openFocusView();
		return true;
	});

	registerBlockKind(mermaid, {
		// Backspace from the block below must never merge text into a diagram;
		// with the block also non-mergeable-into, the fallback is a focus move.
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		container: {
			// No children: raw is authoritative and rebuilt from metadata alone,
			// which is exactly the 'opaque' contract (exempt from the strip
			// byte-check; guarded by the reparse + determinism probes instead).
			contract: 'opaque',
			rebuildRaw: rebuildMermaidRaw
		},
		keymap: [{ chord: 'Mod+M', command: focusCommand }]
	});

	registerBlockOpener(mermaid, {
		// fencedCode@10 accepts EVERY fence, ```mermaid included, so unlike the
		// details opener (which slots between built-ins at 65) this must price
		// AHEAD of the superset matcher. 5 sits mid-gap below 10 and ties nothing.
		priority: 5,
		interruptsParagraph: (line) => matchMermaidFence(line) !== null,
		tryOpen(ctx) {
			const fence = matchMermaidFence(ctx.line.text);
			if (!fence) return null;

			let closeIdx = -1;
			for (let i = ctx.index + 1; i < ctx.end; i++) {
				if (matchFenceClose(ctx.lines[i].text, fence.marker, fence.length)) {
					closeIdx = i;
					break;
				}
			}
			// Unterminated consumes to end of input, like the built-in fence.
			const codeEnd = closeIdx === -1 ? ctx.end : closeIdx;
			const code = ctx.lines
				.slice(ctx.index + 1, codeEnd)
				.map((l) => l.raw)
				.join('');

			const node: CstNode = {
				kind: mermaid,
				leadingTrivia: ctx.leadingTrivia,
				raw: '',
				children: []
			};
			setPluginMetadata<MermaidMetadata>(node, {
				code,
				openerIndent: fence.indent,
				fenceChar: fence.marker,
				fenceLength: fence.length,
				infoRaw: fence.infoRaw,
				openerLineEnding: ctx.line.lineEnding,
				closerRaw: closeIdx === -1 ? '' : ctx.lines[closeIdx].raw
			});
			// Raw comes FROM the rebuild, so opener and rebuild agree by construction.
			rebuildMermaidRaw(node);
			return { node, nextIndex: closeIdx === -1 ? ctx.end : closeIdx + 1 };
		}
	});
}
