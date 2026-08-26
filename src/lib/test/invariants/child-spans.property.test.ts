// The one-child splice against the full rebuild, byte for byte and span for span, over shapes a
// per-child decomposition has to survive: CRLF, blank bodies, empty children, an unterminated
// last child, an inner suffix, wide ordered markers, task markers, non-ASCII. Structural edits
// run through the real doors, so invalidation is exercised rather than assumed.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { makeBlockNode, type BlockMetadata, type CstNode } from '$lib/core/nodes';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { pushChild, spliceChildren } from '$lib/tree-operations/children';
import { freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(717171) } as const;

type ContainerKind = 'list' | 'listItem' | 'blockquote';

const arbBody = fc.constantFrom(
	'text\n',
	'text\r\n',
	'\n',
	'first\nsecond\n',
	'  indented\n',
	'wörld ☃\n',
	'a\n\nb\n',
	'unterminated',
	''
);
const arbTrivia = fc.constantFrom('', '\n', '\r\n');

type Edit =
	| { op: 'rewrite'; index: number; body: string }
	| { op: 'retrivia'; index: number; trivia: string }
	| { op: 'splice'; at: number; remove: number; body: string }
	| { op: 'push'; body: string };

const arbEdit: fc.Arbitrary<Edit> = fc.oneof(
	{
		weight: 6,
		arbitrary: fc.record({
			op: fc.constant('rewrite' as const),
			index: fc.nat({ max: 5 }),
			body: arbBody
		})
	},
	{
		weight: 2,
		arbitrary: fc.record({
			op: fc.constant('retrivia' as const),
			index: fc.nat({ max: 5 }),
			trivia: arbTrivia
		})
	},
	{
		weight: 1,
		arbitrary: fc.record({
			op: fc.constant('splice' as const),
			at: fc.nat({ max: 5 }),
			remove: fc.nat({ max: 2 }),
			body: arbBody
		})
	},
	{ weight: 1, arbitrary: fc.record({ op: fc.constant('push' as const), body: arbBody }) }
);

const arbCase = fc.record({
	kind: fc.constantFrom<ContainerKind>('list', 'listItem', 'blockquote'),
	marker: fc.constantFrom('- ', '* ', '1. ', '10. ', '100. '),
	taskMarker: fc.constantFrom('', '[ ] ', '[x] '),
	innerSuffix: fc.constantFrom('', '\n', '\r\n'),
	bodies: fc.array(arbBody, { minLength: 1, maxLength: 5 }),
	trivia: fc.array(arbTrivia, { maxLength: 5 }),
	edits: fc.array(arbEdit, { minLength: 1, maxLength: 6 })
});

type Case = typeof arbCase extends fc.Arbitrary<infer T> ? T : never;

// ── The tree under test ──────────────────────────────────────────────────────

const paragraph = (leadingTrivia: string, raw: string): CstNode =>
	makeBlockNode({ kind: 'paragraph', leadingTrivia, raw });

function metadataFor(c: Case): BlockMetadata | undefined {
	if (c.kind === 'listItem') {
		return {
			marker: c.marker,
			taskItem: c.taskMarker !== '',
			taskChecked: false,
			taskMarker: c.taskMarker
		};
	}
	return c.kind === 'list' ? { ordered: false } : { quoteDepth: 1 };
}

function buildContainer(c: Case): CstNode {
	return makeBlockNode({
		kind: c.kind,
		leadingTrivia: '',
		raw: '',
		metadata: metadataFor(c),
		children: c.bodies.map((body, i) => paragraph(c.trivia[i] ?? '', body)),
		// The concat kind re-emits children alone, so a suffix there would describe bytes it never writes.
		innerSuffix: c.kind === 'list' ? undefined : c.innerSuffix
	});
}

const rebuilderFor = (node: CstNode) => getBlockKindDescriptor(node.kind).rebuildRaw!;

/** The same children rebuilt from scratch — the oracle every spliced state is compared to. */
function fullRebuildOf(node: CstNode): CstNode {
	const copy = makeBlockNode({
		kind: node.kind,
		leadingTrivia: node.leadingTrivia,
		raw: node.raw,
		metadata: node.metadata,
		children: node.children!.map((child) => ({ ...child })),
		innerSuffix: node.innerSuffix
	});
	rebuilderFor(copy)(copy);
	return copy;
}

const spansOf = (node: CstNode): number[] | undefined =>
	node.childSpans ? Array.from(node.childSpans) : undefined;

function expectAgreesWithFullRebuild(node: CstNode, step: string): void {
	const oracle = fullRebuildOf(node);
	expect(node.raw, `${node.kind} raw after ${step}`).toBe(oracle.raw);
	expect(spansOf(node), `${node.kind} spans after ${step}`).toEqual(spansOf(oracle));
}

// ── Edits ────────────────────────────────────────────────────────────────────

/** True when the rebuild kept the spans array it was handed, which only the splice path does. */
function applyEdit(node: CstNode, edit: Edit): boolean {
	const children = node.children!;
	const rebuild = rebuilderFor(node);
	if (edit.op === 'push') {
		pushChild(node, paragraph('', edit.body));
		rebuild(node);
		return false;
	}
	if (edit.op === 'splice') {
		const at = edit.at % (children.length + 1);
		spliceChildren(node, at, Math.min(edit.remove, children.length - at), paragraph('', edit.body));
		rebuild(node);
		return false;
	}

	const index = edit.index % children.length;
	const child = children[index];
	const previousRaw = child.raw;
	if (edit.op === 'retrivia') child.leadingTrivia = edit.trivia;
	else child.raw = edit.body;

	const spansBefore = node.childSpans;
	rebuild(node, { index, previousRaw });
	return spansBefore !== undefined && node.childSpans === spansBefore;
}

describe('container child spans', () => {
	it('a spliced raw is the raw a full rebuild would have written', () => {
		let splices = 0;
		fc.assert(
			fc.property(arbCase, (c) => {
				const node = buildContainer(c);
				rebuilderFor(node)(node);
				expectAgreesWithFullRebuild(node, 'seed');
				c.edits.forEach((edit, i) => {
					if (applyEdit(node, edit)) splices++;
					expectAgreesWithFullRebuild(node, `edit ${i} (${edit.op})`);
				});
			}),
			PARAMS
		);
		// Non-vacuity: a run where every rewrite declined would prove nothing about the arithmetic.
		expect(splices, 'the splice path never ran').toBeGreaterThan(PARAMS.numRuns / 4);
	});
});
