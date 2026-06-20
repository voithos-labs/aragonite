import { isBuiltinBlockKind, metadataOf, type AnyBlockKind, type CstNode } from '../core/nodes';
import { displayLength } from '../core/lines';
import type { KeyBinding } from './keybindings';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from './container-rebuilders';

/**
 * A block's merge role classifies its behavior for Backspace-merge purposes.
 * See `docs/design/editor/editor.md` — Structural Operations — for the full role spec.
 *
 * Declared here rather than in `merge-rules.ts` so the descriptor registry
 * can reference it without creating an import cycle.
 */
export type MergeRole = 'prose' | 'prose-absorber' | 'container' | 'self-merge' | 'not-mergeable';

/**
 * Backspace-at-start behavior for a container's children. Strategy
 * implementations live in editor-actions/unwrap-strategies.ts; the nested
 * blockEdit dispatcher selects by these names. Absent = default (first child
 * delegates upward; middle children follow merge-rules).
 */
export interface UnwrapRole {
	firstChildBackspace: 'lift-first-child' | 'list-item-cascade';
	middleChildBackspace: 'default-merge' | 'list-item-cascade';
}

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	isContainer: boolean;
	/**
	 * Shape of a container's raw↔children relationship (container kinds only).
	 * `'strip'` — `raw` is outer syntax around a strip-and-recurse decomposition,
	 * so `strip(raw) === serialize(children)` holds (blockquote/list/listItem).
	 * `'grid'` — cells parse straight from `raw`, so that invariant does NOT hold
	 * and the container is exempt from the stale-raw check (table/tableRow).
	 */
	containerContract?: 'strip' | 'grid';
	/**
	 * Clipboard-side container paste-merge behavior: how a clipboard whose TOP
	 * block is this kind merges into a same-kind ancestor instead of nesting
	 * as a sub-container. Absent = always nest (default structural path).
	 */
	containerPaste?: {
		/**
		 * Confirms the merge against the candidate ancestor (e.g. equal list
		 * ordered flags). The container-match path resolves a same-kind ancestor
		 * before consulting this; the absorb/break-out path passes the nearest
		 * list ancestor (list-shaped apply — see `siblingAbsorb`).
		 */
		matchesAncestor: (clipboardTop: CstNode, ancestor: CstNode) => boolean;
		/**
		 * Non-empty single-block targets: splice clipboard items as siblings in
		 * the enclosing container when it matches, split it when it doesn't.
		 * The apply path is list-shaped today (marker normalize + renumber) —
		 * only list declares it.
		 */
		siblingAbsorb: boolean;
	};
	/** Backspace-at-start unwrap strategies for this container's children. Absent = default dispatch. */
	unwrapRole?: UnwrapRole;
	/**
	 * Declarative chord -> command map for this kind. Consulted by
	 * dispatchKeyCommand before the editor-global table, so a kind can shadow a
	 * global binding. Absent = only global bindings apply.
	 */
	keymap?: KeyBinding[];
	/** True when the block's raw contains inline syntax the inline parser should process on every edit. */
	supportsInline: boolean;
	/**
	 * Extract the content range (post-marker offsets) from a node's raw. Prose
	 * kinds whose markers occupy a prefix of `raw` implement this to skip
	 * markers; otherwise the default (start=0, end=displayLength) is used.
	 */
	getContentRange?: (node: CstNode) => { start: number; end: number };
	/**
	 * Recompute `raw` from children + container metadata. Container kinds
	 * declare this at registration (implementations in
	 * `schema/container-rebuilders.ts`); leaves omit it.
	 */
	rebuildRaw?: (node: CstNode) => void;
	/** Inline image nodes render as widgets in this kind; opt out (e.g. tableCell) for alt-only fallback. */
	renderImagesAsWidgets?: boolean;
	/**
	 * Translate a foreign drag's viewport point into an internal focus offset
	 * for a block kind with its own coordinate addressing (today only `table`,
	 * whose offset is a row-major cellIdx, not a character index). `blockEl` is
	 * the `[data-block-path]` wrapper; the impl resolves its own internal DOM.
	 * Returns null when the point lands outside an addressable region. Patched
	 * in from `components/built-in-blocks.ts` (top-of-DAG wire-up) so the schema
	 * layer keeps no downstream component import.
	 */
	foreignDragHitTest?: (blockEl: HTMLElement, clientX: number, clientY: number) => number | null;
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

// ── Keymaps ───────────────────────────────────────────────────────────────

