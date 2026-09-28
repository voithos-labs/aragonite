import { isBuiltinBlockKind, metadataOf, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { DocumentView, NodeView } from '../core/node-views';
import type { LineEnding } from '../core/lines';
import type { ContainerBodyWrap } from '../core/parser';
import { enqueueRegistrationCheck } from './registration-pending';
import { currentInstallingPlugin } from './plugin-install';
import { pluginKindOwner } from './plugin-kind';
import { createPluginRegistry } from './plugin-registry';
import type { ChildRawChange } from './child-spans';
import type { ClosureBlock } from './closure';
import { registeredChord, type KeyBinding } from './keybindings';
import type { HeightEstimateEnv } from './height-estimates';
import { rejectIncoherentPairs } from './registration-pairs';

/**
 * The Backspace-merge roles (`docs/design/editor.md` § Merge eligibility: roles, not pairs).
 * The runtime role check reads its list from this tuple, so the type and the check agree (G1.30).
 */
export const MERGE_ROLES = [
	'prose',
	'prose-absorber',
	'container',
	'self-merge',
	'not-mergeable'
] as const;

export type MergeRole = (typeof MERGE_ROLES)[number];

/** Catches a role the `MergeRole` type cannot, one that arrived through a cast (G1.30). */
export const isKnownMergeRole = (role: string): boolean =>
	(MERGE_ROLES as readonly string[]).includes(role);

/**
 * How Backspace at the start of a container's child releases it, as a registration declares it;
 * strategies live in `editor-actions/unwrap-strategies.ts`. Absent, on a container with no title
 * row: child 0 hands the Backspace to the parent, and later children follow merge-rules.
 */
export interface ContainerUnwrapRole {
	firstChildBackspace:
		'lift-first-child-drop-opener' | 'lift-first-child-keep-container' | 'list-item-cascade';
	middleChildBackspace: 'default-merge' | 'list-item-cascade';
}

/** The unwrap role the editor reads back: a container with a title row keeps child 0 in place. */
export interface UnwrapRole {
	firstChildBackspace: ContainerUnwrapRole['firstChildBackspace'] | 'keep-reserved-chrome';
	middleChildBackspace: ContainerUnwrapRole['middleChildBackspace'];
}

/**
 * A container whose direct children reorder among themselves (Alt+Arrow, the drag handle). The
 * reorder resolves its unit at the nearest ancestor declaring this; absent means the children
 * are not independently reorderable, and the container declines the reorder at its boundary.
 */
export interface ReorderChildrenRole {
	/**
	 * Direct children carry position-dependent markers needing a renumber after a permutation
	 * (ordered-list numbering). Absent = position-independent, so `rebuildRaw` alone re-emits.
	 */
	renumberMarkers?: true;
}

/**
 * A caret position in a kind's own addressing: the child path `focusByPath` follows (empty for a
 * leaf, which is its own target) and the offset within the leaf it names. `CURSOR_END` is a legal
 * offset here, and the one way to say "wherever that leaf ends".
 */
export interface CaretTarget {
	path: number[];
	offset: number;
}

/**
 * `authored` when the user is typing in the block, so bytes may be the block's own syntax half
 * written; `literal` for content that arrives whole (a paste, a replace, a range delete).
 */
export type WriteMode = 'authored' | 'literal';

/** What a write rule reads besides the bytes. */
export interface WriteContext {
	/** The block whose bytes are written: the kind's own node, or for a body write its container. */
	node: NodeView;
	mode: WriteMode;
	/** The document's line ending, which a line the rule writes takes when the block has none. */
	lineEnding: LineEnding;
}

/**
 * How a kind makes written bytes legal: `normalize` repairs them, and `mapOffset` says where an
 * offset into the written bytes lands in the repaired ones. `normalize` must be idempotent.
 */
export interface WriteRule {
	normalize(raw: string, ctx: WriteContext): string;
	mapOffset(raw: string, offset: number, ctx: WriteContext): number;
}

/**
 * Child 0 is a title row of this kind, its bytes in the container's raw: always present, one
 * line, cleared rather than deleted, never rekinded. Register it with `registerChromeLeaf`. No
 * container metadata may come from the row's bytes, so typing in it re-reads none.
 */
export interface ReservedChrome {
	kind: AnyBlockKind;
	/**
	 * A pure check of the collapsed state (node in, boolean out; no DOM, no component state).
	 * Collapse-aware traversals stop at the title row rather than reach into the hidden body.
	 */
	isCollapsed?: (node: NodeView) => boolean;
	/**
	 * The metadata patch that expands a collapsed node, so focusing a hidden body child opens
	 * it. Null or absent: no way to expand, and focus goes to the title row.
	 */
	expandPatch?: (node: NodeView) => Record<string, unknown> | null;
}

/**
 * How a clipboard whose top block is this kind merges into a same-kind ancestor instead of
 * nesting as a sub-container. Absent means always nest.
 */
export interface ContainerPaste {
	/** Confirms the merge against the candidate ancestor (e.g. equal list ordered flags). */
	matchesAncestor: (clipboardTop: CstNode, ancestor: CstNode) => boolean;
	/**
	 * Pasting into a non-empty single block: splice the clipboard items as siblings into the
	 * enclosing container when it matches, split it when it does not (the list paste shape).
	 */
	siblingAbsorb: boolean;
}

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	/**
	 * The kind's row in the closure matrix: its answer for every cross-cutting editor system.
	 * Required, so a kind cannot ship without answering for a subsystem nobody asked about.
	 */
	closure: ClosureBlock;
	/**
	 * The block's name, to a screen reader and in the block menu ("Diagram"). Omitted, the kind
	 * name in words stands in. Built-in kinds are named in `a11y-strings.ts`, not here.
	 */
	label?: string;
	/**
	 * Markdown that parses to a tree holding this kind, for the conformance suite. Omit it for a
	 * kind no document parse yields alone; only a declared fixture is checked (G1.24).
	 */
	conformanceFixture?: string;
	/**
	 * `'whole-block'` opts an opaque, childless block into the focus-then-delete model: arrow
	 * traversal stops on it, and Backspace/Delete focuses it before a second keypress deletes.
	 */
	blockFocus?: 'whole-block';
	/**
	 * Edges where this kind's own editing cannot insert a sibling paragraph, so the boundary gets a
	 * gap caret (`selection/gap-caret.ts`). `'none'`: the block or a control covers both edges.
	 */
	gapEdges: 'before' | 'after' | 'both' | 'none';
	isContainer: boolean;
	/**
	 * How `raw` relates to the children: `docs/design/syntax-tree.md` § The container contract.
	 * A grid's cell index is `row * width + column`, every row as wide as row 0.
	 */
	containerContract?: 'strip' | 'grid' | 'opaque';
	/**
	 * For a body between the container's own marker lines (a fence, an HTML tag), whose parse gives
	 * each marker's neighbouring blank line to `innerPrefix`/`innerSuffix`. Absent: body on line one.
	 */
	bodyWrap?: ContainerBodyWrap;
	/**
	 * The kind has no opener of its own, so `parse(raw)` would not reproduce it: its container's
	 * `rebuildRaw` owns the syntax, and a content edit writes `raw` without reparsing the kind.
	 */
	contextDependentKind?: boolean;
	/**
	 * The kind can take the lines right below it as its own (a link definition's title, an HTML
	 * block's body), so a write here or just below asks whether the two blocks now read as one.
	 */
	readsFollowingLines?: true;
	/**
	 * Make `raw` legal as this kind's own bytes (`schema/fenced-code-raw.ts` is the worked example).
	 * `ctx.node` is the block as it stood before the write.
	 */
	rawWrite?: WriteRule;
	/**
	 * Make text legal as a child's raw in this container's body, before the reparse, for a container
	 * whose closing line (`</details>`) a body write could reproduce. `ctx.node` is the container.
	 */
	bodyWrite?: WriteRule;
	reservedChrome?: ReservedChrome;
	containerPaste?: ContainerPaste;
	unwrapRole?: UnwrapRole;
	/**
	 * Takes the first space typed at a child's content start while its marker lacks one. `rebuildRaw`
	 * must restore the marker's trailing space, or the taken space never appears.
	 */
	contentStartSpace?: 'complete-marker';
	/** This container's direct children reorder among themselves. Absent means they do not. */
	reorderChildren?: ReorderChildrenRole;
	/** Chord -> command map, consulted before the global table so a kind can shadow a global.
	 *  Registration throws on a malformed chord and stores the rest normalized. */
	keymap?: KeyBinding[];
	/** True when the block's raw contains inline syntax the inline parser should process on every edit. */
	supportsInline: boolean;
	/** The registration's `contentStart.range`. Absent = the default `start=0, end=displayLength`. */
	getContentRange?: ContentStart['range'];
	/** The registration's `contentStart.backspace`. */
	contentStartBackspace?: ContentStart['backspace'];
	/**
	 * Recompute `raw` from children and metadata. `changed` names the one child whose raw moved, for
	 * a rebuilder that rewrites only its region; ignoring it is always correct.
	 */
	rebuildRaw?: (node: CstNode, changed?: ChildRawChange) => void;
	/** Inline image nodes render as widgets in this kind; opt out (e.g. tableCell) for alt-only fallback. */
	renderImagesAsWidgets?: boolean;
	/**
	 * A foreign drag's viewport point as an offset in the kind's own addressing, or null outside it.
	 * Added from `components/built-in-blocks.ts`, so schema keeps no component import.
	 */
	foreignDragHitTest?: (blockEl: HTMLElement, clientX: number, clientY: number) => number | null;
	/**
	 * A point in the block's box as a caret position in the kind's own addressing. Unlike
	 * {@link foreignDragHitTest} it answers every point, snapping to the nearest leaf.
	 */
	caretTargetAtPoint?: (
		blockEl: HTMLElement,
		clientX: number,
		clientY: number
	) => CaretTarget | null;
	/**
	 * O(1) content height in px for windowing, frame excluded; a measured height still wins.
	 * `height-estimates.ts` has the common shapes. Absent: the container or prose estimate.
	 */
	estimateHeight?: (node: NodeView, env: HeightEstimateEnv) => number;

	// ── Presentation ──────────────────────────────────────────────────────────

	/**
	 * `'prose'` is text the user writes in: no drag handle, and a right-click opens clipboard rows.
	 * `'object'`, the default, is picked up whole, with a handle and a block menu.
	 */
	pageRole?: 'prose' | 'object';
	/** What the drag ghost calls the block, for one whose text reads badly as a label (a formula's
	 *  source). Absent, the ghost shows the block's first words; blank throws. */
	dragLabel?: string;
}

