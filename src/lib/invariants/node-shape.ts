import { makeBlockNode, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { parse } from '../core/parser';
import { concatChildren } from '../core/serializer';
import { getBlockKindDescriptor, type MergeRole } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';
import { listRegisteredOpeners } from '../schema/block-openers';
import { isDirectiveKind } from '../core/directive/registry';
import type { InvariantViolation } from './assert';

// ── G1.5: category ↔ field legality ──────────────────────────────────────────

const MERGE_ROLES: ReadonlySet<MergeRole> = new Set([
	'prose',
	'prose-absorber',
	'container',
	'self-merge',
	'not-mergeable'
]);

/**
 * G1.5 — a node's fields match its kind's category. Implications are
 * one-directional (a container *may* be transiently childless mid-edit, so we
 * never require fields, only forbid illegal ones):
 *   - non-containers must not carry `children`;
 *   - container structural fields (`innerPrefix`/`innerSuffix`) only on containers;
 *   - `mergeRole` must be one of the five legal roles.
 * Editor-level fields (`childIds`, `ownerEpoch`) are deliberately unchecked —
 * legal on every kind; the predicate forbids category-bound fields only.
 */
export function checkCategoryFields(node: CstNode): InvariantViolation | null {
	const d = getBlockKindDescriptor(node.kind);

	if (!d.isContainer && node.children !== undefined) {
		return illegalField(node.kind, 'children', 'leaf carries children');
	}
	if (!d.isContainer && node.innerPrefix !== undefined) {
		return illegalField(node.kind, 'innerPrefix', 'leaf carries container structural field');
	}
	if (!d.isContainer && node.innerSuffix !== undefined) {
		return illegalField(node.kind, 'innerSuffix', 'leaf carries container structural field');
	}
	if (!MERGE_ROLES.has(d.mergeRole)) {
		return illegalField(node.kind, 'mergeRole', `unknown mergeRole "${d.mergeRole}"`);
	}
	return null;
}

function illegalField(kind: string, field: string, why: string): InvariantViolation {
	return {
		code: 'illegal-fields-for-kind',
		message: `${kind}: ${why}`,
		detail: { kind, field }
	};
}

// ── G1.1: container raw not stale ─────────────────────────────────────────────

/**
 * G1.1 — a strip container's `raw` agrees with its `children`:
 * `strip(raw) === serialize(children)`. Computed canonicalization-proof by
 * re-parsing `node.raw`: the correspondent's stripped-inner bytes ARE
 * `strip(node.raw)` (the parser's own output satisfies the invariant), so
 * byte-comparing them against `node`'s stripped-inner is exactly the invariant —
 * without re-deriving the `> ` prefix / indentation a `rebuildRaw` would
 * canonicalize.
 *
 * Byte-level by design: it tolerates the editor's empty-paragraph placeholders
 * (an empty editable container holds a blank paragraph so it has a focusable
 * leaf; the parser emits the same bytes as `innerSuffix`/trivia) while still
 * firing on genuine drift. Recurses into strip-container descendants so one
 * check on a touched container validates its whole subtree.
 *
 * Strip containers only; grid containers (table/tableRow) and leaves are exempt.
 */
export function checkStaleRaw(node: CstNode): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;

	// `listItem` is never a top-level block, so its raw re-parses to a wrapping
	// `list`; unwrap one level by kind to reach the grammatical correspondent.
	const top = parse(node.raw).children[0];
	const correspondent =
		top?.kind === node.kind ? top : top?.children?.find((c) => c.kind === node.kind);

	if (!rawFaithful(correspondent, node)) {
		return {
			code: 'stale-container-raw',
			// `raw` is carried so a violation caught in CI (the simulation oracle) is
			// self-diagnosing without re-instrumenting; clamped so a large container
			// can't flood the console.
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind, raw: clampForDetail(node.raw) }
		};
	}
	return null;
}

const MAX_RAW_IN_DETAIL = 200;

function clampForDetail(raw: string): string {
	return raw.length > MAX_RAW_IN_DETAIL ? raw.slice(0, MAX_RAW_IN_DETAIL) + '…' : raw;
}

/**
 * `strip(node.raw) === serialize(node.children)` at this level, then recurse for
 * nested coverage. `strippedInner(reparsed)` is `strip(node.raw)`;
 * `strippedInner(node)` is `serialize(node.children)`. Byte equality tolerates
 * the placeholder-vs-`innerSuffix` blank representation; recursing into
 * strip-container children catches drift the parent-level byte concat can't see
 * (children's raws match, but a child's own raw↔children may still diverge).
 */
