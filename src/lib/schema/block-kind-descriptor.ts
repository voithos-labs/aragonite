import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { ContainerBodyWrap } from '../core/parser';
import { enqueueRegistrationCheck } from './registration-pending';
import { currentInstallingPlugin, pluginKindOwner } from './plugin-install';
import { deletePluginEntries, registerOnce } from './register-once';
import type { ChildRawChange } from './child-spans';
import type { ClosureBlock } from './closure';
import type { KeyBinding } from './keybindings';

/**
 * The Backspace-merge roles (`docs/design/editor.md`, "Merge eligibility: roles, not pairs").
 * The runtime role check (G1.30) reads its list from this tuple.
 */
export const MERGE_ROLES = [
	'prose',
	'prose-absorber',
	'container',
	'self-merge',
	'not-mergeable'
] as const;

export type MergeRole = (typeof MERGE_ROLES)[number];

/** The runtime role check (G1.30), for registrations the `MergeRole` type cannot bind (a cast). */
export const isKnownMergeRole = (role: string): boolean =>
	(MERGE_ROLES as readonly string[]).includes(role);

/**
 * The first-child Backspace strategies, each saying whether it lifts child 0 out of the container.
 * The `reservedChrome` coherence check (G1.37) reads that answer, so a new strategy cannot arrive
 * without one.
 */
const FIRST_CHILD_BACKSPACE_LIFTS = {
	'lift-first-child-drop-opener': true,
	'lift-first-child-keep-container': true,
	'keep-reserved-chrome': false,
	'list-item-cascade': false
} as const;

export type FirstChildBackspace = keyof typeof FIRST_CHILD_BACKSPACE_LIFTS;

export const liftsFirstChild = (strategy: FirstChildBackspace): boolean =>
	FIRST_CHILD_BACKSPACE_LIFTS[strategy];

/**
 * Backspace-at-start behavior for a container's children; strategies live in
 * `editor-actions/unwrap-strategies.ts`. Absent = default (first child delegates upward;
 * middle children follow merge-rules).
 */
