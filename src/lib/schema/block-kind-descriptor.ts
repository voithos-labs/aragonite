import { isBuiltinBlockKind, metadataOf, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { enqueueRegistrationCheck } from './registration-pending';
import { currentInstallingPlugin, pluginKindOwner } from './plugin-install';
import type { ClosureBlock } from './closure';
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
 * See `docs/design/editor.md` — Merge eligibility: roles, not pairs — for the full role spec.
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
	/**
	 * The kind's answer to every cross-cutting editor system — the closure matrix
	 * row as a required field, so a kind cannot ship closed under a subsystem
	 * nobody asked about. `Record<ClosureColumn, …>` makes a missing column a
	 * compile error; requiring the field makes a missing block one. Read-side and
	 * flat (all kinds, not container-only), so it survives `stripContainerOnlyKeys`.
	 */
	closure: ClosureBlock;
	/**
	 * A small markdown source that parses to a tree containing this kind — consumed
	 * by the conformance battery. Present for parser-reachable kinds; omitted for
	 * context-dependent kinds (chrome, tableCell) and reserved `unrecognized`, which
	 * a document scan can never yield in isolation. G1.24 checks that a declared
	 * fixture actually parses to the kind; it does not demand one exist.
	 */
	conformanceFixture?: string;
	/**
	 * Editor-level whole-block focus policy for an opaque, childless block (e.g. a
	 * render-primary plugin diagram). `'whole-block'` opts the kind into the
	 * ThematicBreak-style focus-then-delete model: arrow traversal stops on it, a
	 * caret-adjacent Backspace/Delete focuses it before a second press deletes, and
	 * the merge-fallback twins focus it instead of deleting or no-oping. Absent =
	 * the block is not an editor-level focus target on its own. Closed vocabulary —
	 * a plugin may not invent values. Leaf-level, so it survives `stripContainerOnlyKeys`.
	 */
	blockFocus?: 'whole-block';
	isContainer: boolean;
	/**
	 * Shape of a container's raw↔children relationship (container kinds only).
	 * `'strip'` — `raw` is outer syntax around a strip-and-recurse decomposition,
	 * so `strip(raw) === serialize(children)` (blockquote/list/listItem).
	 * `'grid'` — cells parse straight from `raw`; the invariant does NOT hold and
	 * the container is coordinate-addressed (table/tableRow).
	 * `'opaque'` — `raw` is authoritative and not a strip-decomposition (chrome
	 * lives in the container's own raw, e.g. a title in the opener line); exempt
	 * from the stale-raw byte-check like `'grid'`, but NOT coordinate-addressed.
	 * Its `rebuildRaw` must be deterministic over children/metadata/inner trivia —
	 * a DEV probe re-runs it twice and compares the outputs (never against `raw`,
	 * which a faithful non-canonical parse legally differs from); a separate DEV
	 * check reparses `raw` to catch children mutated without a rebuild.
	 */
	containerContract?: 'strip' | 'grid' | 'opaque';
	/**
	 * True when the kind has no standalone line recognizer, so `parse(raw)` would
	 * NOT reproduce it (tableCell → paragraph; plugin chrome → paragraph). Its
	 * container's rebuildRaw owns the surrounding syntax; a content edit keeps the
	 * kind and just writes `raw`, instead of re-deriving kind and downgrading it.
	 */
	contextDependentKind?: boolean;
	/**
	 * Declares child index 0 of this container as a reserved chrome leaf of the
	 * given kind (a title/summary whose bytes live in the container's own raw —
	 * e.g. the callout opener line). The machinery enforces: always present,
	 * single-line, cleared-not-deleted by range ops, kind-stable. The chrome kind
	 * itself is registered via registerChromeLeaf.
	 */
	reservedChrome?: {
		kind: AnyBlockKind;
		/**
		 * How the machinery reads this container's collapsed state — a PURE model
		 * probe (node in, bool out; no DOM, no component state). Absent = never
		 * collapsed. Collapse-aware walks (e.g. the Backspace merge walker) stop
		 * at the chrome leaf instead of reaching into the clamped-out body.
		 */
		isCollapsed?: (node: NodeView) => boolean;
	};
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
	getContentRange?: (node: NodeView) => { start: number; end: number };
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
	/** O(1) content-height estimate in px for virtual rendering — no subtree walk.
	 *  The oracle adds block chrome; the measured cache still supersedes. */
	estimateHeight?: (node: NodeView, env: { width: number }) => number;
}

