import { makeBlockNode, metadataOf, type CstNode } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { readBlocks } from '../core/parser';
import { concatChildren } from '../core/serializer';
import { countsCells, getBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { reservedChromeKindOf } from '../schema/reserved-chrome';
import { listRegisteredOpeners, type GrammarView } from '../schema/block-openers';
import { isDirectiveKind } from '../core/directive/registry';
import type { InvariantViolation } from '../assert';

// ── G1.5: category ↔ field legality ──────────────────────────────────────────

/** G1.5: a node's fields match its kind's category. It only forbids, never requires, since a
 *  container can be briefly childless mid-edit. */
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
	// Only a body under the container's own title line can strip a blank into `innerPrefix`
	// (`core/parser.parseContainerBody`); elsewhere a filled field emits a line no parse produces.
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

/** G1.1: a strip container's raw agrees with its children, `strip(raw) === serialize(children)`,
 *  reparsed in the editor's grammar and checked recursively. */
export function checkStaleRaw(node: CstNode, grammar: GrammarView): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;

	// Document scope because the check is handed no document position: fragment scope would
	// fire on every legitimate position-scoped node at the top.
	const correspondent = soleCorrespondent(
		readBlocks(node.raw, { grammar, scope: 'document' }).children,
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

/** The one block `node.raw` must reparse to, or undefined: bytes that parse as a following sibling
 *  leave the first block intact. A `listItem`'s raw reparses to a `list` wrapping it alone. */
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

/** Checks this level, then recurses: a child whose own raw and children disagree can still leave
 *  its parent's joined bytes matching. */
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

/** G1.12: G1.1's staleness check for opaque containers. Raw that stops reparsing to one block of
 *  this kind fires only when the parser can recognize the kind at all. */
export function checkOpaqueStaleRaw(
	node: CstNode,
	grammar: GrammarView
): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'opaque') return null;

	// Document scope for the same reason as G1.1: the node arrives without its document
	// position, and fragment scope would fire on a legitimate position-scoped node.
	const blocks = readBlocks(node.raw, { grammar, scope: 'document' }).children;
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

/** Whether `readBlocks(raw)` can produce this kind: it owns a block opener, or it is a directive
 *  the shared `:::` opener recognizes. */
function hasStandaloneRecognizer(kind: CstNode['kind']): boolean {
	return listRegisteredOpeners().some((o) => o.kind === kind) || isDirectiveKind(kind);
}

/** The same check with a reserved title child, whose bytes sit in the opener line: the live tree
 *  may hold a blank after it, so the title compares by position and the body as one unit. */
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

/** G1.13: a plugin's `rebuildRaw` gives the same bytes every time for the same state, which G1.12's
 *  single reparse relies on. The two trial runs compare to each other, never to `node.raw`. */
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

/** `rebuildRaw` may write only `raw`, so the trial run copies the children array and metadata; the
 *  child nodes stay shared, since protecting them would cost a deep clone per commit. */
function probeRebuild(node: CstNode, rebuildRaw: (probe: CstNode) => void): string {
	const probe = { ...node };
	if (probe.children) probe.children = [...probe.children];
	if (probe.metadata) probe.metadata = { ...probe.metadata };
	rebuildRaw(probe);
	return probe.raw;
}

// ── G1.14: reserved-chrome slot ───────────────────────────────────────────────

/** G1.14: a container declaring `reservedChrome` holds a leaf of that kind at child 0; a failure
 *  means an operation deleted or replaced that child instead of emptying it. */
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

/** G1.6: metadata survives undo's one-level copy, so every value is a primitive or an array of
 *  primitives; anything deeper would stay shared with the snapshot and corrupt undo. */
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

// ── G1.42: a list item says what its reload reads ─────────────────────────────

/** G1.42: every list item under `node` holds the checkbox a reload of `node`'s own bytes gives it,
 *  and a to-do the reload's block kinds too. Dev only: it reparses the touched node. */
export function checkTaskMarkerSlot(
	node: NodeView,
	grammar: GrammarView
): InvariantViolation | null {
	if (!holdsListItem(node)) return null;
	const reread = readBlocks(node.raw, { grammar, scope: 'fragment' }).children;
	const reloaded =
		node.kind === 'listItem' ? soleItem(reread) : reread.length === 1 ? reread[0] : null;
	return reloaded ? itemDrift(node, reloaded) : null;
}

/** The first list item whose checkbox or first block kind differs between the two trees, walked
 *  together only where they have the same shape (other drift is another check's). */
function itemDrift(tree: NodeView, reload: NodeView): InvariantViolation | null {
	if (tree.kind === 'listItem' && reload.kind === 'listItem') {
		const task = metadataOf(tree, 'listItem')?.taskItem === true;
		const reloadTask = metadataOf(reload, 'listItem')?.taskItem === true;
		const blocks = kindsOf(tree);
		const reloadBlocks = kindsOf(reload);
		// A to-do's blocks are compared whole; a plain item's block drift is no checkbox question.
		if (task !== reloadTask || (task && blocks !== reloadBlocks)) {
			return {
				code: 'task-marker-slot',
				message: `a list item holds ${task ? 'a' : 'no'} checkbox before [${blocks}], where its reload reads ${reloadTask ? 'a' : 'no'} checkbox before [${reloadBlocks}]`,
				detail: { taskItem: task, blocks, reloadTaskItem: reloadTask, reloadBlocks, raw: tree.raw }
			};
		}
	}
	const children = tree.children ?? [];
	const reloadChildren = reload.children ?? [];
	if (countsCells(tree) || children.length !== reloadChildren.length) return null;
	for (let i = 0; i < children.length; i++) {
		if (children[i].kind !== reloadChildren[i].kind) continue;
		const found = itemDrift(children[i], reloadChildren[i]);
		if (found) return found;
	}
	return null;
}

function kindsOf(node: NodeView): string {
	return (node.children ?? []).map((child) => child.kind).join(', ');
}

function holdsListItem(node: NodeView): boolean {
	if (node.kind === 'listItem') return true;
	if (countsCells(node)) return false;
	return (node.children ?? []).some(holdsListItem);
}

function soleItem(blocks: readonly NodeView[]): NodeView | null {
	const list = blocks.length === 1 && blocks[0].kind === 'list' ? blocks[0] : null;
	return list?.children?.length === 1 ? list.children[0] : null;
}