export interface UnwrapRole {
	/**
	 * `'-drop-opener'` is the blockquote shape: the opener line leaves with the lifted child, so
	 * the remainder reparses as a plain quote. `'-keep-container'` is the shape `rebuildRaw`
	 * re-emits, so the remainder keeps its kind. `'keep-reserved-chrome'` declines, because child 0
	 * is the container's title row and a lift would carry it out.
	 */
	firstChildBackspace: FirstChildBackspace;
	middleChildBackspace: 'default-merge' | 'list-item-cascade';
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
	 * Markdown that parses to a tree containing this kind, for the conformance suite; omit for
	 * kinds a document parse never yields on their own. G1.24 checks a declared fixture, not
	 * whether one exists.
	 */
	conformanceFixture?: string;
	/**
	 * `'whole-block'` opts an opaque, childless block into the focus-then-delete model: arrow
	 * traversal stops on it, and Backspace/Delete focuses it before a second press deletes.
	 */
	blockFocus?: 'whole-block';
	/**
	 * The edges at which this kind's own editing cannot insert a sibling paragraph, so a boundary
	 * beside it gets a gap caret (`selection/gap-caret.ts`). Required, with `'none'` the explicit
	 * answer that the block itself, or an existing control, already covers insertion at both edges.
	 */
	gapEdges: 'before' | 'after' | 'both' | 'none';
	isContainer: boolean;
	/**
	 * How a container's `raw` relates to its children (container kinds only). `'strip'`: the outer
	 * syntax wraps a body, and `strip(raw) === serialize(children)`. `'grid'`: cells parse straight
	 * from `raw`, and that equality does not hold; a cell index addresses the outer grid as
	 * `row * width + column`, rows of equal width read off row 0. `'opaque'`: `raw` is authoritative,
	 * exempt from the stale-raw byte check, and its `rebuildRaw` must be deterministic over the
	 * children, metadata and inner blank lines.
	 */
	containerContract?: 'strip' | 'grid' | 'opaque';
	/**
	 * How this container's opener parses a body that sits between marker lines of the container's
	 * own (a fence, an HTML tag): the parse then pulls the blank line next to each marker into
	 * `innerPrefix`/`innerSuffix` (`core/parser.parseContainerBody`), so that line belongs to the
	 * wrap rather than to a body block. Absent means the body starts on the container's own first
	 * line (blockquote, list item) and `innerPrefix` is always empty.
	 */
	bodyWrap?: ContainerBodyWrap;
	/**
	 * The kind has no opener of its own, so `parse(raw)` would not reproduce it: its container's
	 * `rebuildRaw` owns the syntax, and a content edit writes `raw` without reparsing the kind.
	 */
	contextDependentKind?: boolean;
	/**
	 * Make `raw` legal as this kind's own bytes: escape what the grammar would restructure, and
	 * repair the block's own syntax around a write that broke it (`schema/fenced-code-raw.ts` is
	 * the worked example). Reads `node` for the block's own shape, must be idempotent, and must
	 * give callers a caret mapping when a prefix of the input does not map to a prefix of the
	 * output. Every write built outside the block's own editable text applies it.
	 */
	normalizeRawWrite?: (raw: string, node: NodeView) => string;
	/**
	 * Make text legal as a child's raw inside this container's body (container kinds only), for a
	 * container whose fixed closing line (`</details>`) a body write could reproduce. Applied before
	 * the reparse that derives the kind. `normalize` is idempotent and works line by line;
	 * `mapOffset` is its exact caret mapping.
	 */
	bodyWrite?: {
		normalize: (raw: string) => string;
		mapOffset: (raw: string, offset: number) => number;
	};
	/**
	 * Child 0 is a reserved leaf of the given kind: a title row whose bytes live in the container's
	 * own raw. Enforced: always present, single-line, cleared rather than deleted by range edits,
	 * never changes kind. Register the title kind itself with `registerChromeLeaf`.
	 */
	reservedChrome?: {
		kind: AnyBlockKind;
		/**
		 * A pure check of the collapsed state (node in, boolean out; no DOM, no component state).
		 * Collapse-aware traversals stop at the title row rather than reach into the hidden body.
		 */
		isCollapsed?: (node: NodeView) => boolean;
		/**
		 * A pure metadata patch that expands a collapsed node, so focusing a child hidden in the
		 * body opens the container. Absent or null means there is no way to expand, and the focus
		 * lands on the title row instead.
		 */
		expandPatch?: (node: NodeView) => Record<string, unknown> | null;
	};
	/**
	 * How a clipboard whose top block is this kind merges into a same-kind ancestor instead of
	 * nesting as a sub-container. Absent means always nest.
	 */
	containerPaste?: {
		/** Confirms the merge against the candidate ancestor (e.g. equal list ordered flags). */
		matchesAncestor: (clipboardTop: CstNode, ancestor: CstNode) => boolean;
		/**
		 * Pasting into a non-empty single block: splice the clipboard items as siblings into the
		 * enclosing container when it matches, split it when it does not (the list paste shape).
		 */
		siblingAbsorb: boolean;
	};
	/** Backspace-at-start unwrap strategies for this container's children. Absent = default dispatch. */
	unwrapRole?: UnwrapRole;
	/**
	 * `'complete-marker'` takes the first space typed at a child's content start while the marker
	 * lacks its space (an empty child, or text right after a bare `>`), at any child index; a
	 * second space there is content. A `rebuildRaw` that normalizes the marker's trailing space is
	 * what makes the taken press honest: the space reappears with the next write inside.
	 */
	contentStartSpace?: 'complete-marker';
	/** This container's direct children reorder among themselves. Absent means they do not. */
	reorderChildren?: ReorderChildrenRole;
	/** Chord -> command map, consulted before the global table so a kind can shadow a global. */
	keymap?: KeyBinding[];
	/** True when the block's raw contains inline syntax the inline parser should process on every edit. */
	supportsInline: boolean;
	/**
	 * Content range (post-marker offsets) in a node's raw, for prose kinds whose markers occupy
	 * a prefix of it. Absent = the default `start=0, end=displayLength`.
	 */
	getContentRange?: (node: NodeView) => { start: number; end: number };
	/**
	 * `'demote-first'` makes Backspace at the content start give up this kind's own structural
	 * bytes before merging: the first keypress a user can aim at markers they cannot see
	 * (live-mode.md § 4.4). Marker-hiding modes only; requires `getContentRange` (G1.32). Absent
	 * means the merge cascade.
	 */
	contentStartBackspace?: 'demote-first';
	/**
	 * Recompute `raw` from children + metadata; built-ins in `schema/container-rebuilders.ts`.
	 * `changed` names the one child whose own raw just moved, for a rebuilder that can rewrite
	 * that child's region instead of re-reading every child. Ignoring it is always correct.
	 */
	rebuildRaw?: (node: CstNode, changed?: ChildRawChange) => void;
	/** Inline image nodes render as widgets in this kind; opt out (e.g. tableCell) for alt-only fallback. */
	renderImagesAsWidgets?: boolean;
	/**
	 * Translate a foreign drag's viewport point into an internal focus offset, for a kind with
	 * its own coordinate addressing; null when the point is outside an addressable region.
	 * Patched in from `components/built-in-blocks.ts`, so schema keeps no component import.
	 */
	foreignDragHitTest?: (blockEl: HTMLElement, clientX: number, clientY: number) => number | null;
	/**
	 * Translate a point in this block's box into a caret position in the kind's own addressing.
	 * Answers for every point in the box, unlike {@link foreignDragHitTest}: it snaps to the
	 * nearest leaf where a drag would decline off-cell.
	 */
	caretTargetAtPoint?: (
		blockEl: HTMLElement,
		clientX: number,
		clientY: number
	) => CaretTarget | null;
	/** O(1) content-height estimate in px for windowing, with no subtree traversal. The height
	 *  estimator adds the block's frame; a measured height still wins. */
	estimateHeight?: (node: NodeView, env: { width: number }) => number;
}