/**
 * The descriptor's fields as data, for the check that holds the field table in
 * `docs/design/plugin-contract.md` to this type; the compile check below keeps the list complete.
 */
export const DESCRIPTOR_FIELDS = [
	'mergeRole',
	'editable',
	'closure',
	'label',
	'conformanceFixture',
	'blockFocus',
	'gapEdges',
	'isContainer',
	'containerContract',
	'bodyWrap',
	'contextDependentKind',
	'readsFollowingLines',
	'rawWrite',
	'bodyWrite',
	'reservedChrome',
	'containerPaste',
	'unwrapRole',
	'contentStartSpace',
	'reorderChildren',
	'keymap',
	'supportsInline',
	'getContentRange',
	'contentStartBackspace',
	'rebuildRaw',
	'renderImagesAsWidgets',
	'foreignDragHitTest',
	'caretTargetAtPoint',
	'estimateHeight',
	'pageRole',
	'dragLabel'
] as const satisfies readonly (keyof BlockKindDescriptor)[];

type MissingDescriptorField = Exclude<
	keyof BlockKindDescriptor,
	(typeof DESCRIPTOR_FIELDS)[number]
>;
const _descriptorFieldsAreComplete: MissingDescriptorField extends never ? true : never = true;
void _descriptorFieldsAreComplete;

