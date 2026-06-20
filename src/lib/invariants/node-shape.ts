import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { concatChildren } from '../core/serializer';
import { getBlockKindDescriptor, type MergeRole } from '../schema/block-kind-descriptor';
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

// ── G1.6: clone-safe metadata ─────────────────────────────────────────────────

/**
 * G1.6 — metadata survives the one-level undo clone (`cloneMetadata` copies
 * `Array.isArray(v) ? [...v] : v`). Every value must be a primitive or an array
 * of primitives; a nested object or array-of-objects would be shared by
 * reference with the snapshot and corrupt undo.
 */
export function checkCloneSafeMetadata(node: CstNode): InvariantViolation | null {
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
