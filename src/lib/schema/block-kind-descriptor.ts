import type { BlockKind, CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';

/**
 * A block's merge role classifies its behavior for Backspace-merge purposes.
 * See `docs/design/editor/editor.md` — Structural Operations — for the full role spec.
 *
 * Declared here rather than in `merge-rules.ts` so the descriptor registry
 * can reference it without creating an import cycle.
 */
export type MergeRole = 'prose' | 'prose-absorber' | 'container' | 'self-merge' | 'not-mergeable';

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	isContainer: boolean;
	/** True when the block's raw contains inline syntax the inline parser should process on every edit. */
	supportsInline: boolean;
	/**
	 * Extract the content range (post-marker offsets) from a node's raw. Prose
	 * kinds whose markers occupy a prefix of `raw` implement this to skip
	 * markers; otherwise the default (start=0, end=displayLength) is used.
	 */
	getContentRange?: (node: CstNode) => { start: number; end: number };
	/**
	 * Recompute `raw` from children + container metadata. Container kinds supply
	 * this; leaves omit it. Patched in from `schema/container-raw.ts` at that
	 * file's module load to keep the descriptor cycle-free.
	 */
	rebuildRaw?: (node: CstNode) => void;
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

// Cells have no markers; the entire raw is content.
function tableCellContentRange(node: CstNode): { start: number; end: number } {
	return { start: 0, end: displayLength(node.raw) };
}

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<BlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: BlockKind, descriptor: BlockKindDescriptor): void {
	registry.set(kind, descriptor);
}

/**
 * Merge fields into an existing registration. Used by sibling modules
 * (e.g. container-raw.ts) to patch in behavior that can't live in this file
 * without creating an import cycle. Throws when the kind isn't already
 * registered — no accidental creation via partial data.
 */
export function augmentBlockKind(kind: BlockKind, fields: Partial<BlockKindDescriptor>): void {
	const existing = registry.get(kind);
	if (!existing) {
		throw new Error(
			`augmentBlockKind: cannot augment "${kind}" — no base descriptor. ` +
				`Call registerBlockKind first.`
		);
	}
	registry.set(kind, { ...existing, ...fields });
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

/** Every kind currently registered. Caller must not mutate. */
export function getAllRegisteredKinds(): BlockKind[] {
	return Array.from(registry.keys());
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
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('thematicBreak', {
	mergeRole: 'not-mergeable',
	editable: false,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('indentedCode', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('htmlBlock', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('linkReferenceDefinition', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false
});
registerBlockKind('table', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: true,
	supportsInline: false
});
registerBlockKind('tableRow', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: true,
	supportsInline: false
});
registerBlockKind('tableCell', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: tableCellContentRange
});
registerBlockKind('unrecognized', {
	mergeRole: 'self-merge',
	editable: true,
	isContainer: false,
	supportsInline: false
});
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
