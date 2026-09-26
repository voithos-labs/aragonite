/**
 * The worked example of a whole-block container, using public registration only: an opaque
 * container with no children, its diagram code in typed metadata, so an
 * `updateOwnMetadata({ code })` commit is the whole edit path. Uninstalling is safe by
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
	escalatedFenceLength,
	OPENER_PRIORITIES,
	trimTrailingLineEnding,
	displayLines,
	ownTrailingLineEnding,
	trailingLineEnding,
	type FenceOpen,
	type CstNode,
	type NodeView,
	type RawWriteContext
} from '$lib/plugin';

export const MERMAID = 'mermaid';

/**
 * Everything `rebuildMermaidRaw` needs to re-emit the exact bytes, all primitives because the
 * undo clone shallow-copies metadata. The `*Raw` fields are verbatim slices, trailing spaces
 * and line ending included.
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
// The editor's own fence matcher, filtered on the info string's first word, so the CommonMark
// fence rules stay in one place and never become a plugin's copy of them.

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

/**
 * The opener's inverse, and what every code edit goes through. The body is a metadata string
 * this kind never re-parses, so the fence is sized against it here: a diagram line that reads
 * as this block's closer would otherwise cut the block short on its next load.
 */
export function rebuildMermaidRaw(node: CstNode): void {
	const meta = getPluginMetadata<MermaidMetadata>(node);
	if (!meta) return;
	const marker = meta.fenceChar === '~' ? '~' : '`';
	const fenceLength = escalatedFenceLength(meta.code, marker, meta.fenceLength);
	node.raw =
		meta.openerIndent +
		marker.repeat(fenceLength) +
		meta.infoRaw +
		meta.openerLineEnding +
		meta.code +
		(fenceLength > meta.fenceLength
			? grownCloser(meta.closerRaw, marker, fenceLength)
			: meta.closerRaw);
}

/**
 * Grow a verbatim closer line's run to `length`, keeping its indent, trailing spaces and line
 * ending. An unterminated block has no closer line and gains none: the parser reads it to the end
 * of input either way.
 */
function grownCloser(closerRaw: string, marker: '`' | '~', length: number): string {
	const match = /^( {0,3})([`~]+)([\s\S]*)$/.exec(closerRaw);
	if (!match) return closerRaw;
	return match[1] + marker.repeat(Math.max(match[2].length, length)) + match[3];
}

/**
 * Put back a closing fence a truncating write dropped (a range delete or a find/replace over the
 * fence bytes), sized on the written opener's run, so the blocks below never become diagram
 * source. A first line that no longer opens a mermaid fence is left alone. The closer line takes
 * the block's own ending, else the document's.
 */
function normalizeMermaidRaw(raw: string, node: NodeView, write: RawWriteContext): string {
	const display = trimTrailingLineEnding(raw);
	const lines = displayLines(display);
	const fence = matchMermaidFence(lines[0].text);
	if (!fence) return raw;
	const closes = (line: { text: string }) => matchFenceClose(line.text, fence.marker, fence.length);
	if (lines.slice(1).some(closes)) return raw;
	const closer = fence.indent + fence.marker.repeat(fence.length);
	const ending = trailingLineEnding(node.raw, write.lineEnding);
	return display + ending + closer + ownTrailingLineEnding(raw);
}

// ── Component UI hooks ────────────────────────────────────────────────────────
// `ctx.hooks` is how a command reaches the component; the handlers below cast it back to this
// shape and do nothing when it is missing (kind registered, no block mounted).

export interface MermaidUiHooks {
	openEdit(): void;
	openFocusView(): void;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerMermaidKind(): void {
	const mermaid = declarePluginKind(MERMAID);

	// No default key binding: the button is how you edit, and this command exists so a
	// consumer can bind its own.
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
		label: 'Diagram',
		dragLabel: 'Diagram',
		// Backspace from the block below must never merge text into a diagram.
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Focus first, then delete, as a thematic break does: arrows stop on it, and Backspace
		// from the next block focuses it before a second Backspace deletes it.
		blockFocus: 'whole-block',
		// Leading edge only, for the same reason as a thematic break: pressing Enter while it
		// is focused already inserts a paragraph below.
		gapEdges: 'before',
		container: {
			// Raw is rebuilt from metadata alone, so the strip byte-check is skipped and the
			// reparse and determinism checks cover it instead.
			contract: 'opaque',
			rebuildRaw: rebuildMermaidRaw
		},
		// The character-count default would estimate a rendered diagram at about one line; the
		// measured height replaces this on mount.
		estimateHeight: () => 320,
		normalizeRawWrite: normalizeMermaidRaw,
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
				via: 'raw scans as a leaf, painted via the container shim measurePartialRects; replace reparses the substituted bytes and applies when the kind survives'
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
		// `fencedCode` accepts every fence, ```mermaid included, so this has to be tried
		// before it rather than sit between two built-ins.
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