/**
 * The descriptor's fields as data, for the check that holds the published field reference
 * (`docs/design/plugin-contract.md`) to this type. Complete in both directions below, so the list
 * cannot drift from the type it enumerates.
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
	'normalizeRawWrite',
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
	'estimateHeight'
] as const satisfies readonly (keyof BlockKindDescriptor)[];

type MissingDescriptorField = Exclude<
	keyof BlockKindDescriptor,
	(typeof DESCRIPTOR_FIELDS)[number]
>;
const _descriptorFieldsAreComplete: MissingDescriptorField extends never ? true : never = true;
void _descriptorFieldsAreComplete;

/**
 * Container-only fields as one unit: `contract` and `rebuildRaw` are required together, and a
 * leaf has no way to carry any of them. Each field is documented on `BlockKindDescriptor`, the
 * flat read-side shape this group normalizes into.
 */
export interface ContainerDescriptorGroup {
	contract: 'strip' | 'grid' | 'opaque';
	rebuildRaw: (node: CstNode, changed?: ChildRawChange) => void;
	bodyWrap?: ContainerBodyWrap;
	reservedChrome?: BlockKindDescriptor['reservedChrome'];
	containerPaste?: BlockKindDescriptor['containerPaste'];
	unwrapRole?: UnwrapRole;
	contentStartSpace?: BlockKindDescriptor['contentStartSpace'];
	reorderChildren?: ReorderChildrenRole;
	bodyWrite?: BlockKindDescriptor['bodyWrite'];
}

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

// The list's completeness as a compile error: a group field missed here stays in the flat
// registration shape, so a leaf could declare it and survive the strip. `contract` is the one
// group field with no flat counterpart; it normalizes to `containerContract`, which the list has.
type MissingContainerOnlyKey = Exclude<
	Exclude<keyof ContainerDescriptorGroup, 'contract'>,
	ContainerOnlyKey
>;
const _containerOnlyKeysAreComplete: MissingContainerOnlyKey extends never ? true : never = true;
void _containerOnlyKeysAreComplete;

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
 * The augment shape: top-level fields replace; a partial `container` group merges into the
 * existing group, and is refused outright for a kind registered as a leaf.
 */
