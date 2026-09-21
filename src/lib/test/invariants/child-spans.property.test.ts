// The one-child splice against the full rebuild, byte for byte and span for span, over shapes a
// per-child decomposition has to survive: CRLF, blank bodies, empty children, an unterminated
// last child, an inner suffix, wide ordered markers, task markers, non-ASCII. Structural edits
// run through the real entry points, so invalidation is exercised rather than assumed.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { makeBlockNode, type BlockMetadata, type CstNode } from '$lib/core/nodes';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { pushChild, spliceChildren } from '$lib/tree-operations/children';

import { makeNestedHarness } from '$lib/test/harness/editor-actions';
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

/** The same children rebuilt from scratch, the reference every spliced state is compared to. */
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
		spliceChildren(node, at, Math.min(edit.remove, children.length - at), [
			paragraph('', edit.body)
		]);
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

// The real entry point, where the hand-made hint above cannot reach: `updateBlockContent` makes
// its own hint and its fix-up rewrites bytes no hint names. Deep paths (two hinted levels in a
// row) are covered by `test/schema/child-spans-settle.test.ts`, which this does not repeat.
/**
 * Containers whose second write can cross a blank line, which is where the fix-up drops a hint.
 * Every one holds a prose child the harness bundle can address; a nested container's own children
 * belong to the other suite, since this bundle reaches one level.
 */
const SETTLING_SOURCES = [
	'> a\n>\n>\n> c\n',
	'> a\n>\n> b\n>\n> c\n',
	'> - a\n> - b\n>\n> after\n',
	'> # h\n>\n> body\n>\n> tail\n',
	'> a\n>\n> - x\n> - y\n>\n> z\n'
];

/** Containers of plain adjacent leaves: a write into one triggers no fix-up. */
const PLAIN_SOURCES = ['> # a\n> # b\n> # c\n', '> # one\n> body\n'];

const DOOR_RUNS = 300;

const arbDoorCase = fc.record({
	source: fc.oneof(
		{ arbitrary: fc.constantFrom(...SETTLING_SOURCES), weight: 3 },
		{ arbitrary: fc.constantFrom(...PLAIN_SOURCES), weight: 2 }
	),
	seedAt: fc.nat({ max: 5 }),
	at: fc.nat({ max: 5 }),
	// A prose rewrite of a non-blank child crosses no blank line, so its write triggers no fix-up
	// and the spans are kept: the splice case, drawn on purpose rather than stumbled into.
	prose: fc.oneof(
		{ arbitrary: fc.constant(true), weight: 3 },
		{ arbitrary: fc.constant(false), weight: 2 }
	),
	text: fc.constantFrom('x\n', 'a\nb\n', 'xyz\n', '\n', '')
});

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
		// A run where every rewrite declined would prove nothing about the arithmetic.
		expect(splices, 'the splice path never ran').toBeGreaterThan(PARAMS.numRuns / 4);
	});

	it('a write through the shipped entry point leaves the raw a full rebuild would write', async () => {
		let spliced = 0;
		let retired = 0;
		await fc.assert(
			fc.asyncProperty(arbDoorCase, async (c) => {
				const h = makeNestedHarness(c.source, { index: 0 });
				const container = (): CstNode => h.deps.doc.children[0];
				const count = container().children?.length ?? 0;
				if (count === 0) return;

				// Prose leaves only: the content path writes a block's own text, and handing it a
				// container child's bytes is a different gesture with a stale-raw problem of its own.
				const leaves = container()
					.children!.map((child, i) => (child.children ? -1 : i))
					.filter((i) => i >= 0);
				if (leaves.length === 0) return;

				// Writing a child's own bytes back fills the spans without moving anything.
				const seedAt = leaves[c.seedAt % leaves.length];
				await h.bundle.blockEdit.updateBlockContent(seedAt, container().children![seedAt].raw);
				expect(container().raw, 'after the seeding write').toBe(fullRebuildOf(container()).raw);

				const seeded = container().childSpans;
				const targets = c.prose
					? leaves.filter((i) => container().children![i].raw.trim() !== '')
					: leaves;
				if (targets.length === 0) return;
				const at = targets[c.at % targets.length];
				if (at >= (container().children?.length ?? 0)) return;
				const text = c.prose ? 'edited\n' : c.text;
				await h.bundle.blockEdit.updateBlockContent(at, text, 0, text.length);
				if (seeded !== undefined) {
					if (container().childSpans === seeded) spliced++;
					else retired++;
				}
				expect(container().raw, 'after the settling write').toBe(fullRebuildOf(container()).raw);
			}),
			{ numRuns: DOOR_RUNS, seed: PARAMS.seed }
		);
		// Both classes at a rate rather than merely once: drawing the splice path a single time
		// would prove as little as the hand-made case above with a generator gone tame.
		const floor = DOOR_RUNS / 10;
		expect(spliced, 'the entry-point branch barely reaches the splice path').toBeGreaterThan(floor);
		expect(retired, 'the entry-point branch barely reaches a retiring settle').toBeGreaterThan(
			floor
		);
	});
});
