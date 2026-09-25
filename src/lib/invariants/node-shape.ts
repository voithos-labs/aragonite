import { makeBlockNode, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { parse } from '../core/parser';
import { concatChildren } from '../core/serializer';
import { getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';
import { listRegisteredOpeners, type GrammarView } from '../schema/block-openers';
import { isDirectiveKind } from '../core/directive/registry';
import type { InvariantViolation } from '../assert';

// ── G1.5: category ↔ field legality ──────────────────────────────────────────

/**
 * G1.5: a node's fields match its kind's category. It only forbids, never requires: a container
 * can be briefly childless mid-edit. Fields the editor adds (`childIds`, `ownerEpoch`) are legal
 * on every kind and go unchecked, and `mergeRole` belongs to the kind, so it is checked once at
 * registration (G1.30).
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
	// Only a body that starts under a title line of the container's own can strip a blank into
	// `innerPrefix` (`core/parser.parseContainerBody`). Elsewhere the body opens on the
	// container's first line, and a filled field would emit a line no parse can produce.
	if (d.bodyWrap?.afterOpenerLine !== true && node.innerPrefix) {
		return illegalField(node.kind, 'innerPrefix', 'container declares no opener-line body wrap');
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
 * G1.1: a strip container's `raw` agrees with its `children`: `strip(raw) === serialize(children)`.
 * It reparses `raw` in the editor's grammar (every installed plugin when absent) and compares the
 * stripped inner bytes, which a faithful non-canonical parse and the editor's empty-paragraph
 * placeholder both survive. Strip containers only, and recursively.
 */
export function checkStaleRaw(node: CstNode, grammar: GrammarView): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;

	// Document scope because the check is handed no document position: fragment scope would
	// fire on every legitimate position-scoped node at the top.
	const correspondent = soleCorrespondent(
		parse(node.raw, { grammar, scope: 'document' }).children,
		node
	);

	if (!rawFaithful(correspondent, node)) {
		return {
			code: 'stale-container-raw',
			// `raw` travels with the violation so a CI failure explains itself without a second
			// run, clamped so a large container cannot flood the console.
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind, raw: clampForDetail(node.raw) }
		};
	}
	return null;
}

/**
 * The one block `node.raw` must reparse to, or undefined. Being a single block is half the rule:
 * bytes that belong to a following sibling leave the first block's inner content intact, so
 * comparing that block alone would call a container whose raw has grown faithful. `listItem` is
 * never a top-level block, so its raw reparses to a `list` wrapping it alone.
 */
function soleCorrespondent(blocks: CstNode[], node: CstNode): CstNode | undefined {
	if (blocks.length !== 1) return undefined;
	const top = blocks[0];
	if (top.kind === node.kind) return top;
	const wrapped = top.children ?? [];
	return wrapped.length === 1 && wrapped[0].kind === node.kind ? wrapped[0] : undefined;
}

const MAX_RAW_IN_DETAIL = 200;

function clampForDetail(raw: string): string {
	return raw.length > MAX_RAW_IN_DETAIL ? raw.slice(0, MAX_RAW_IN_DETAIL) + '…' : raw;
}

/**
 * Checks `strip(node.raw) === serialize(node.children)` at this level, then recurses: joining
 * bytes at the parent level cannot see a child whose own raw and children disagree while its raw
 * still matches.
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
 * G1.12: G1.1's staleness check for opaque containers, reparsing `raw` in the editor's grammar
 * (every installed plugin when absent). Raw that no longer reparses to one block of this kind
 * fires only when the parser can recognize the kind at all; otherwise there is nothing to check.
 */
export function checkOpaqueStaleRaw(
	node: CstNode,
	grammar: GrammarView
): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'opaque') return null;

	// Document scope for the same reason as G1.1: the node arrives without its document
	// position, and fragment scope would fire on a legitimate position-scoped node.
	const blocks = parse(node.raw, { grammar, scope: 'document' }).children;
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
 * Can `parse(raw)` produce this kind at all? Two registries answer: the kind owns a block opener,
 * or it is a directive the shared `:::` opener recognizes. Checking openers alone would exempt
 * every directive kind as unrecognizable.
 */
function hasStandaloneRecognizer(kind: CstNode['kind']): boolean {
	return listRegisteredOpeners().some((o) => o.kind === kind) || isDirectiveKind(kind);
}

/**
 * The same check, aware of a reserved title child: its bytes live in the container's opener line,
 * so a reparse puts it before any blank lines while the live tree may legally hold a transient
 * blank after it. So compare the title's raw by position and the body bytes as one unit; a title
 * that is missing or in the wrong place is G1.14's finding, not staleness.
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
	// Spreading the union widens `kind`, so rebuild through the node constructor.
	return rawFaithful(
		makeBlockNode({ ...reparsed, children: reparsed.children!.slice(1) }),
		makeBlockNode({ ...node, children: node.children!.slice(1) })
	);
}

// ── G1.13: opaque rebuild determinism ─────────────────────────────────────────

/**
 * G1.13: a plugin's `rebuildRaw` produces the same bytes every time for the same committed state,
 * which is what G1.12's single reparse relies on. The two trial runs are compared against each
 * other, never against `node.raw`, which a faithful parse may legally differ from.
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
 * `rebuildRaw` may write only `raw`. The trial run copies the children array and the metadata
 * record so a misbehaving rebuilder cannot reach the live node. The child nodes themselves stay
 * shared: protecting those would cost a deep clone on every commit.
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
 * G1.14: a container that declares `reservedChrome` always holds a leaf of the declared kind at
 * child 0. A failure here means an operation deleted or changed that child instead of emptying
 * it.
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
 * G1.6: metadata survives the one-level copy undo makes, so every value is a primitive or an
 * array of primitives. Anything deeper would stay shared by reference with the snapshot and
 * corrupt undo.
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
