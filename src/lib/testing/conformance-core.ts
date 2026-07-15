/**
 * Shared plumbing for the conformance kits — the runner-agnostic assertion
 * primitives and CST tree walks both `container-conformance.ts` (the G4.3
 * container-structural cells) and `kind-conformance.ts` (the generic per-kind
 * closure battery) sit on.
 *
 * Runner-agnostic on purpose: `aragonite/testing` is imported INTO an author's
 * own test case, so a failure is a plain thrown `Error` — reported correctly by
 * Vitest, Jest and `node:test` alike, with no runner import forced on a suite
 * reaching for one seam alone.
 */

import type { AnyBlockKind, CstNode, Document } from '../core/nodes';
import { parse } from '../core/parser';

// ── Coverage vocabulary ──────────────────────────────────────────────────────

/**
 * How a cell is covered. `assert` runs the real check; `exempt` means the
 * invariant has nothing to bite on; `boundary` means asserting it would need
 * something headless code cannot reach (a mounted component, a DOM, the browser
 * sweep). Both non-assert modes carry a substantive reason — never a silent skip.
 */
export type ConformanceCoverage =
	| { mode: 'assert' }
	| { mode: 'exempt'; reason: string }
	| { mode: 'boundary'; reason: string };

// ── Assertion kit ────────────────────────────────────────────────────────────

export function fail(message: string): never {
	throw new Error(message);
}

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) fail(message);
}

export function assertIs(actual: unknown, expected: unknown, message: string): void {
	if (!Object.is(actual, expected)) {
		fail(`${message} — expected ${show(expected)}, got ${show(actual)}`);
	}
}

export function assertIndices(
	actual: readonly number[],
	expected: readonly number[],
	message: string
): void {
	if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
		fail(`${message} — expected [${expected}], got [${actual}]`);
	}
}

export function show(value: unknown): string {
	return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** An EXEMPT/BOUNDARY cell must carry a substantive reason — visible, never a silent skip. */
export function assertExemptionDocumented(cell: ConformanceCoverage, label: string): void {
	if (cell.mode === 'assert') {
		fail(`assertExemptionDocumented called on an 'assert' cell: ${label}`);
	}
	assert(cell.reason.length > 20, `${label} ${cell.mode} reason is documented`);
}

// ── Tree walks ───────────────────────────────────────────────────────────────

export function firstChildOfKind(source: string, kind: AnyBlockKind): CstNode {
	const node = parse(source).children[0];
	assertIs(node.kind, kind, `sample's first child is "${kind}"`);
	assert(node.children, 'sample container has children');
	return node;
}

export function nodeAtPath(root: Document | CstNode, path: number[]): CstNode {
	let cur: Document | CstNode = root;
	for (const i of path) {
		assert(cur.children, 'path step has children');
		cur = cur.children[i];
	}
	assert('raw' in cur, 'path resolves to a block node');
	return cur;
}

/** First node of `kind` in a pre-order walk (the kind may be nested below the root). */
export function findFirstOfKind(root: Document | CstNode, kind: AnyBlockKind): CstNode | null {
	for (const child of root.children ?? []) {
		if (child.kind === kind) return child;
		const found = findFirstOfKind(child, kind);
		if (found) return found;
	}
	return null;
}

/** Doc-rooted path of the first node of `kind` in a pre-order walk, or null. */
export function findFirstPathOfKind(root: Document | CstNode, kind: AnyBlockKind): number[] | null {
	const children = root.children ?? [];
	for (let i = 0; i < children.length; i++) {
		if (children[i].kind === kind) return [i];
		const deeper = findFirstPathOfKind(children[i], kind);
		if (deeper) return [i, ...deeper];
	}
	return null;
}

export function pathPassesThroughKind(
	doc: Document,
	leafPath: number[],
	kind: AnyBlockKind
): boolean {
	let cur: Document | CstNode = doc;
	for (let depth = 0; depth < leafPath.length - 1; depth++) {
		cur = cur.children![leafPath[depth]];
		if (cur.kind === kind) return true;
	}
	return false;
}
