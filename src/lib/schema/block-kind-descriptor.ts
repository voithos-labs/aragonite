import { isBuiltinBlockKind, type AnyBlockKind, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { enqueueRegistrationCheck } from './registration-pending';
import { currentInstallingPlugin, pluginKindOwner } from './plugin-install';
import { registerOnce } from './register-once';
import type { ClosureBlock } from './closure';
import type { KeyBinding } from './keybindings';

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
	/**
	 * The container is quote-shaped: lifting its first child out (Rule U2) drops
	 * the opener syntax and leaves a plain blockquote, so `unwrapFirstChildFromQuote`
	 * takes the lift. A positive opt-in read by presence — a chrome container that
	 * shares `firstChildBackspace: 'lift-first-child'` but omits this no-ops instead,
	 * preserving its reserved chrome (the callout path). Keeps the core tree-op free
	 * of any kind name; a future quote-shaped kind opts in here.
	 */
	quoteShaped?: true;
}

/**
 * A container whose direct children reorder among themselves (Alt+Arrow nudge /
 * drag handle). The reorder walk resolves the unit at the nearest ancestor
 * declaring this; absent means children are NOT independently reorderable — a
 * listItem's leaf resolves to the item under the list, and an opaque container
 * declines the reorder at its boundary rather than teleporting the whole block.
 * Distinct from `quoteShaped`: a list is reorder-within but not quote-shaped, and
 * a listItem is strip but not reorder-within.
 */
export interface ReorderChildrenRole {
	/**
	 * Direct children carry position-dependent markers that must be renumbered
	 * after a permutation (ordered-list numbering). Absent = the per-line marker
	 * is position-independent (a uniform quote/indent prefix — blockquote,
	 * githubAlert, footnote-def), so the descriptor's rebuildRaw alone re-emits it.
	 */
	renumberMarkers?: true;
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
	 * Make text legal as this kind's `raw` before an in-place write lands. The
	 * companion of `contextDependentKind`: a container that joins its children's
	 * bytes verbatim gives those bytes delimiter meaning, so a write carrying a
	 * delimiter would restructure the container instead of adding text (a bare `|`
	 * in a tableCell deletes the row's last column). Applied at the write sink so
	 * no gesture carries the rule; must be idempotent and prefix-composable, since
	 * callers map their caret through the same pass. Absent = raw is written as given.
	 */
	normalizeRawWrite?: (raw: string) => string;
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
	/** This container's direct children reorder among themselves. Absent = not reorder-within. */
	reorderChildren?: ReorderChildrenRole;
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
	reorderChildren?: ReorderChildrenRole;
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
	'unwrapRole',
	'reorderChildren'
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
		next.reorderChildren = container.reorderChildren ?? existing.reorderChildren;
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
				`Register at module load (see built-in-descriptors.ts).`
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
