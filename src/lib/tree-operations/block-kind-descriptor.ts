/**
 * Per-kind descriptor registry. Consolidates merge role, editability,
 * container-ness, and inline-parsing capability. Built-in kinds register at
 * module load; adding a new kind requires one `registerBlockKind` call.
 */

import type { BlockKind, CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';

/**
 * A block's merge role classifies its behavior for Backspace-merge purposes.
 *
 *   prose           — leaf text block that can merge with or absorb other prose
 *   prose-absorber  — prose leaf that retains its kind when absorbing prose
 *                     (e.g. heading stays a heading)
 *   container       — block whose merge target is its deepest reachable prose leaf
 *   self-merge      — merges only with another block of the same role
 *   opaque          — not mergeable; Backspace either deletes (if non-editable)
 *                     or moves focus
 *
 * Declared here rather than in `merge-rules.ts` so the descriptor registry
 * can reference it without creating an import cycle.
 */
export type MergeRole = 'prose' | 'prose-absorber' | 'container' | 'self-merge' | 'opaque';

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	isContainer: boolean;
	/**
	 * True when the block's raw contains inline syntax that the inline parser
	 * should process on every edit. Drives isProseKind — callers outside this
	 * registry should not hardcode a kind list. False for non-prose leaves
	 * (fencedCode, thematicBreak, etc.) and containers (which delegate inline
	 * parsing to their children).
	 */
	supportsInline: boolean;
	/**
	 * Extract the content range (post-marker offsets) from a node's raw. Prose
	 * kinds whose markers occupy a prefix of `raw` implement this to skip
	 * markers. Paragraphs use the default (start=0, end=displayLength). When
	 * absent, the default is used.
	 */
	getContentRange?: (node: CstNode) => { start: number; end: number };
}

// ── Content-range helpers (used by built-in registrations) ─────────────────

// Headings carry a `# ` prefix that is not part of the editable text.
function headingContentRange(node: CstNode): { start: number; end: number } {
	const raw = node.raw;
	const displayEnd = displayLength(raw);
	let i = 0;
	while (i < raw.length && raw[i] === ' ') i++;
	while (i < raw.length && raw[i] === '#') i++;
	if (i < raw.length && raw[i] === ' ') i++;
	return { start: i, end: displayEnd };
}

// Setext headings carry a trailing underline line that is structural, not content.
function setextHeadingContentRange(node: CstNode): { start: number; end: number } {
	const raw = node.raw;
	const end = displayLength(raw);
	const underlineStart = raw.lastIndexOf('\n', end - 1);
	if (underlineStart === -1) return { start: 0, end };
	let contentEnd = underlineStart;
	if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
	return { start: 0, end: contentEnd };
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<BlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: BlockKind, descriptor: BlockKindDescriptor): void {
	registry.set(kind, descriptor);
}

export function getBlockKindDescriptor(kind: BlockKind): BlockKindDescriptor {
	const d = registry.get(kind);
	if (!d) {
		throw new Error(
			`getBlockKindDescriptor: no descriptor registered for kind "${kind}". ` +
				`Register at module load (see block-kind-descriptor.ts built-ins).`
		);
	}
	return d;
}

export function tryGetBlockKindDescriptor(kind: BlockKind): BlockKindDescriptor | undefined {
	return registry.get(kind);
}

// ── Built-in registrations ──────────────────────────────────────────────────

registerBlockKind('paragraph', {
	mergeRole: 'prose',
	editable: true,
	isContainer: false,
	supportsInline: true
});
registerBlockKind('heading', {
	mergeRole: 'prose-absorber',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: headingContentRange
});
registerBlockKind('setextHeading', {
	mergeRole: 'prose-absorber',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: setextHeadingContentRange
});
registerBlockKind('fencedCode', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('thematicBreak', {
	mergeRole: 'opaque',
	editable: false,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('indentedCode', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('htmlBlock', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('linkReferenceDefinition', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('table', {
	mergeRole: 'opaque',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('unrecognized', {
	mergeRole: 'self-merge',
	editable: true,
	isContainer: false,
	supportsInline: false
});
// Containers delegate inline parsing to their children — they do not hold inline content directly.
registerBlockKind('blockquote', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	supportsInline: false
});
registerBlockKind('list', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	supportsInline: false
});
registerBlockKind('listItem', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	supportsInline: false
});
