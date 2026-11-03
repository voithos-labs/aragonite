/**
 * A leaf's bytes built from text of more than one source is a join, and every destructive one
 * goes through `cleanJoinedRaw` (G4.76, `docs/design/live-mode.md` § 4.5). The census runs both
 * ways: files that call the cleaner are declared, and so is every other file building such a
 * concatenation, with the reason it is not a destructive join.
 */

import {
	callsAnywhere,
	callsTo,
	collectEditorSources,
	rawAssignments,
	splitTopLevel,
	type SourceFile
} from './scan-source';
import { describeManifests } from './file-rule';

/** Every file naming the cleaner, and what it joins. */
const CLEANER_READERS: Record<string, string> = {
	'src/lib/tree-operations/leaf-range.ts':
		'defines it, and crosses it from every in-leaf range replace and `joinLeaves`, the merge’s join',
	'src/lib/selection/cross-block/range-delete/range-delete.ts':
		'the same-block and cross-block range merges',
	'src/lib/selection/cross-block/range-delete/range-delete-ceremony.ts': 'the shared endpoint join'
};

/** Every file calling the one join into a leaf, and what it joins. */
const JOIN_INTO_LEAF_CALLERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts': 'defines it; the Backspace and Delete joins call it',
	'src/lib/tree-operations/list/unwrap-merge.ts': 'the list-item merge (M1)'
};

/** Files whose byte expressions concatenate several sources without a destructive join, each with
 *  the reason; a kind re-emitting its own bytes from its own children joins nothing. */
const NON_JOIN_CONCATENATIONS: Record<string, string> = {
	'packages/mermaid/src/mermaid-kind.ts': "the mermaid leaf's own rebuildRaw, fence and code",
	'src/lib/testing/container-conformance.ts':
		'the conformance kit adds a marked line to a fixture leaf to find it after a rebuild: no join',
	'src/lib/tree-operations/list/reconcile-task.ts':
		"moves the task marker between the item's metadata and its own first line — one node's bytes, re-split",
	'src/lib/tree-operations/list/list-builders.ts':
		'a new item writes its opener line from its own indent and marker: one node’s bytes, re-split',
	'src/lib/tree-operations/list/task-paragraph.ts':
		'the first-slot reader gives back the spaces a marker line takes from the bytes it was handed: one write’s bytes, re-split',
	'src/lib/schema/child-spans.ts':
		"a container splicing ONE child's region back into its own raw: both surrounding operands are bytes that container already emitted",
	'src/lib/schema/strip-rebuild.ts':
		'a quote or list item writing its rewritten lines between the head and tail lines it kept: both kept operands are bytes that container already emitted',
	'src/lib/tree-operations/paste/container-match.ts':
		'a paste INSERTS between the target’s own halves; its delete half, the one place a cut can strand a run, is `preDelete`, cut by `replaceRangeInLeaf` before the container routes run',
	'src/lib/selection/cross-block/range-replace.ts':
		'a key typed over a selection across blocks is a range removal, then the character at the caret it left: the removal cleans its join without the typed text in it, a known gap until the range replace carries the text into the join (T18 slice 5)'
};

/** Operand names that terminate a line rather than contribute a source's bytes. */
const TERMINATOR = /(ending|Ending|suffix|Suffix|prefix|Prefix|trivia|Trivia)\b/;

/** An operand carrying a source's own bytes: not a literal, not the line's terminator. */
function isSourceOperand(operand: string): boolean {
	if (operand === '' || /^['"`]/.test(operand)) return false;
	return !TERMINATOR.test(operand);
}

const joinsSources = (expr: string): boolean =>
	splitTopLevel(expr, '+').filter(isSourceOperand).length > 1;

/** The calls whose arguments carry bytes bound for a leaf: the two that apply a kind's rule, the
 *  content write's rule, the leaf write by path, and the container-matching paste's merged leaf. */
const BYTE_WRITERS = [
	'writeOwnRaw',
	'normalizeOwnRaw',
	'legalizeWrite',
	'commitLeafText',
	'writeMergedLeaf'
];

/** Every byte expression a file writes into a leaf: the right-hand side of a `.raw =` statement,
 *  and the arguments of each call in {@link BYTE_WRITERS}, a bare name read through its binding. */
function byteExpressions(file: SourceFile): string[] {
	const assignments = rawAssignments([file]).map((w) => w.statement.replace(/^\.raw\s*\+?=/, ''));
	// A method call counts too: the paste coordinator's leaf write is one.
	const code = file.code.replace(
		new RegExp(`\\.(?=(?:${BYTE_WRITERS.join('|')})\\s*\\()`, 'g'),
		' '
	);
	const calls = BYTE_WRITERS.flatMap((reader) => callsTo(code, reader));
	const bound = calls.flatMap((args) =>
		splitTopLevel(args, ',').flatMap((arg) => bindingOf(file.code, arg.trim()))
	);
	return [...assignments, ...calls, ...bound];
}

/** What a `const` or `let` in `code` binds `name` to, when `name` is a bare identifier. */
function bindingOf(code: string, name: string): string[] {
	if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
	const binding = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*([^;]+);`, 'g');
	return [...code.matchAll(binding)].map((m) => m[1]);
}

const namesCleaner = (file: SourceFile) => /(?<![\w.])cleanJoinedRaw\b/.test(file.code);

describeManifests(
	[
		{
			id: 'the files naming the cleaner are the declared ones',
			matches: namesCleaner,
			declared: CLEANER_READERS,
			reason: 'a new reader of the join cleaner: declare what it joins',
			hits: ['node.raw = cleanJoinedRaw(left, right, reading);'],
			misses: ['// cleanJoinedRaw does the join', 'policy.cleanJoinedRaw(left, right);']
		},
		{
			id: 'the files calling joinIntoLeaf are the declared ones',
			matches: (file) => callsAnywhere(file.code, 'joinIntoLeaf'),
			declared: JOIN_INTO_LEAF_CALLERS,
			reason: 'a new caller of the one join into a leaf: declare what it joins',
			hits: ['const r = joinIntoLeaf(body, [0], next, reading, sharing);'],
			misses: ['const r = rejoinIntoLeafs(body);']
		},
		{
			id: 'every file concatenating several sources into a leaf’s bytes names the cleaner or is declared',
			matches: (file) => byteExpressions(file).some(joinsSources) && !namesCleaner(file),
			declared: NON_JOIN_CONCATENATIONS,
			reason:
				'a leaf’s bytes are being built from more than one source. A destructive join crosses ' +
				'`cleanJoinedRaw`, or live surfaces the delimiter runs the join orphaned; anything else ' +
				'joins NON_JOIN_CONCATENATIONS with the reason it is not one',
			hits: [
				'node.raw = prevText + currText + lineEnding;',
				// Miss-analysis: the scan read only call arguments written in place, so a join bound
				// to a name first, or handed to a method, slipped past it.
				'const text = before + typed + after;\nawait ctx.pasteCoordinator.commitLeafText(path, text, opts);'
			],
			misses: [
				"node.raw = display.slice(0, at) + '\\n';",
				'node.raw = body + trailingLineEnding(node.raw);',
				// A `+` inside a call argument or a string is not a top-level operand boundary.
				'node.raw = marker.repeat(a + b) + lineEnding;',
				"node.raw = '| ' + cells.join(' | ');",
				// Miss-analysis: the private split knew quotes and brackets only, and no case fed it a regex.
				'node.raw = /a+b/.test(head) ? head : head + lineEnding;',
				'node.raw = cleanJoinedRaw(prevText + currText, reading);'
			]
		}
	],
	collectEditorSources()
);
