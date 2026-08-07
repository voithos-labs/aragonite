/**
 * The reference whole-block container, on public registration seams only: an opaque
 * container with no children, its diagram code in typed metadata, so an
 * `updateOwnMetadata({ code })` commit is the whole edit path. Uninstall safety is by
 * construction: without this opener the same bytes parse as plain `fencedCode`.
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
	OPENER_PRIORITIES,
	type FenceOpen,
	type CstNode
} from '$lib/plugin';

export const MERMAID = 'mermaid';

/**
 * Everything `rebuildMermaidRaw` needs to re-emit the exact bytes, all primitives
 * because the undo clone shallow-copies metadata. `infoRaw` and `closerRaw` are
 * verbatim slices, trailing spaces and line ending included; `closerRaw` is `''`
 * when the fence is unterminated.
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
// The barrel's built-in matcher, gated on the info string's first word, so the
// CommonMark fence rules stay the editor's and never become a plugin copy.

function matchMermaidFence(text: string): FenceOpen | null {
	const fence = matchFenceOpen(text);
	return fence && fence.info.split(/\s+/)[0] === MERMAID ? fence : null;
}

/**
 * The edit textarea normalizes to LF, so a CRLF-authored diagram needs its authored
 * ending put back on every body line. An emptied body commits as `''`, no stray line.
 */
export function joinMermaidBody(draft: string, lineEnding: string): string {
	if (draft.length === 0) return '';
	return draft.replaceAll('\n', lineEnding) + lineEnding;
}

/** The opener's inverse, and the byte path every code edit rides. */
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
// `ctx.hooks` is the platform's command→component channel; the handlers below cast it
// back to this shape and decline when absent (kind registered, no instance mounted).

export interface MermaidUiHooks {
	openEdit(): void;
	openFocusView(): void;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMermaidKind(): void {
	const mermaid = declarePluginKind(MERMAID);

	// No default chord: the edit affordance is the button, and this command exists for
	// consumer keymap bindings.
	registerBlockCommand(mermaid, 'mermaid.edit', (ctx) => {
		const hooks = ctx.hooks as MermaidUiHooks | undefined;
		if (!hooks) return false;
		hooks.openEdit();
		return true;
	});
	const focusCommand = registerBlockCommand(mermaid, 'mermaid.focus', (ctx) => {
		const hooks = ctx.hooks as MermaidUiHooks | undefined;
		if (!hooks) return false;
		hooks.openFocusView();
		return true;
	});

	registerBlockKind(mermaid, {
		// Backspace from the block below must never merge text into a diagram.
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// ThematicBreak's focus-then-delete model: arrows stop on it, and a caret-adjacent
		// Backspace focuses before a second press deletes.
		blockFocus: 'whole-block',
		// Leading edge only, for the same reason as thematicBreak: its focused Enter already
		// inserts a paragraph below.
		gapEdges: 'before',
		container: {
			// Raw is rebuilt from metadata alone, so it is exempt from the strip byte-check
			// and guarded by the reparse + determinism probes instead.
			contract: 'opaque',
			rebuildRaw: rebuildMermaidRaw
		},
		// The char-based default would seed a rendered diagram at ~one line; the measured
		// height supersedes this on mount.
		estimateHeight: () => 320,
		keymap: [{ chord: 'Mod+M', command: focusCommand }],
		conformanceFixture: '```mermaid\ngraph TD\n```\n',
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'container contract=opaque — rebuildMermaidRaw from metadata'
			},
			focus: {
				mode: 'implemented',
				via: 'blockFocus=whole-block — focus-then-delete; the component supplies the focus surface'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'blockFocus=whole-block — caret-adjacent Backspace focuses, a second press deletes'
			},
			selectionPaint: { mode: 'implemented', via: 'whole-block cover rect via the container shim' },
			searchPaint: {
				mode: 'implemented',
				via: 'raw scans as a leaf, painted via the container shim measurePartialRects; replace skips it — metadata-derived raw (issue #41)'
			},
			reorder: {
				mode: 'implemented',
				via: 'Alt+ArrowUp/Down whole-block reorder (nudgeReorderUnit)'
			},
			undo: {
				mode: 'implemented',
				via: 'updateOwnMetadata — a code edit commits as one undoable metadataUpdate'
			},
			clipboard: {
				mode: 'implemented',
				via: 'focused-block Mod+C/Mod+X (handleWholeBlockKeys); a cross-block range carries the unit whole, per the kit byte-slice check'
			},
			simOracle: {
				mode: 'implemented',
				via: 'mermaid decoration/selection overlay e2e under the [invariant:] watcher'
			}
		}
	});

	registerBlockOpener(mermaid, {
		// `fencedCode` accepts every fence, ```mermaid included, so this must price ahead
		// of that superset matcher rather than slot into a gap between built-ins.
		priority: OPENER_PRIORITIES.fencedCode - 5,
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
			// Raw comes from the rebuild, so opener and rebuild agree by construction.
			rebuildMermaidRaw(node);
			return { node, consumed: (closeIdx === -1 ? ctx.end : closeIdx + 1) - ctx.index };
		}
	});
}