/**
 * Container-only fields, registered as one unit. `contract` and `rebuildRaw`
 * are required together, and a leaf has no way to carry any of these — the
 * pairing violation the retired G1.3 bootstrap guard watched for is now
 * unrepresentable. Field semantics live on `BlockKindDescriptor`, the flat
 * read-side shape the group normalizes into.
 */
export interface ContainerDescriptorGroup {
	contract: 'strip' | 'grid' | 'opaque';
	rebuildRaw: (node: CstNode) => void;
	reservedChrome?: BlockKindDescriptor['reservedChrome'];
	containerPaste?: BlockKindDescriptor['containerPaste'];
	unwrapRole?: UnwrapRole;
}

// One source for both the type-level Omit and the runtime strip: excess-property
// checks bite only fresh literals, so a widened value (e.g. a flat descriptor
// passed as a registration) can structurally smuggle these keys past the types.
const CONTAINER_ONLY_KEYS = [
	'isContainer',
	'containerContract',
	'rebuildRaw',
	'reservedChrome',
	'containerPaste',
	'unwrapRole'
] as const;
type ContainerOnlyKey = (typeof CONTAINER_ONLY_KEYS)[number];

function stripContainerOnlyKeys<T extends object>(fields: T): Omit<T, ContainerOnlyKey> {
	const stripped = { ...fields } as Record<string, unknown>;
	for (const key of CONTAINER_ONLY_KEYS) delete stripped[key];
	return stripped as Omit<T, ContainerOnlyKey>;
}

/**
 * The write-side shape `registerBlockKind` accepts. `isContainer` is derived
 * (`container !== undefined`), never declared.
 */
export interface BlockKindRegistration extends Omit<BlockKindDescriptor, ContainerOnlyKey> {
	container?: ContainerDescriptorGroup;
}

/**
 * The augment shape: top-level fields replace; a partial `container` group
 * merges into the existing group — and is refused outright for a kind
 * registered as a leaf.
 */
export type BlockKindAugmentation = Partial<Omit<BlockKindRegistration, 'container'>> & {
	container?: Partial<ContainerDescriptorGroup>;
};

// ── Content-range helpers (used by built-in registrations) ─────────────────

// Headings carry a `# ` prefix that is not part of the editable text.
function headingContentRange(node: NodeView): { start: number; end: number } {
	const raw = node.raw;
	const displayEnd = displayLength(raw);
	let i = 0;
	while (i < raw.length && raw[i] === ' ') i++;
	while (i < raw.length && raw[i] === '#') i++;
	if (i < raw.length && raw[i] === ' ') i++;
	return { start: i, end: displayEnd };
}

// Setext headings carry a trailing underline line that is structural, not content.
function setextHeadingContentRange(node: NodeView): { start: number; end: number } {
	const raw = node.raw;
	const end = displayLength(raw);
	const underlineStart = raw.lastIndexOf('\n', end - 1);
	if (underlineStart === -1) return { start: 0, end };
	let contentEnd = underlineStart;
	if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
	return { start: 0, end: contentEnd };
}

// Cells have no markers; the entire raw is content.
function tableCellContentRange(node: NodeView): { start: number; end: number } {
	return { start: 0, end: displayLength(node.raw) };
}

// ── Keymaps ───────────────────────────────────────────────────────────────

// Shared by every kind TextEditableBlock renders — prose and the raw-editable
// fallback alike — so transformative chords behave identically across them. The
// component's runCommand implements each command.
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

// ── Closure blocks ────────────────────────────────────────────────────────────