export type BlockKindAugmentation = Partial<Omit<BlockKindRegistration, 'container'>> & {
	container?: Partial<ContainerDescriptorGroup>;
};

// ── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<AnyBlockKind, BlockKindDescriptor>();

// ── Public API ──────────────────────────────────────────────────────────────

export function registerBlockKind(kind: AnyBlockKind, registration: BlockKindRegistration): void {
	rejectBlankLabel('registerBlockKind', kind, registration.label);
	const isDuplicate = registry.has(kind);
	const owner = isDuplicate ? pluginKindOwner(kind) : null;
	registerOnce(
		isDuplicate,
		() => {
			registry.set(kind, normalizeRegistration(registration));
			enqueueRegistrationCheck(kind);
		},
		`registerBlockKind: "${kind}" is already registered. Kinds are register-once — ` +
			`use augmentBlockKind to merge fields into an existing registration.` +
			(owner ? ` — first declared by plugin '${owner}'` : '')
	);
}

// A blank label would render as an empty `aria-label`, leaving the block's textbox unnamed.
function rejectBlankLabel(entry: string, kind: AnyBlockKind, label: string | undefined): void {
	if (label === undefined || label.trim() !== '') return;
	throw new Error(
		`${entry}: "${kind}" has a blank label; give it a name or omit label to use the kind's name.`
	);
}

// The flat part is stripped and isContainer derived, so the `container` group is the only source
// of container fields: a widened or stale-keyed registration object cannot leak through.
function normalizeRegistration(registration: BlockKindRegistration): BlockKindDescriptor {
	const { container, ...rest } = registration;
	const flat = stripContainerOnlyKeys(rest);
	if (!container) return { ...flat, isContainer: false };
	const { contract, ...containerFields } = container;
	return { ...flat, ...containerFields, isContainer: true, containerContract: contract };
}

// Throws if the kind was never registered, so partial data cannot create one.
function mergeBlockKindFields(
	entry: string,
	kind: AnyBlockKind,
	fields: BlockKindAugmentation
): void {
	const existing = registry.get(kind);
	if (!existing) {
		throw new Error(
			`${entry}: cannot augment "${kind}"; no base descriptor. Call registerBlockKind first.`
		);
	}
	rejectBlankLabel(entry, kind, fields.label);
	const { container, ...rest } = fields;
	const next: BlockKindDescriptor = { ...existing, ...stripContainerOnlyKeys(rest) };
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
	registry.set(kind, next);
	enqueueRegistrationCheck(kind);
}

/**
 * Merge fields into a plugin's own registration: the public authoring entry. Rejects built-in
 * kinds (built-in wiring uses the internal `augmentBuiltin`) and kinds owned by a different
 * plugin, so one plugin overwriting another's kind is a throw rather than a silent override. A
 * kind with no recorded owner (declared outside any plugin install) stays open.
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
 * Internal entry for augmenting a built-in descriptor: the top-level wiring
 * (`components/built-in-blocks.ts`) patches in behavior this file cannot import. Kept off the
 * public `@voithos-labs/aragonite/plugin` API so a plugin cannot rewrite a built-in.
 */
export function augmentBuiltin(kind: AnyBlockKind, fields: BlockKindAugmentation): void {
	mergeBlockKindFields('augmentBuiltin', kind, fields);
}

export function getBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor {
	const d = registry.get(kind);
	if (!d) {
		throw new Error(
			`getBlockKindDescriptor: no descriptor registered for kind "${kind}". ` +
				`Register at module load (see built-in-descriptors.ts).`
		);
	}
	return d;
}

export function tryGetBlockKindDescriptor(kind: AnyBlockKind): BlockKindDescriptor | undefined {
	return registry.get(kind);
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
	return Array.from(registry.keys());
}

/** Test-only. Removes every non-built-in descriptor; built-ins survive. */
export function __removePluginBlockKindsForTests(): void {
	deletePluginEntries(registry, isBuiltinBlockKind);
}
