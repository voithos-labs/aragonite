import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { ContainerBodyWrap } from '../core/parser';
import { enqueueRegistrationCheck } from './registration-pending';
import { currentInstallingPlugin, pluginKindOwner } from './plugin-install';
import { registerOnce } from './register-once';
import type { ClosureBlock } from './closure';
import type { KeyBinding } from './keybindings';

/**
 * Backspace-merge role. Full spec: `docs/design/editor.md` — Merge eligibility: roles, not pairs.
 * Lives here, not `merge-rules.ts`, so the descriptor registry can reference it without a cycle.
 * The tuple is the one home: G1.30's runtime vocabulary is derived from it, not re-listed.
 */
export const MERGE_ROLES = [
	'prose',
	'prose-absorber',
	'container',
	'self-merge',
	'not-mergeable'
] as const;

export type MergeRole = (typeof MERGE_ROLES)[number];

/** G1.30's runtime half, for the registrations a `MergeRole` parameter cannot bind (plugin casts). */
export const isKnownMergeRole = (role: string): boolean =>
	(MERGE_ROLES as readonly string[]).includes(role);

/**
 * Backspace-at-start behavior for a container's children; strategies live in
 * `editor-actions/unwrap-strategies.ts`. Absent = default (first child delegates upward;
 * middle children follow merge-rules).
 */
export interface UnwrapRole {
	firstChildBackspace: 'lift-first-child' | 'list-item-cascade';
	middleChildBackspace: 'default-merge' | 'list-item-cascade';
	/**
	 * Quote-shaped: lifting the first child out (Rule U2) drops the opener, so
	 * `unwrapFirstChildFromQuote` takes the lift. A `lift-first-child` container omitting
	 * this no-ops instead, preserving its reserved chrome.
	 */
	quoteShaped?: true;
}

/**
 * A container whose direct children reorder among themselves (Alt+Arrow / drag handle). The
 * reorder walk resolves the unit at the nearest ancestor declaring this; absent = children are
 * NOT independently reorderable, and the container declines the reorder at its boundary.
 */
export interface ReorderChildrenRole {
	/**
	 * Direct children carry position-dependent markers needing a renumber after a permutation
	 * (ordered-list numbering). Absent = position-independent, so `rebuildRaw` alone re-emits.
	 */
	renumberMarkers?: true;
}

