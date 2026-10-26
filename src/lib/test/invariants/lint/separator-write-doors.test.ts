/**
 * Every splice recomputes its blank-line separators through the one shared function, so no module
 * writes a sibling's `leadingTrivia` by hand (syntax-tree.md § Blank lines). The failure is
 * silent: byte round-trip stays green while the document reloads to a different block count, so
 * each exemption states a reason and the next splice site fails the moment it is written.
 */

import { describe, it, expect } from 'vitest';
import { balancedBlock, collectEditorSources, readSource } from './scan-source';
import { describeManifests } from './file-rule';
import { SOURCE } from './source-paths';

/**
 * Files that may assign an existing node's `leadingTrivia`. A `leadingTrivia:` property on a node
 * being created is a fresh node, not a separator anybody relied on, so it is not a write.
 */
const TRIVIA_WRITERS: Record<string, string> = {
	'src/lib/tree-operations/separator-writes.ts': 'the one separator write lives here',
	'src/lib/tree-operations/node-ops.ts':
		'the merge-installed leaf and the reparsed halves carry the slot’s own line',
	'src/lib/tree-operations/content-write.ts':
		'the content write and the container re-derive carry the slot’s line onto the reparse',
	'src/lib/tree-operations/node-primitives.ts': 'the same carry, for a replacement built elsewhere',
	'src/lib/tree-operations/reorder.ts':
		'trivia is positional, so a rotation carries each slot’s line rather than its node’s',
	'src/lib/tree-operations/container-lift.ts':
		'head normalization inside a built subtree (a body head separates from nothing), plus the line that stood between the two lifted halves inside the container moving out with them',
	'src/lib/tree-operations/list/list-builders.ts':
		'head normalization inside a built subtree, per assembled half and per split-built trailing half',
	'src/lib/tree-operations/list/sublist-separator.ts':
		'the settle door for an empty-marker sublist, whose line no splice window can infer: the write lands on the list, the edit two levels below it',
	'src/lib/tree-operations/list/item-partition.ts':
		'same head normalization, per promoted item and the item’s first block, plus the lines a dissolving item’s blocks take where no splice probe can infer them: above each list it leaves, which the paragraph above decides, and above a paragraph under the items before it',
	'src/lib/tree-operations/list/item-moves.ts':
		'a block carried in after a lifted item’s sublist takes the line it needs to read back where it now stands',
	'src/lib/tree-operations/paste/list-break-out.ts': 'head normalization inside the built halves',
	'src/lib/tree-operations/paste/paste-replacement.ts':
		'positional: the before/after slots around an inline paste each answer for their own line',
	'src/lib/editor-actions/list-context.ts': 'head normalization of a split item’s second half',
	'src/lib/tree-operations/chain-rebuild.ts':
		'a node whose bytes read as several blocks carries its line onto the first of them'
};

/** Files that may name one of those functions directly rather than the shared one. */
const HAND_SETTLE_CALLERS: Record<string, string> = {
	'src/lib/tree-operations/index.ts': 're-exports the one the gap-caret mint still needs',
	'src/lib/tree-operations/separator-writes.ts':
		'defines the fill step beside the separator write it makes, for the gap-caret mint',
	'src/lib/tree-operations/list/sublist-separator.ts': 'defines the empty-marker sublist door',
	'src/lib/tree-operations/chain-rebuild.ts':
		'the chain rebuild is where a list rebuilt down to an empty marker becomes visible',
	'src/lib/editor-actions/block-edit-core.ts':
		'the gap-caret paragraph is a block of its own on both sides, which a splice window cannot say: the displaced follower’s line is the join rule’s placed row',
	'src/lib/tree-operations/list/item-moves.ts':
		'the nesting move settles the sublist it creates, and a lift the blocks it carries in'
};

/** The ops whose fix-up runs a step of its own (a content write, a removal, a move), named only
 *  where the mutation reports that kind through `describeEdit`; unreported, the step is skipped. */
const KIND_REPORTING_CALLERS: Record<string, string> = {
	'src/lib/tree-operations/content-write.ts': 'defines `writeNodeContent`',
	'src/lib/tree-operations/node-ops.ts':
		'defines `deleteNode`, and the join whose delete its caller reports',
	'src/lib/tree-operations/reorder.ts': 'defines the move',
	'src/lib/tree-operations/index.ts': 're-exports the delete and the join',
	'src/lib/editor-actions/block-edit-core.ts':
		'the delete, the join and the neighbour delete report `removed`',
	'src/lib/editor-actions/unwrap-strategies.ts': 'the emptied item’s delete reports `removed`',
	'src/lib/editor-actions/reorder-action.ts': 'both moves report `moved`'
};

const writesTrivia = /\.leadingTrivia\s*\+?=(?!=)/;