// Shared by the not-mergeable, non-inline raw-text leaves (indentedCode,
// htmlBlock, linkReferenceDefinition) — byte-identical rows, hoisted rather than
// triplicated. fencedCode and unrecognized diverge (own keymap / self-merge), so
// they stay inline.
const RAW_TEXT_LEAF_CLOSURE: ClosureBlock = {
	roundTrip: { mode: 'inherit-default' },
	focus: { mode: 'implemented', via: 'native caret in the raw-editable contenteditable' },
	mergeBackspace: {
		mode: 'implemented',
		via: 'mergeRole=not-mergeable — Backspace moves focus, never concatenates'
	},
	selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
	searchPaint: { mode: 'implemented', via: 'raw scanned; matches painted as decoration marks' },
	reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
	undo: { mode: 'inherit-default' },
	clipboard: { mode: 'inherit-default' },
	simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
};

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<AnyBlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: AnyBlockKind, registration: BlockKindRegistration): void {
	if (registry.has(kind)) {
		const owner = pluginKindOwner(kind);
		throw new Error(
			`registerBlockKind: "${kind}" is already registered. Kinds are register-once — ` +
				`use augmentBlockKind to merge fields into an existing registration.` +
				(owner ? ` — first declared by plugin '${owner}'` : '')
		);
	}
	registry.set(kind, normalizeRegistration(registration));
	enqueueRegistrationCheck(kind);
}

// The flat part is stripped of container-only keys (see CONTAINER_ONLY_KEYS)
// and isContainer is derived, so the `container` group is the only source of
// container fields — a widened or stale-keyed registration object cannot leak.
function normalizeRegistration(registration: BlockKindRegistration): BlockKindDescriptor {
	const { container, ...rest } = registration;
	const flat = stripContainerOnlyKeys(rest);
	if (!container) return { ...flat, isContainer: false };
	const { contract, ...containerFields } = container;
	return { ...flat, ...containerFields, isContainer: true, containerContract: contract };
}

// Merge fields into an existing registration; throw if the kind was never
// registered (no accidental creation via partial data). The built-in-vs-plugin
// gate lives in the two public entries below, not here — the leaf/container
// gate lives here so both entries inherit it.
function mergeBlockKindFields(
	entry: string,
	kind: AnyBlockKind,
	fields: BlockKindAugmentation
): void {
	const existing = registry.get(kind);
	if (!existing) {
		throw new Error(
			`${entry}: cannot augment "${kind}" — no base descriptor. Call registerBlockKind first.`
		);
	}
	const { container, ...rest } = fields;
	const next: BlockKindDescriptor = { ...existing, ...stripContainerOnlyKeys(rest) };
	if (container) {
		if (!existing.isContainer) {
			throw new Error(
				`${entry}: cannot augment "${kind}" with container fields — it was registered as a leaf`
			);
		}
		// Merge, never unset: `??` keeps an explicitly-undefined group field from
		// breaking the contract/rebuild pairing the registration shape guarantees.
		next.containerContract = container.contract ?? existing.containerContract;
		next.rebuildRaw = container.rebuildRaw ?? existing.rebuildRaw;
		next.reservedChrome = container.reservedChrome ?? existing.reservedChrome;
		next.containerPaste = container.containerPaste ?? existing.containerPaste;
		next.unwrapRole = container.unwrapRole ?? existing.unwrapRole;
	}
	registry.set(kind, next);
	enqueueRegistrationCheck(kind);
}

/**
 * Merge fields into a plugin's own registration. The public authoring entry.
 * Rejects built-in kinds — a plugin augmenting a built-in silently rewrote its
 * descriptor process-globally; built-in wire-up uses the internal augmentBuiltin
 * seam. Rejects a kind owned by a DIFFERENT plugin for the same reason: the
 * ownership recorded at `declarePluginKind` gates augmentation to the declaring
 * plugin's own setup, so cross-plugin last-writer-wins is a loud throw, not a
 * silent override. A kind with no recorded owner (declared outside any plugin
 * install — the test/harness path) stays open. Also throws when the kind isn't
 * already registered.
 */