export interface BlockKindDescriptor {
	mergeRole: MergeRole;
	editable: boolean;
	/**
	 * The kind's closure-matrix row: its answer to every cross-cutting editor system. Required,
	 * so a kind cannot ship closed under a subsystem nobody asked about.
	 */
	closure: ClosureBlock;
	/**
	 * Markdown parsing to a tree containing this kind, for the conformance battery; omit for
	 * kinds no document scan yields in isolation. G1.24 checks a declared fixture, not existence.
	 */
	conformanceFixture?: string;
	/**
	 * `'whole-block'` opts an opaque, childless block into the focus-then-delete model: arrow
	 * traversal stops on it, and Backspace/Delete focuses it before a second press deletes.
	 */
	blockFocus?: 'whole-block';
	/**
	 * Edges whose sibling-paragraph insertion this kind's own editing surface cannot host, so an
	 * eligible boundary beside it gets a gap caret (`selection/gap-caret.ts`). Absent = the
	 * surface, or an existing affordance, already covers insertion at both edges.
	 */
	gapEdges?: 'before' | 'after' | 'both';
	isContainer: boolean;
	/**
	 * Shape of a container's raw↔children relationship (container kinds only).
	 * `'strip'` — outer syntax wrapping a strip-and-recurse body, so
	 * `strip(raw) === serialize(children)`.
	 * `'grid'` — cells parse straight from `raw`; coordinate-addressed, and that does not hold.
	 * `'opaque'` — `raw` is authoritative, not a strip-decomposition; exempt from the stale-raw
	 * byte-check, and its `rebuildRaw` must be deterministic over children/metadata/inner trivia.
	 */
	containerContract?: 'strip' | 'grid' | 'opaque';
	/**
	 * The wrap this container's opener parses its body with, when the body sits between chrome
	 * lines of the container's own: a parse then peels the chrome-adjacent blank line into
	 * `innerPrefix`/`innerSuffix` (`core/parser.parseContainerBody`), which is what makes that
	 * line the wrap's rather than a body block. Absent = the body starts at the container's own
	 * first line (blockquote, list item) and `innerPrefix` is always empty.
	 */
	bodyWrap?: ContainerBodyWrap;
	/**
	 * The kind has no standalone line recognizer, so `parse(raw)` would NOT reproduce it: its
	 * container's rebuildRaw owns the syntax, and a content edit writes `raw` without re-deriving.
	 */
	contextDependentKind?: boolean;
	/**
	 * Make `raw` legal as this kind's own bytes: escape what the grammar would restructure, and
	 * restore, drop, escalate or sanitize the block's own syntax around a write that broke it
	 * (`schema/fenced-code-raw.ts` is the worked rule). Reads `node` for the block's own shape,
	 * must be idempotent, and owes callers a caret image when it is not prefix-composable. Every
	 * write sink applies it.
	 */
	normalizeRawWrite?: (raw: string, node: NodeView) => string;
	/**
	 * Make text legal as a CHILD's raw inside this container's body (container kinds only) —
	 * `normalizeRawWrite`'s ancestor-side counterpart, for a container whose FIXED terminator
	 * (`</details>`) a body write could otherwise reproduce and truncate on. Applied at the write
	 * sinks upstream of the kind-deriving reparse, since the escape changes what the bytes parse
	 * to. `normalize` is idempotent and LINE-LOCAL; `mapOffset` is its exact caret image.
	 */
	bodyWrite?: {
		normalize: (raw: string) => string;
		mapOffset: (raw: string, offset: number) => number;
	};
	/**
	 * Child index 0 is a reserved chrome leaf of the given kind — a title whose bytes live in the
	 * container's own raw. Enforced: always present, single-line, cleared-not-deleted by range
	 * ops, kind-stable. Register the chrome kind itself via `registerChromeLeaf`.
	 */
	reservedChrome?: {
		kind: AnyBlockKind;
		/**
		 * PURE model probe (node in, bool out; no DOM, no component state) for collapsed state.
		 * Collapse-aware walks stop at the chrome leaf rather than reach into a clamped-out body.
		 */
		isCollapsed?: (node: NodeView) => boolean;
		/**
		 * Pure patch that expands a collapsed node, so a reveal aimed at a clamped-out body child
		 * opens the container. Absent or null = no door, and the reveal degrades to the chrome row.
		 */
		expandPatch?: (node: NodeView) => Record<string, unknown> | null;
	};
	/**
	 * How a clipboard whose TOP block is this kind merges into a same-kind ancestor instead of
	 * nesting as a sub-container. Absent = always nest (the default structural path).
	 */
	containerPaste?: {
		/** Confirms the merge against the candidate ancestor (e.g. equal list ordered flags). */
		matchesAncestor: (clipboardTop: CstNode, ancestor: CstNode) => boolean;
		/**
		 * Non-empty single-block targets: splice clipboard items as siblings in the enclosing
		 * container when it matches, split it when it doesn't. The apply path is list-shaped.
		 */
		siblingAbsorb: boolean;
	};
	/** Backspace-at-start unwrap strategies for this container's children. Absent = default dispatch. */
	unwrapRole?: UnwrapRole;
	/**
	 * `'complete-marker'` consumes EVERY space typed at the content start of an empty child, at
	 * any child index, repeated presses included. A `rebuildRaw` that canonicalizes the marker's
	 * trailing space is what makes the first press byte-honest: the space it took reappears the
	 * moment content arrives. Without one, every press is simply eaten.
	 */
	contentStartSpace?: 'complete-marker';
	/** This container's direct children reorder among themselves. Absent = not reorder-within. */
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
	 * `'demote-first'` makes Backspace at the CONTENT start give up this kind's own structural
	 * bytes before merging — the first press a user can aim at markers they cannot see
	 * (live-mode.md § 4.4).
	 * Marker-hiding modes only; requires `getContentRange` (G1.32). Absent = the merge cascade.
	 */
	contentStartBackspace?: 'demote-first';
	/** Recompute `raw` from children + metadata; built-ins in `schema/container-rebuilders.ts`. */
	rebuildRaw?: (node: CstNode) => void;
	/** Inline image nodes render as widgets in this kind; opt out (e.g. tableCell) for alt-only fallback. */
	renderImagesAsWidgets?: boolean;
	/**
	 * Translate a foreign drag's viewport point into an internal focus offset, for a kind with
	 * its own coordinate addressing; null when the point is outside an addressable region.
	 * Patched in from `components/built-in-blocks.ts`, so schema keeps no component import.
	 */
	foreignDragHitTest?: (blockEl: HTMLElement, clientX: number, clientY: number) => number | null;
	/**
	 * Translate a point in this block's box into a caret landing in the kind's own addressing —
	 * child indices plus within-leaf offset, placed through `focusByPath`. TOTAL within the box,
	 * unlike {@link foreignDragHitTest}: snap to the NEAREST leaf where a drag declines off-cell.
	 */
	caretTargetAtPoint?: (
		blockEl: HTMLElement,
		clientX: number,
		clientY: number
	) => { path: number[]; offset: number } | null;
	/** O(1) content-height estimate in px for virtual rendering — no subtree walk.
	 *  The oracle adds block chrome; the measured cache still supersedes. */
	estimateHeight?: (node: NodeView, env: { width: number }) => number;
}

