// Fixing up a container after an edit rewrites bytes the spans describe without moving the
// children: a sibling's separating line, a wrapper's position. Those paths drop the spans, so the
// next rebuild with a hint recomputes them.
//
// Miss-analysis: the spans suite built its hint by hand instead of driving the code that makes
// one, so no test ran a write whose fix-up touches a sibling; no simulation typed twice into a
// container holding a blank child; and G1.1, the assumed backstop, only sees the node after a
// commit rebuild healed it, the class G1.38 now catches.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { dropChildSpans } from '$lib/schema/child-spans';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath } from '$lib/tree-operations/unshare';
import { rebuildUnsharedChain } from '$lib/tree-operations/chain-rebuild';
import { updateNodeContent } from '$lib/tree-operations/content-write';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';

// The first keystroke fills in the spans and the second one uses them, which is why a single
// keypress never showed this.
describe('a settle between two keystrokes', () => {
	it('creates the separator a blank-fill must supply the follower', async () => {
		const h = makeNestedHarness('> a\n>\n>\n> c\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'aa\n', 1, 2);
		expect(serialize(h.deps.doc)).toBe('> aa\n>\n>\n> c\n');
		await h.bundle.blockEdit.updateBlockContent(1, 'x\n', 0, 1);
		expect(serialize(h.deps.doc)).toBe('> aa\n>\n> x\n>\n> c\n');
	});

	it('retires the separator a blanked child hands back', async () => {
		const h = makeNestedHarness('> a\n>\n> c\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'aa\n', 1, 2);
		expect(serialize(h.deps.doc)).toBe('> aa\n>\n> c\n');
		await h.bundle.blockEdit.updateBlockContent(0, '\n', 2, 0);
		expect(serialize(h.deps.doc)).toBe('>\n> c\n');
	});

	it('leaves bytes that reload as the block count the tree holds', async () => {
		const h = makeNestedHarness('> a\n>\n>\n> c\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'aa\n', 1, 2);
		await h.bundle.blockEdit.updateBlockContent(1, 'x\n', 0, 1);
		const reloaded = parse(serialize(h.deps.doc)).children[0].children!.length;
		expect(reloaded).toBe(h.deps.doc.children[0].children!.length);
	});
});

// ── Breadth ──────────────────────────────────────────────────────────────────

const SOURCES = [
	'> a\n>\n> c\n',
	'> a\n>\n>\n> c\n',
	'> a\n>\n> b\n>\n> c\n',
	'> a\n> b\n> c\n',
	'> a\n>\n>\n>\n> c\n',
	'> # h\n>\n> body\n>\n> tail\n',
	'- item\n\n  body\n\n  tail\n',
	'- one\n- two\n- three\n',
	'1. one\n\n   body\n\n   tail\n',
	'- [ ] task\n\n  body\n',
	'> - a\n> - b\n',
	'- a\n  - b\n  - c\n'
];
const TEXTS = ['', 'x', 'x\n', '\n', 'x\ny\n'];

function fullRebuildRawOf(node: CstNode): string {
	const copy = {
		...node,
		children: node.children!.map((child) => ({ ...child })),
		childSpans: undefined
	} as CstNode;
	getBlockKindDescriptor(copy.kind).rebuildRaw!(copy);
	return copy.raw;
}

/** `editor-actions/container-edit.ts` `withUnsharedSpine`, minus the component layer. */
function typeInto(doc: ReturnType<typeof parse>, path: number[], text: string): CstNode | null {
	const sharing = createSharingState();
	const chain = ensureUnsharedPath(doc, path, sharing);
	if (chain.length !== path.length) return null;
	const leafPreviousRaw = chain[chain.length - 1]?.raw;
	const scope = chain[path.length - 2];
	if (!scope?.children) return null;
	const settled = updateNodeContent(
		{ children: scope.children, ownerKind: scope.kind, owner: scope, lineEnding: '\n' },
		path[path.length - 1],
		text,
		undefined,
		sharing
	);
	if (settled.change.op !== 'noop') dropChildSpans(scope);
	rebuildUnsharedChain(doc, chain, sharing, [], undefined, { path, leafPreviousRaw });
	return scope;
}

function childPaths(node: CstNode, prefix: number[], out: number[][]): void {
	for (let i = 0; i < (node.children?.length ?? 0); i++) {
		out.push([...prefix, i]);
		childPaths(node.children![i], [...prefix, i], out);
	}
}

describe('the hinted rebuild after a real settle', () => {
	it('writes the bytes a full rebuild would, for every child of every container', () => {
		const divergences: string[] = [];
		for (const source of SOURCES) {
			const shape = parse(source);
			const paths: number[][] = [];
			for (let i = 0; i < shape.children.length; i++) {
				paths.push([i]);
				childPaths(shape.children[i], [i], paths);
			}
			for (const text of TEXTS) {
				for (const path of paths) {
					if (path.length < 2) continue;
					const doc = parse(source);
					const seed = ensureUnsharedPath(doc, path, createSharingState());
					if (seed.length !== path.length) continue;
					rebuildUnsharedChain(doc, seed, createSharingState(), [], undefined);
					const scope = typeInto(doc, path, text);
					if (!scope) continue;
					const full = fullRebuildRawOf(scope);
					if (scope.raw !== full) {
						divergences.push(
							`${JSON.stringify(source)} path=[${path}] text=${JSON.stringify(text)} ` +
								`hinted=${JSON.stringify(scope.raw)} full=${JSON.stringify(full)}`
						);
					}
				}
			}
		}
		expect(divergences).toEqual([]);
	});
});

// ── The commit scope ─────────────────────────────────────────────────────────

// The other half of dropping the spans: a commit's splice moves every region after it, and the
// next keystroke uses the spans it left. The container's raw and its reparse are the check.
describe('a keystroke after a structural commit in the same container', () => {
	it('writes bytes the container still reloads as its own children', async () => {
		const h = makeNestedHarness('> one\n>\n> two\n>\n> three\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'one!\n', 4, 5);
		await h.bundle.blockEdit.splitBlock(1, 3);
		await h.bundle.blockEdit.updateBlockContent(0, 'one!?\n', 5, 6);

		const quote = h.deps.doc.children[0];
		expect(quote.raw).toBe(fullRebuildRawOf(quote));
		expect(parse(serialize(h.deps.doc)).children[0].children!.length).toBe(quote.children!.length);
	});

	it('writes bytes a delete left behind', async () => {
		const h = makeNestedHarness('> one\n>\n> two\n>\n> three\n', { index: 0 });
		await h.bundle.blockEdit.updateBlockContent(0, 'one!\n', 4, 5);
		await h.bundle.blockEdit.deleteBlock(1);
		await h.bundle.blockEdit.updateBlockContent(0, 'one!?\n', 5, 6);

		const quote = h.deps.doc.children[0];
		expect(quote.raw).toBe(fullRebuildRawOf(quote));
	});
});