export function augmentBlockKind(kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	if (isBuiltinBlockKind(kind)) {
		throw new Error(
			`augmentBlockKind: "${kind}" is a built-in kind — the plugin surface may only augment ` +
				`plugin-declared kinds.`
		);
	}
	const owner = pluginKindOwner(kind);
	const installer = currentInstallingPlugin();
	if (owner !== null && owner !== installer) {
		throw new Error(
			`augmentBlockKind: "${kind}" is owned by plugin '${owner}' — ` +
				(installer
					? `plugin '${installer}' may not augment another plugin's kind.`
					: `only plugin '${owner}' may augment its own kind, from its setup.`)
		);
	}
	mergeBlockKindFields('augmentBlockKind', kind, fields);
}

/**
 * Internal seam for augmenting a BUILT-IN descriptor. Top-of-DAG wire-up
 * (components/built-in-blocks.ts) patches in behavior that can't live in this
 * file without importing downstream layers. Deliberately kept off the public
 * `aragonite/plugin` surface so a plugin can't rewrite a built-in.
 */
export function augmentBuiltin(kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	mergeBlockKindFields('augmentBuiltin', kind, fields);
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

/**
 * Probe by name whether a kind descriptor exists. `registerBlockKind` throws on
 * duplicate, so a plugin registering idempotently (HMR / re-import) guards on
 * this. Accepts a plain name so callers needn't pre-brand an unminted kind.
 */
export function isBlockKindRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
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
	supportsInline: true,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: 'hello world\n',
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=prose — Backspace merges into the previous prose block'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'measurePartialRects (raw offsets, per visual line)'
		},
		searchPaint: { mode: 'implemented', via: 'prose raw scanned; matches painted as marks' },
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap; resolveReorderUnit' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	}
});
registerBlockKind('heading', {
	mergeRole: 'prose-absorber',
	editable: true,
	supportsInline: true,
	getContentRange: headingContentRange,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: '# Heading\n',
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=prose-absorber — absorbs the following prose block'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'measurePartialRects (content range, marker skipped)'
		},
		searchPaint: {
			mode: 'implemented',
			via: 'content-range raw scanned; marks (marker prefix skipped)'
		},
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	}
});
registerBlockKind('setextHeading', {
	mergeRole: 'prose-absorber',
	editable: true,
	supportsInline: true,
	getContentRange: setextHeadingContentRange,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: 'Title\n===\n',
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=prose-absorber — absorbs the following prose block'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'measurePartialRects (content range, underline skipped)'
		},
		searchPaint: {
			mode: 'implemented',
			via: 'content-range raw scanned; marks (underline line skipped)'
		},
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	}
});
registerBlockKind('fencedCode', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	keymap: [
		{ chord: 'Enter', command: 'code.newline' },
		{ chord: 'Tab', command: 'code.indent' },
		{ chord: 'Shift+Tab', command: 'code.dedent' },
		{ chord: 'Backspace', command: 'code.backspace' },
		{ chord: 'Delete', command: 'code.delete' },
		{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
		{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
		{ chord: 'Mod+B', command: 'format.toggleStrong' },
		{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
	],
	conformanceFixture: '```\ncode\n```\n',
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the code contenteditable' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'not-mergeable — code.backspace edits within; no cross-block concat'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'measurePartialRects (raw offsets, per visual line)'
		},
		searchPaint: { mode: 'implemented', via: 'code raw scanned; matches painted as marks' },
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	}
});
registerBlockKind('thematicBreak', {
	mergeRole: 'not-mergeable',
	editable: false,
	supportsInline: false,
	keymap: [
		{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
		{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
	],
	conformanceFixture: '---\n',
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: {
			mode: 'implemented',
			via: 'ThematicBreakBlock whole-block focus (focus-then-delete model)'
		},
		mergeBackspace: {
			mode: 'implemented',
			via: 'not-mergeable — caret-adjacent Backspace focuses, a second press deletes'
		},
		selectionPaint: { mode: 'implemented', via: 'whole-block cover rect (no partial offsets)' },
		searchPaint: { mode: 'not-supported', reason: 'no editable text content — nothing to search' },
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	}
});
registerBlockKind('indentedCode', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: '    indented code\n',
	closure: RAW_TEXT_LEAF_CLOSURE
});
registerBlockKind('htmlBlock', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: '<div>\nhtml\n</div>\n',
	closure: RAW_TEXT_LEAF_CLOSURE
});
registerBlockKind('linkReferenceDefinition', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP,
	conformanceFixture: '[id]: /url "title"\n',
	closure: RAW_TEXT_LEAF_CLOSURE
});
registerBlockKind('table', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	container: { contract: 'grid', rebuildRaw: rebuildTableRaw },
	conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n',
	closure: {
		roundTrip: { mode: 'implemented', via: 'container contract=grid — rebuildTableRaw' },
		focus: { mode: 'implemented', via: 'focus walks into the first cell' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'not-mergeable — no block merge; edits stay within cells'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'rectangular cell selection; per-cell cover rects'
		},
		searchPaint: {
			mode: 'implemented',
			via: 'descends to cells; per-cell mark overlay (measurePartialRects cell index)'
		},
		reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
		undo: { mode: 'inherit-default' },
		clipboard: {
			mode: 'implemented',
			via: 'rectangular multi-cell copy → synthesized GFM sub-table, not a byte slice (copyRectangleAsSubTable, cell index)'
		},
		simOracle: { mode: 'implemented', via: 'note-taking simulation drives table cell edits' }
	}
});
registerBlockKind('tableRow', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: false,
	container: { contract: 'grid', rebuildRaw: rebuildTableRowRaw },
	conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n',
	closure: {
		roundTrip: { mode: 'implemented', via: 'container contract=grid — rebuildTableRowRaw' },
		focus: { mode: 'implemented', via: 'focus walks into a cell' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'not-mergeable — no row-level merge; cell edits only'
		},
		selectionPaint: { mode: 'implemented', via: 'per-cell cover rects' },
		searchPaint: { mode: 'implemented', via: 'descends to cells; per-cell mark overlay' },
		reorder: {
			mode: 'not-supported',
			reason:
				'grid child — not a block-level reorder unit; whole rows move via a row-drag gesture inside the table grid, not the BlockList'
		},
		undo: { mode: 'inherit-default' },
		// inherit-default, not implemented like table/tableCell: no clipboard path
		// anchors on a row node — the rectangular sub-table copy reads the table,
		// the copy/cut handlers live on the cell. The row paints per-cell but is
		// never a copy source, so selectionPaint: implemented does not extend here.
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation (table edits)' }
	}
});
registerBlockKind('tableCell', {
	mergeRole: 'not-mergeable',
	editable: true,
	supportsInline: true,
	contextDependentKind: true,
	getContentRange: tableCellContentRange,
	renderImagesAsWidgets: false,
	keymap: [
		{ chord: 'Enter', command: 'cell.enter' },
		{ chord: 'Tab', command: 'cell.tab' },
		{ chord: 'Shift+Tab', command: 'cell.shiftTab' },
		{ chord: 'Mod+B', command: 'format.toggleStrong' },
		{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
	],
	// No conformanceFixture: context-dependent — the table opener mints cells, so a
	// cell never stands alone as the top-level result of a document scan.
	closure: {
		roundTrip: {
			mode: 'implemented',
			via: 'contextDependentKind — the parent grid rebuildTableRaw owns the cell bytes'
		},
		focus: { mode: 'implemented', via: 'per-cell native caret' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'not-mergeable — edits stay within the cell; no cross-cell concat'
		},
		selectionPaint: { mode: 'implemented', via: 'measurePartialRects (cell index)' },
		searchPaint: {
			mode: 'implemented',
			via: 'cell raw scanned; per-cell mark overlay (measurePartialRects cell index)'
		},
		reorder: {
			mode: 'not-supported',
			reason:
				'grid cell — not a block-level reorder unit; row/column drag gestures inside the table grid move whole rows or columns, not individual cells'
		},
		undo: { mode: 'inherit-default' },
		clipboard: {
			mode: 'implemented',
			via: 'copy/cut synthesize a GFM sub-table for the selected rectangle (intraTableRectPayload → copyRectangleAsSubTable, cell index)'
		},
		simOracle: { mode: 'implemented', via: 'note-taking simulation (table cell edits)' }
	}
});
registerBlockKind('unrecognized', {
	mergeRole: 'self-merge',
	editable: true,
	supportsInline: false,
	keymap: TEXT_EDITABLE_KEYMAP,
	// No conformanceFixture: a document scan never yields `unrecognized` in
	// isolation — it is the reserved fallback for content no opener claimed.
	closure: {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the raw-editable contenteditable' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=self-merge — concatenates with an adjacent unrecognized block'
		},
		selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
		searchPaint: { mode: 'implemented', via: 'raw scanned; matches painted as marks' },
		reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'inherit-default' }
	}
});
registerBlockKind('blockquote', {
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	container: {
		contract: 'strip',
		rebuildRaw: rebuildBlockquoteRaw,
		containerPaste: { matchesAncestor: () => true, siblingAbsorb: false },
		unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
	},
	conformanceFixture: '> quoted\n',
	closure: {
		roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildBlockquoteRaw' },
		focus: { mode: 'implemented', via: 'focus walks into the first child' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=container + unwrapRole (lift-first-child; default-merge)'
		},
		selectionPaint: {
			mode: 'implemented',
			via: 'real child blocks paint; container cover spans them'
		},
		searchPaint: {
			mode: 'implemented',
			via: 'children are real blocks — search descends and paints'
		},
		reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
		undo: { mode: 'inherit-default' },
		clipboard: {
			mode: 'implemented',
			via: 'containerPaste.matchesAncestor — clipboard top merges into a same-kind ancestor'
		},
		simOracle: { mode: 'implemented', via: 'note-taking simulation (nested blockquote edits)' }
	}
});
registerBlockKind('list', {
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	container: {
		contract: 'strip',
		rebuildRaw: rebuildListRaw,
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
	},
	conformanceFixture: '- item\n',
	closure: {
		roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildListRaw' },
		focus: { mode: 'implemented', via: 'focus walks into the first item' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=container + unwrapRole (list-item-cascade)'
		},
		selectionPaint: { mode: 'implemented', via: 'item child blocks paint; container cover' },
		searchPaint: { mode: 'implemented', via: 'descends into items — mark overlay per child' },
		reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
		undo: { mode: 'inherit-default' },
		clipboard: {
			mode: 'implemented',
			via: 'containerPaste.siblingAbsorb — clipboard items splice as siblings, ordered-flag matched'
		},
		simOracle: { mode: 'implemented', via: 'note-taking simulation (list edits)' }
	}
});
registerBlockKind('listItem', {
	mergeRole: 'container',
	editable: true,
	supportsInline: false,
	container: { contract: 'strip', rebuildRaw: rebuildListItemRaw },
	keymap: [
		{ chord: 'Tab', command: 'list.indent' },
		{ chord: 'Shift+Tab', command: 'list.unindent' }
	],
	conformanceFixture: '- item\n',
	closure: {
		roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildListItemRaw' },
		focus: { mode: 'implemented', via: 'focus walks into the first child' },
		mergeBackspace: {
			mode: 'implemented',
			via: 'mergeRole=container — Backspace cascades via the parent list unwrapRole'
		},
		selectionPaint: { mode: 'implemented', via: 'child blocks paint; item cover' },
		searchPaint: { mode: 'implemented', via: 'descends into item children — mark overlay' },
		reorder: {
			mode: 'implemented',
			via: 'list.indent/unindent keymap; whole-item reorder through the parent list'
		},
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation (list item edits)' }
	}
});