function rawFaithful(reparsed: CstNode | undefined, node: CstNode): boolean {
	if (!reparsed) return false;
	if (strippedInner(reparsed) !== strippedInner(node)) return false;

	const reparsedContainers = stripContainerChildren(reparsed);
	const actualContainers = stripContainerChildren(node);
	if (reparsedContainers.length !== actualContainers.length) return false;
	for (let i = 0; i < reparsedContainers.length; i++) {
		if (!rawFaithful(reparsedContainers[i], actualContainers[i])) return false;
	}
	return true;
}

/** Stripped inner content: `innerPrefix + serialize(children) + innerSuffix`. */
function strippedInner(node: CstNode): string {
	return (node.innerPrefix ?? '') + concatChildren(node.children ?? []) + (node.innerSuffix ?? '');
}

function stripContainerChildren(node: CstNode): CstNode[] {
	return (node.children ?? []).filter(
		(c) => getBlockKindDescriptor(c.kind).containerContract === 'strip'
	);
}

// ── G1.12: opaque container raw not stale ─────────────────────────────────────

/**
 * G1.12 — opaque containers escape the strip byte-check, but the same
 * children-mutated-without-rebuild staleness class must still be caught. `raw`
 * can never be byte-compared against a rebuildRaw output: a faithful parse may
 * be non-canonical (`:::x  y` stored verbatim where the rebuilder emits
 * `:::x y`) — the same false-fire class the strip check's header documents.
 * Compare through the parse channel instead: re-parse `raw` and diff the
 * reparsed children-bytes against the live ones with checkStaleRaw's tolerance
 * machinery, so only genuine drift fires.
 *
 * When `raw` does not reparse standalone to exactly one block of this kind, the
 * outcome splits on recognizer existence: a kind WITH a standalone recognizer
 * has genuinely drifted (its raw no longer matches any shape that recognizer
 * accepts) and fires; a kind WITHOUT one cannot be validated even with stale
 * children, so it bails (a test kind whose raw reparses to a paragraph must not
 * fire).
 */
export function checkOpaqueStaleRaw(node: CstNode): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'opaque') return null;

	const blocks = parse(node.raw).children;
	if (blocks.length !== 1 || blocks[0].kind !== node.kind) {
		if (!hasStandaloneRecognizer(node.kind)) return null;
		return {
			code: 'opaque-stale-raw',
			message: `${node.kind} opaque raw no longer reparses to its own kind`,
			detail: { kind: node.kind, reason: 'reparse-diverges', raw: clampForDetail(node.raw) }
		};
	}

	if (!opaqueRawFaithful(blocks[0], node)) {
		return {
			code: 'opaque-stale-raw',
			message: `${node.kind} opaque raw is stale relative to its children`,
			detail: { kind: node.kind, raw: clampForDetail(node.raw) }
		};
	}
	return null;
}

/**
 * Can `parse(raw)` reproduce this kind at all? Both registries answer it: a kind
 * either owns a block opener, or is registered as a directive and the one shared
 * `:::` opener recognizes it on the kind's behalf. Probing openers alone reads
 * every directive container as unrecognizable, exempting the whole tier the
 * plugin guide recommends for authoring one.
 */
function hasStandaloneRecognizer(kind: CstNode['kind']): boolean {
	return listRegisteredOpeners().some((o) => o.kind === kind) || isDirectiveKind(kind);
}

/**
 * Chrome-aware faithfulness: a reservedChrome child's bytes live in the
 * container's opener line, not its inner bytes, so a reparse mints the chrome
 * BEFORE any body trivia while the live tree may legally hold an
 * unrepresentable transient blank (the empty body paragraph the descend
 * gesture mints) AFTER it. Interleaving the chrome raw into the inner-byte
 * stream false-fires on that state — compare the chrome raw positionally and
 * the body bytes as a unit instead; drift on either side still fires. A
 * missing/displaced slot is G1.14's finding, not staleness — fall through to
 * the plain comparison.
 */