/**
 * The descriptor's fields as data, for the census that holds the published field reference
 * (`docs/design/plugin-contract.md`) to this type. Complete in both directions below, so the
 * manifest cannot drift from the shape it enumerates.
 */
export const DESCRIPTOR_FIELDS = [
	'mergeRole',
	'editable',
	'closure',
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
 * leaf has no way to carry any of them. Field semantics live on `BlockKindDescriptor`, the flat
 * read-side shape the group normalizes into.
 */
export interface ContainerDescriptorGroup {
	contract: 'strip' | 'grid' | 'opaque';
	rebuildRaw: (node: CstNode) => void;
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
// registration shape, so a LEAF could declare it and survive the strip. `contract` is the one
// group field with no flat twin — it normalizes to `containerContract`, which the list carries.
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

// The flat part is stripped and isContainer derived, so the `container` group is the only
// source of container fields — a widened or stale-keyed registration object cannot leak.
function normalizeRegistration(registration: BlockKindRegistration): BlockKindDescriptor {
	const { container, ...rest } = registration;
	const flat = stripContainerOnlyKeys(rest);
	if (!container) return { ...flat, isContainer: false };
	const { contract, ...containerFields } = container;
	return { ...flat, ...containerFields, isContainer: true, containerContract: contract };
}

// Throws if the kind was never registered (no accidental creation via partial data). The
// built-in-vs-plugin gate lives in the two public entries below; the leaf/container gate lives
// here so both entries inherit it.
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
		// Merge, never unset: skipping undefined keeps an explicitly-undefined group field from
		// breaking the contract/rebuild pairing. Keyed off the group, not a hand-kept field list.
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
 * Merge fields into a plugin's own registration — the public authoring entry. Rejects built-in
 * kinds (built-in wire-up uses the internal `augmentBuiltin` seam) and kinds owned by a
 * different plugin, so cross-plugin last-writer-wins is a loud throw rather than a silent
 * override. A kind with no recorded owner (declared outside any plugin install) stays open.
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
 * Internal seam for augmenting a BUILT-IN descriptor: top-of-DAG wire-up
 * (`components/built-in-blocks.ts`) patches in behavior this file cannot import. Kept off the
 * public `aragonite/plugin` surface so a plugin can't rewrite a built-in.
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
 * Probe whether a kind descriptor exists — `registerBlockKind` throws on duplicate, so a plugin
 * registering idempotently (HMR / re-import) guards on this. Takes a plain, unbranded name.
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