// ── Registration ────────────────────────────────────────────────────────────

/**
 * Where a prose kind's content starts, for one whose markers take a prefix of its raw. The
 * Backspace behavior needs the range, so the two travel together.
 */
export interface ContentStart {
	/** The content range (post-marker offsets) in a node's raw. */
	range: (node: NodeView) => { start: number; end: number };
	/**
	 * In modes that hide markers, Backspace at the content start strips this kind's markers before
	 * merging (`docs/design/live-mode.md` § 4.4 Cutting a construct open).
	 */
	backspace?: 'demote-first';
}

/** Container-only fields as one unit, so a leaf can't carry any of them. Each is documented on
 *  `BlockKindDescriptor`, the flat read shape this group normalizes into. */
interface ContainerBase {
	contract: 'strip' | 'grid' | 'opaque';
	rebuildRaw: (node: CstNode, changed?: ChildRawChange) => void;
	bodyWrap?: ContainerBodyWrap;
	containerPaste?: ContainerPaste;
	contentStartSpace?: 'complete-marker';
	reorderChildren?: ReorderChildrenRole;
	bodyWrite?: WriteRule;
}

interface ContainerWithoutChrome extends ContainerBase {
	reservedChrome?: never;
	unwrapRole?: ContainerUnwrapRole;
}