function opaqueRawFaithful(reparsed: CstNode, node: CstNode): boolean {
	const chromeKind = reservedChromeKindOf(node.kind);
	const liveChrome = node.children?.[0];
	const reparsedChrome = reparsed.children?.[0];
	if (
		chromeKind === undefined ||
		liveChrome?.kind !== chromeKind ||
		reparsedChrome?.kind !== chromeKind
	) {
		return rawFaithful(reparsed, node);
	}

	if (liveChrome.raw !== reparsedChrome.raw) return false;
	// Compare the chrome-stripped bodies (same nodes minus child 0). Spreading the
	// union widens `kind`, so re-mint through the construction funnel.
	return rawFaithful(
		makeBlockNode({ ...reparsed, children: reparsed.children!.slice(1) }),
		makeBlockNode({ ...node, children: node.children!.slice(1) })
	);
}

// ── G1.13: opaque rebuild determinism ─────────────────────────────────────────

/**
 * G1.13 — the staleness check above trusts a single reparse of `raw`; that trust
 * requires the plugin-authored rebuildRaw to be deterministic over the committed
 * state. Two probe rebuilds are compared to each other — never to `node.raw`,
 * which a faithful non-canonical parse legally differs from.
 */
export function checkOpaqueRebuildDeterminism(node: CstNode): InvariantViolation | null {
	const descriptor = getBlockKindDescriptor(node.kind);
	if (descriptor.containerContract !== 'opaque' || !descriptor.rebuildRaw) return null;

	const first = probeRebuild(node, descriptor.rebuildRaw);
	const second = probeRebuild(node, descriptor.rebuildRaw);
	if (first === second) return null;
	return {
		code: 'opaque-rebuild-nondeterministic',
		message: `${node.kind} rebuildRaw emitted different bytes over identical committed state`,
		detail: { kind: node.kind, first: clampForDetail(first), second: clampForDetail(second) }
	};
}

/**
 * rebuildRaw's contract is to read children/metadata/inner trivia and write
 * only `raw`. The probe isolates that write and additionally copies the
 * children array and metadata record, shielding the live node from a
 * misbehaving rebuilder's cheap structural writes (splice/push, metadata
 * fields). Child NODES stay shared by reference — defending field writes on
 * them would need a per-commit deep clone, which isn't worth a contract breach
 * this unlikely.
 */
function probeRebuild(node: CstNode, rebuildRaw: (probe: CstNode) => void): string {
	const probe = { ...node };
	if (probe.children) probe.children = [...probe.children];
	if (probe.metadata) probe.metadata = { ...probe.metadata };
	rebuildRaw(probe);
	return probe.raw;
}

// ── G1.14: reserved-chrome slot ───────────────────────────────────────────────

/**
 * G1.14 — a container declaring `reservedChrome` always holds a chrome leaf of
 * the declared kind at child 0. The wall/backfill machinery must never empty the
 * slot or replace it with another kind; firing here means an op deleted or
 * downgraded the chrome instead of clearing it. Self-filtering: non-declaring
 * kinds are exempt.
 */
export function checkReservedChromeSlot(node: CstNode): InvariantViolation | null {
	const chromeKind = reservedChromeKindOf(node.kind);
	if (chromeKind === undefined) return null;

	const child0 = node.children?.[0];
	if (child0?.kind === chromeKind) return null;
	return {
		code: 'reserved-chrome-slot',
		message: `${node.kind}: child 0 must be reserved chrome "${chromeKind}", found "${child0?.kind ?? 'none'}"`,
		detail: { kind: node.kind, expected: chromeKind, found: child0?.kind ?? null }
	};
}

// ── G1.6: clone-safe metadata ─────────────────────────────────────────────────

/**
 * G1.6 — metadata survives the one-level undo clone (`cloneMetadata` copies
 * `Array.isArray(v) ? [...v] : v`). Every value must be a primitive or an array
 * of primitives; a nested object or array-of-objects would be shared by
 * reference with the snapshot and corrupt undo.
 */
export function checkCloneSafeMetadata(node: NodeView): InvariantViolation | null {
	if (!node.metadata) return null;

	for (const [field, value] of Object.entries(node.metadata)) {
		if (Array.isArray(value)) {
			if (!value.every(isPrimitive)) {
				return notCloneSafe(node.kind, field, 'array contains a non-primitive');
			}
		} else if (!isPrimitive(value)) {
			return notCloneSafe(node.kind, field, 'value is a nested object');
		}
	}
	return null;
}

function notCloneSafe(kind: string, field: string, why: string): InvariantViolation {
	return {
		code: 'metadata-not-clone-safe',
		message: `${kind}.${field}: ${why}`,
		detail: { kind, field }
	};
}

function isPrimitive(value: unknown): boolean {
	if (value === null) return true;
	const t = typeof value;
	return t !== 'object' && t !== 'function';
}