const namesHandSettle = /(?<![\w'"])(restoreSeparatorOnFill|settleSublistSeparator)\b/;

describeManifests(
	[
		{
			id: 'the files writing a sibling leadingTrivia are the declared ones',
			matches: writesTrivia,
			declared: TRIVIA_WRITERS,
			reason:
				'a splice wrote a separator by hand: settle it through the shared function, or declare why the file must',
			hits: ["node.leadingTrivia = '';", 'children[i].leadingTrivia += lineEnding;'],
			misses: [
				"{ kind: 'paragraph', leadingTrivia: '', raw }",
				"if (node.leadingTrivia === '') return;",
				"// node.leadingTrivia = '' would strand the follower"
			]
		},
		{
			id: 'the files calling a settle entry point by hand are the declared ones',
			matches: namesHandSettle,
			declared: HAND_SETTLE_CALLERS,
			reason:
				'a file names a settle function directly: use the shared one, or declare why it cannot',
			hits: [
				'restoreSeparatorOnFill(parent, i + 1, sharing);',
				"import { settleSublistSeparator } from './list/sublist-separator';"
			],
			misses: ['// restoreSeparatorOnFill gives the line back']
		},
		{
			id: 'G4.208 an op whose fix-up runs a step of its own is called where its kind is reported',
			matches:
				/(?<![\w'"])(writeNodeContent|deleteNode|mergeIntoPrevDeepLeaf|reorderChildrenWithTrivia)\b/,
			declared: KIND_REPORTING_CALLERS,
			reason:
				'the commit runs this op’s own fix-up step only when told: report it through `describeEdit` (`written`, `removed` or `moved`) and declare the file, or write through `updateNodeContent` where no commit settles the body',
			hits: [
				'const { change, written } = writeNodeContent(body, i, write, grammar, sharing);',
				"import { deleteNode as performDelete } from '../tree-operations';",
				'const moved = reorderChildrenWithTrivia(scope.body, from, to, sharing);'
			],
			misses: ['// writeNodeContent leaves the fix-up to the commit', 'const deleteNodeLater = 1;']
		}
	],
	collectEditorSources()
);

// ── The span drop, inside those functions’ own file ───────────────────────

/** A function writing a separator rewrites bytes the owner's child spans describe, so it must drop
 *  those spans (`schema/child-spans.ts`); the lists above fix the files, this one the functions. */
const DOORS_FILE = SOURCE.separatorWrites;

/** The other files writing separators, held to the same rule. */
const CARRY_FILES = [
	SOURCE.nodeOps,
	SOURCE.contentWrite,
	SOURCE.nodePrimitives,
	SOURCE.chainRebuild
];

/** Every `function name(` body in `code`, braces balanced. */
function functionBodies(code: string): { name: string; body: string }[] {
	const out: { name: string; body: string }[] = [];
	const re = /function\s+(\w+)\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(code)) !== null) {
		const brace = code.indexOf('{', re.lastIndex);
		const body = brace === -1 ? null : balancedBlock(code, brace + 1);
		if (body !== null) out.push({ name: match[1], body });
	}
	return out;
}

/** A write to a sibling’s separating line, or to a wrap field the spans do not cover. */
const WRITES_SEPARATOR_BYTES = /(?:\.leadingTrivia|slots\.inner(?:Prefix|Suffix))\s*\+?=(?!=)/;

describe('every separator entry point retires the child spans it invalidates', () => {
	const doors = [DOORS_FILE, ...CARRY_FILES]
		.flatMap((file) => functionBodies(readSource(file).code))
		.filter((fn) => WRITES_SEPARATOR_BYTES.test(fn.body));

	/** The writer in the shared file, which drops the spans first, since a drop below an early
	 *  return is skipped on the paths that take it. */
	const DOORS = ['writeSeparator'];

	it('every named entry point retires the spans first, one red per entry point', () => {
		const bodies = new Map(
			functionBodies(readSource(DOORS_FILE).code).map((fn) => [fn.name, fn.body])
		);
		const forgot = DOORS.filter(
			(name) => !/^\s*retireChildSpans\s*\(/.test(bodies.get(name) ?? '')
		);
		expect(
			forgot,
			'a settle entry point stopped retiring the child spans it invalidates, or retires past a guard'
		).toEqual([]);
		expect(DOORS.filter((name) => !bodies.has(name))).toEqual([]);
	});

	it('found the entry points (not vacuous)', () => {
		expect(doors.map((fn) => fn.name).sort()).toEqual(expect.arrayContaining(DOORS));
	});

	/** Writers that account for the spans some other way, each with its reason: the node is new,
	 *  or a splice changes the child count, refusing a region rewrite. */
	const ANSWERED_ELSEWHERE: Record<string, string> = {
		installMergedLeaf: 'writes the survivor’s line inside a merge splice; the count moves',
		writeParsedContent: 'carries the target’s line onto its own fresh reparse',
		installReplacement: 'carries the line onto the replacement, byte for byte',
		spliceSpill: 'carries the line onto the first block of a splice; the count moves',
		normalizeReplacementTrivia: 'the same carry, for a replacement built elsewhere'
	};

	// A second writer in the shared file could write a shared node or skip the span drop, which the
	// one writer does for every write.
	it('the shared file writes an existing node’s separator through its one writer alone', () => {
		const writers = functionBodies(readSource(DOORS_FILE).code)
			.filter((fn) => WRITES_SEPARATOR_BYTES.test(fn.body))
			.map((fn) => fn.name)
			.filter((name) => !(name in ANSWERED_ELSEWHERE));
		expect(writers.sort()).toEqual([...DOORS].sort());
	});

	it('each one calls the retire, or is answered for elsewhere', () => {
		const missing = doors
			.filter((fn) => !(fn.name in ANSWERED_ELSEWHERE))
			.filter((fn) => !/(?<![\w.])retireChildSpans\s*\(/.test(fn.body))
			.map((fn) => fn.name);
		expect(
			missing,
			'a settle entry point writes separator bytes without retiring the spans that describe them'
		).toEqual([]);
	});

	it('no entry outlives the writer it excuses', () => {
		const names = new Set(doors.map((fn) => fn.name));
		expect(Object.keys(ANSWERED_ELSEWHERE).filter((name) => !names.has(name))).toEqual([]);
	});

	it('the matcher sees both write forms and skips a read', () => {
		const probe = (body: string) => WRITES_SEPARATOR_BYTES.test(body);
		expect(probe("owned.leadingTrivia = '';")).toBe(true);
		expect(probe('slots.innerSuffix = ending;')).toBe(true);
		expect(probe("if (node.leadingTrivia === '') return;")).toBe(false);
	});
});