/** Backspace at a title row's start never lifts it out, so only the middle strategy is declared. */
interface ContainerWithChrome extends ContainerBase {
	reservedChrome: ReservedChrome;
	unwrapRole?: {
		/** Implied: Backspace at the start of the title row keeps it. */
		firstChildBackspace?: never;
		middleChildBackspace: ContainerUnwrapRole['middleChildBackspace'];
	};
}

export type ContainerDescriptorGroup = ContainerWithChrome | ContainerWithoutChrome;

// One source for both the type-level Omit and the runtime strip: excess-property checks bite
// only fresh literals, so a widened value can structurally smuggle these keys past the types.
export const CONTAINER_ONLY_KEYS = [
	'isContainer',
	'containerContract',
	'bodyWrap',
	'rebuildRaw',
	'reservedChrome',
	'containerPaste',
	'unwrapRole',
	'contentStartSpace',
	'reorderChildren',
	'bodyWrite'
] as const;
type ContainerOnlyKey = (typeof CONTAINER_ONLY_KEYS)[number];

// A group field missing from the list would stay in the flat shape, where a leaf could declare it
// past the strip. `contract` is exempt: it normalizes to `containerContract`, which is listed.
type MissingContainerOnlyKey = Exclude<
	Exclude<keyof ContainerWithChrome | keyof ContainerWithoutChrome, 'contract'>,
	ContainerOnlyKey
>;
const _containerOnlyKeysAreComplete: MissingContainerOnlyKey extends never ? true : never = true;
void _containerOnlyKeysAreComplete;

// Read-shape fields a registration declares only through a group, stripped for the same reason.
const GROUPED_KEYS = [...CONTAINER_ONLY_KEYS, 'getContentRange', 'contentStartBackspace'] as const;
type GroupedKey = (typeof GROUPED_KEYS)[number];

function stripGroupedKeys<T extends object>(fields: T): Omit<T, GroupedKey> {
	const stripped = { ...fields } as Record<string, unknown>;
	for (const key of GROUPED_KEYS) delete stripped[key];
	return stripped as Omit<T, GroupedKey>;
}

/**
 * The fields another field constrains, so only a registration sets them. One list drives the
 * registration and augment types and the augment's runtime refusal; `container.` names a group field.
 */
export const FIXED_AT_REGISTRATION = [
	'blockFocus',
	'supportsInline',
	'contentStart',
	'container.reservedChrome',
	'container.unwrapRole'
] as const;
type FixedField = (typeof FIXED_AT_REGISTRATION)[number];
type FixedTopKey = Exclude<FixedField, `container.${string}`>;
type ContainerFieldOf<F> = F extends `container.${infer Key}` ? Key : never;
type FixedContainerKey = ContainerFieldOf<FixedField>;

/** The fields no other field constrains, shared by both registration shapes. */
type RegistrationBase = Omit<BlockKindDescriptor, GroupedKey | FixedTopKey>;

/**
 * A block focused as one unit: arrow traversal stops on it, and Backspace/Delete focuses it before
 * a second press deletes. No caret enters it, so it has no inline content, content start or title row.
 */
export interface WholeBlockRegistration extends RegistrationBase {
	blockFocus: 'whole-block';
	supportsInline: false;
	contentStart?: never;
	container?: ContainerWithoutChrome;
}

/** A block the caret enters: a text leaf, or a container whose children take the caret. */
export interface CaretBlockRegistration extends RegistrationBase {
	blockFocus?: never;
	supportsInline: boolean;
	contentStart?: ContentStart;
	container?: ContainerDescriptorGroup;
}