// Shared by every kind TextEditableBlock renders — prose (paragraph/heading/
// setextHeading) and the raw-editable fallback (indentedCode/htmlBlock/
// linkReferenceDefinition/unrecognized) — so transformative chords behave
// identically across them. The component's runCommand implements each command.
const TEXT_EDITABLE_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Shift+Enter', command: 'block.hardBreak' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
	{ chord: 'Mod+B', command: 'format.toggleStrong' },
	{ chord: 'Mod+I', command: 'format.toggleEmphasis' },
	{ chord: 'Mod+0', command: 'heading.cycle', arg: 0 },
	{ chord: 'Mod+1', command: 'heading.cycle', arg: 1 },
	{ chord: 'Mod+2', command: 'heading.cycle', arg: 2 },
	{ chord: 'Mod+3', command: 'heading.cycle', arg: 3 },
	{ chord: 'Mod+4', command: 'heading.cycle', arg: 4 },
	{ chord: 'Mod+5', command: 'heading.cycle', arg: 5 },
	{ chord: 'Mod+6', command: 'heading.cycle', arg: 6 }
];

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<AnyBlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: AnyBlockKind, descriptor: BlockKindDescriptor): void {
	if (registry.has(kind)) {
		throw new Error(
			`registerBlockKind: "${kind}" is already registered. Kinds are register-once — ` +
				`use augmentBlockKind to merge fields into an existing registration.`
		);
	}
	registry.set(kind, descriptor);
}

/**
 * Merge fields into an existing registration. Used by top-of-DAG wire-up
 * (components/built-in-blocks.ts) to patch in behavior that can't live in
 * this file without importing downstream layers. Throws when the kind isn't
 * already registered — no accidental creation via partial data.
 */
export function augmentBlockKind(kind: AnyBlockKind, fields: Partial<BlockKindDescriptor>): void {
	const existing = registry.get(kind);
	if (!existing) {
		throw new Error(
			`augmentBlockKind: cannot augment "${kind}" — no base descriptor. ` +
				`Call registerBlockKind first.`
		);
	}
	registry.set(kind, { ...existing, ...fields });
}

export function getBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor {
	const d = registry.get(kind);
	if (!d) {
		throw new Error(
			`getBlockKindDescriptor: no descriptor registered for kind "${kind}". ` +
				`Register at module load (see block-kind-descriptor.ts built-ins).`
		);
	}
	return d;
}

export function tryGetBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined {
	return registry.get(kind);
}

/** Every kind currently registered. Caller must not mutate. */
export function getAllRegisteredKinds(): AnyBlockKind[] {
	return Array.from(registry.keys());
}

/** Test-only. Removes every non-built-in descriptor; built-ins survive. */
export function __removePluginBlockKindsForTests(): void {
	for (const kind of registry.keys()) {
		if (!isBuiltinBlockKind(kind)) registry.delete(kind);
	}
}

// ── Built-in registrations ──────────────────────────────────────────────────

registerBlockKind('paragraph', {
	mergeRole: 'prose',
	editable: true,
	isContainer: false,
	supportsInline: true,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('heading', {
	mergeRole: 'prose-absorber',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: headingContentRange,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('setextHeading', {
	mergeRole: 'prose-absorber',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: setextHeadingContentRange,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('fencedCode', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false,
	keymap: [
		{ chord: 'Enter', command: 'code.newline' },
		{ chord: 'Tab', command: 'code.indent' },
		{ chord: 'Shift+Tab', command: 'code.dedent' },
		{ chord: 'Backspace', command: 'code.backspace' },
		{ chord: 'Delete', command: 'code.delete' },
		{ chord: 'Mod+B', command: 'format.toggleStrong' },
		{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
	]
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
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('htmlBlock', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('linkReferenceDefinition', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('table', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: true,
	containerContract: 'grid',
	rebuildRaw: rebuildTableRaw,
	supportsInline: false
});
registerBlockKind('tableRow', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: true,
	containerContract: 'grid',
	rebuildRaw: rebuildTableRowRaw,
	supportsInline: false
});
registerBlockKind('tableCell', {
	mergeRole: 'not-mergeable',
	editable: true,
	isContainer: false,
	supportsInline: true,
	getContentRange: tableCellContentRange,
	renderImagesAsWidgets: false,
	keymap: [
		{ chord: 'Enter', command: 'cell.enter' },
		{ chord: 'Tab', command: 'cell.tab' },
		{ chord: 'Shift+Tab', command: 'cell.shiftTab' },
		{ chord: 'Mod+B', command: 'format.toggleStrong' },
		{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
	]
});
registerBlockKind('unrecognized', {
	mergeRole: 'self-merge',
	editable: true,
	isContainer: false,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP
});
registerBlockKind('blockquote', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	containerContract: 'strip',
	rebuildRaw: rebuildBlockquoteRaw,
	supportsInline: false,
	containerPaste: { matchesAncestor: () => true, siblingAbsorb: false },
	unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
});
registerBlockKind('list', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	containerContract: 'strip',
	rebuildRaw: rebuildListRaw,
	supportsInline: false,
	containerPaste: {
		matchesAncestor: (top, ancestor) =>
			(metadataOf(top, 'list')?.ordered ?? false) ===
			(metadataOf(ancestor, 'list')?.ordered ?? false),
		siblingAbsorb: true
	},
	unwrapRole: {
		firstChildBackspace: 'list-item-cascade',
		middleChildBackspace: 'list-item-cascade'
	}
});
registerBlockKind('listItem', {
	mergeRole: 'container',
	editable: true,
	isContainer: true,
	containerContract: 'strip',
	rebuildRaw: rebuildListItemRaw,
	supportsInline: false,
	keymap: [
		{ chord: 'Tab', command: 'list.indent' },
		{ chord: 'Shift+Tab', command: 'list.unindent' }
	]
});