/**
 * The write-side shape `registerBlockKind` accepts. `isContainer` is derived
 * (`container !== undefined`), never declared.
 */
export type BlockKindRegistration = WholeBlockRegistration | CaretBlockRegistration;

/**
 * The augment shape: top-level fields replace; a partial `container` group merges into the
 * existing group, and is refused outright for a kind registered as a leaf. Fields another field
 * depends on are fixed at registration, and naming one throws.
 */
export type BlockKindAugmentation = Partial<RegistrationBase> & {
	[Key in FixedTopKey]?: never;
} & {
	container?: Partial<ContainerBase> & { [Key in FixedContainerKey]?: never };
};

// ── Registry ────────────────────────────────────────────────────────────────

// Never filtered by activation: a kind an editor left out still needs its descriptor to degrade.
const registry = createPluginRegistry<AnyBlockKind, BlockKindDescriptor>({
	label: 'registerBlockKind',
	isBuiltin: isBuiltinBlockKind
});

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: AnyBlockKind, registration: BlockKindRegistration): void {
	rejectBlankLabel('registerBlockKind', kind, 'label', registration.label);
	rejectBlankLabel('registerBlockKind', kind, 'dragLabel', registration.dragLabel);
	rejectIncoherentPairs(kind, registration);
	const descriptor = normalizeRegistration(registration);
	if (descriptor.keymap)
		descriptor.keymap = registeredKeymap('registerBlockKind', kind, descriptor.keymap);
	const owner = registry.has(kind) ? pluginKindOwner(kind) : null;
	registry.register(
		kind,
		descriptor,
		`registerBlockKind: "${kind}" is already registered. Kinds are register-once — ` +
			`use augmentBlockKind to merge fields into an existing registration.` +
			(owner ? ` — first declared by plugin '${owner}'` : '')
	);
	enqueueRegistrationCheck(kind);
}

// A blank label would render as an empty `aria-label`, leaving the block's textbox unnamed.
function rejectBlankLabel(
	entry: string,
	kind: AnyBlockKind,
	field: 'label' | 'dragLabel',
	label: string | undefined
): void {
	if (label === undefined || label.trim() !== '') return;
	throw new Error(
		`${entry}: "${kind}" has a blank ${field}; give it a name or omit ${field} for the default.`
	);
}

// Every chord is checked and normalized once here, so the resolvers compare stored chords as is.
function registeredKeymap(entry: string, kind: AnyBlockKind, keymap: KeyBinding[]): KeyBinding[] {
	return keymap.map((binding) => ({
		...binding,
		chord: registeredChord(binding.chord, `${entry}: "${kind}" keymap`)
	}));
}

// The flat part is stripped and isContainer derived, so each group is the only source of its
// fields: a widened or stale-keyed registration object cannot leak through.
function normalizeRegistration(registration: BlockKindRegistration): BlockKindDescriptor {
	const { container, contentStart, ...rest } = registration;
	const flat: BlockKindDescriptor = { ...stripGroupedKeys(rest), isContainer: false };
	if (contentStart) {
		flat.getContentRange = contentStart.range;
		if (contentStart.backspace) flat.contentStartBackspace = contentStart.backspace;
	}
	if (!container) return flat;
	const { contract, unwrapRole, ...containerFields } = container;
	const descriptor: BlockKindDescriptor = {
		...flat,
		...containerFields,
		isContainer: true,
		containerContract: contract
	};
	// A title row implies its first-child strategy; the read shape spells it out for the dispatch.
	if (container.reservedChrome) {
		descriptor.unwrapRole = {
			firstChildBackspace: 'keep-reserved-chrome',
			middleChildBackspace: unwrapRole?.middleChildBackspace ?? 'default-merge'
		};
	} else if (container.unwrapRole) descriptor.unwrapRole = container.unwrapRole;
	return descriptor;
}

// A JavaScript caller or a cast gets past the augment types. Presence alone refuses, since an
// explicit undefined would spread over the registered value.
function rejectFixedFields(entry: string, kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	for (const field of FIXED_AT_REGISTRATION) {
		const [group, key] = field.startsWith('container.')
			? [fields.container, field.slice('container.'.length)]
			: [fields, field];
		if (!group || !(key in group)) continue;
		throw new Error(
			`${entry}: cannot augment "${kind}" with ${field}; it is fixed at registration`
		);
	}
}

// Throws if the kind was never registered, so partial data cannot create one.
function mergeBlockKindFields(
	entry: string,
	kind: AnyBlockKind,
	fields: BlockKindAugmentation
): void {
	const existing = registry.getIgnoringActivation(kind);
	if (!existing) {
		throw new Error(
			`${entry}: cannot augment "${kind}"; no base descriptor. Call registerBlockKind first.`
		);
	}
	rejectFixedFields(entry, kind, fields);
	rejectBlankLabel(entry, kind, 'label', fields.label);
	rejectBlankLabel(entry, kind, 'dragLabel', fields.dragLabel);
	const { container, ...rest } = fields;
	const next: BlockKindDescriptor = { ...existing, ...stripGroupedKeys(rest) };
	if (rest.keymap) next.keymap = registeredKeymap(entry, kind, rest.keymap);
	if (container) {
		if (!existing.isContainer) {
			throw new Error(
				`${entry}: cannot augment "${kind}" with container fields; it was registered as a leaf`
			);
		}
		// Merge, never unset: skipping undefined keeps an explicitly-undefined group field from
		// breaking the contract/rebuild pairing.
		const { contract, ...group } = container;
		next.containerContract = contract ?? existing.containerContract;
		Object.assign(
			next,
			Object.fromEntries(Object.entries(group).filter(([, value]) => value !== undefined))
		);
	}
	registry.update(kind, next);
	enqueueRegistrationCheck(kind);
}

/**
 * Merge fields into a plugin's own kind. Throws for a built-in or another plugin's kind, so an
 * overwrite is never silent; a kind declared outside any plugin install stays open.
 */
export function augmentBlockKind(kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	if (isBuiltinBlockKind(kind)) {
		throw new Error(
			`augmentBlockKind: "${kind}" is a built-in kind; the plugin surface may only augment ` +
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
 * Patch a built-in descriptor with behavior schema cannot import (`components/built-in-blocks.ts`).
 * Kept off the plugin API so a plugin cannot rewrite a built-in.
 */
export function augmentBuiltin(kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	mergeBlockKindFields('augmentBuiltin', kind, fields);
}

export function getBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor {
	const d = registry.getIgnoringActivation(kind);
	if (!d) {
		throw new Error(
			`getBlockKindDescriptor: no descriptor registered for kind "${kind}". ` +
				`Register at module load (see built-in-descriptors.ts).`
		);
	}
	return d;
}

export function tryGetBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined {
	return registry.getIgnoringActivation(kind);
}

/** Whether a kind declares the grid contract: a table and its rows, or a plugin's equivalent. A
 *  cell is in a grid when its parent row is one. */
export function isGridKind(kind: AnyBlockKind): boolean {
	return tryGetBlockKindDescriptor(kind)?.containerContract === 'grid';
}

/** Whether an endpoint on this block's own path counts cells rather than characters. Tables only:
 *  a plugin grid's endpoints stay character offsets on deep cell paths. */
export function countsCells(
	node: NodeView | DocumentView
): node is Extract<NodeView, { kind: 'table' }> {
	return 'raw' in node && node.kind === 'table';
}

/**
 * How many cells a table's index space holds, the exclusive upper bound on any row-major cell
 * index. `node` must be a table block; the metadata read is unchecked, so other kinds give NaN.
 */
export function tableCellCount(node: NodeView): number {
	return (node.children?.length ?? 0) * metadataOf(node, 'table').columnCount;
}

/** A cell index clamped into a table's grid: the one upper bound every cell-space caller uses. */
export function clampCellIndex(node: NodeView, cellIdx: number): number {
	return Math.min(Math.max(cellIdx, 0), Math.max(tableCellCount(node) - 1, 0));
}

/**
 * Is a kind descriptor registered? `registerBlockKind` throws on a duplicate, so a plugin that
 * may register twice (hot reload, re-import) checks this first. Takes a plain, unbranded name.
 */
export function isBlockKindRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
}

/** Every kind currently registered. Caller must not mutate. */
export function getAllRegisteredKinds(): AnyBlockKind[] {
	return registry.records().map((r) => r.key);
}
