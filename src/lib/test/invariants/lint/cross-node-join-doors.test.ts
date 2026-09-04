/**
 * A leaf's bytes built by concatenating text from more than one source is a JOIN, and every
 * destructive one crosses `cleanJoinedRaw` — live paints no delimiter, so a literal concatenation
 * surfaces the marker runs the join orphaned (live-mode.md § 4.5). The census runs both ways: the
 * cleaner's readers are declared, and so is every other file building such a concatenation, each
 * with the reason it is not a destructive join. `mergeListItemIntoPrevious` shipped outside both
 * because its SIGNATURE could not reach the cleaner, which no one-directional scan can see.
 */

import { describe, it, expect } from 'vitest';
import {
	callsTo,
	collectEditorSources,
	rawAssignments,
	walkCode,
	type SourceFile
} from './scan-source';

/** Every file naming the cleaner, and what it joins. */
const CLEANER_READERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts':
		'defines it, and crosses it from the split cut, the range cut and both merge primitives',
	'src/lib/tree-operations/list/unwrap-merge.ts': 'the list-item merge (M1)',
	'src/lib/selection/range-delete.ts': 'the same-block and cross-block range merges',
	'src/lib/selection/range-delete-ceremony.ts': 'the shared endpoint join',
	'src/lib/components/blocks/text/live-selection-edit.ts': 'the native ranged edit'
};

/**
 * Files whose byte expressions concatenate several sources without being a destructive join,
 * each with the reason. A kind re-emitting its OWN bytes from its own children joins nothing a
 * reader could have been looking at.
 */
const NON_JOIN_CONCATENATIONS: Record<string, string> = {
	'src/lib/plugins/admonitions/github-alert-kind.ts':
		"the alert's own rebuildRaw: its marker meets its own body",
	'src/lib/plugins/mermaid/mermaid-kind.ts': "the mermaid leaf's own rebuildRaw, fence and code",
	'src/lib/tree-operations/list/reconcile-task.ts':
		"moves the task marker between the item's metadata and its own first line — one node's bytes, re-split",
	'src/lib/schema/child-spans.ts':
		"a container splicing ONE child's region back into its own raw: both surrounding operands are bytes that container already emitted",
	'src/lib/tree-operations/paste/container-match.ts':
		'a paste INSERTS between the target’s own halves; its delete half, the one place a cut can strand a run, is `preDelete` and crosses `cutRangeFromDisplay`'
};

/** Operand names that terminate a line rather than contribute a source's bytes. */
const TERMINATOR = /(ending|Ending|suffix|Suffix|prefix|Prefix|trivia|Trivia)\b/;

/** Top-level `+` operands of `expr`, brackets and every literal respected. */
function plusOperands(expr: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	walkCode(expr, 0, (ch, i) => {
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') depth--;
		else if (ch === '+' && depth === 0 && expr[i + 1] !== '+' && expr[i - 1] !== '+') {
			parts.push(expr.slice(start, i).trim());
			start = i + 1;
		}
	});
	parts.push(expr.slice(start).trim());
	return parts;
}

/** An operand carrying a source's own bytes: not a literal, not the line's terminator. */
function isSourceOperand(operand: string): boolean {
	if (operand === '' || /^['"`]/.test(operand)) return false;
	return !TERMINATOR.test(operand);
}

const joinsSources = (expr: string): boolean =>
	plusOperands(expr).filter(isSourceOperand).length > 1;

/**
 * Every byte expression a file writes into a leaf: the right-hand side of a `.raw =` statement,
 * and the bytes argument of the two kind-rule readers — the sinks a join reaches through.
 */
function byteExpressions(file: SourceFile): string[] {
	const assignments = rawAssignments([file]).map((w) => w.statement.replace(/^\.raw\s*\+?=/, ''));
	const calls = ['writeOwnRaw', 'normalizeOwnRaw'].flatMap((reader) =>
		callsTo(file.code, reader).map((args) => args)
	);
	return [...assignments, ...calls];
}

describe('cross-node join door census', () => {
	const sources = collectEditorSources();
	const namesCleaner = (file: SourceFile) => /(?<![\w.])cleanJoinedRaw\b/.test(file.code);

	it('the files naming the cleaner are the declared ones', () => {
		expect(
			sources
				.filter(namesCleaner)
				.map((f) => f.relPath)
				.sort(),
			'a new reader of the join cleaner: declare what it joins'
		).toEqual(Object.keys(CLEANER_READERS).sort());
	});

	it('every file concatenating several sources into a leaf’s bytes names the cleaner or is manifested', () => {
		const concatenating = sources
			.filter((file) => byteExpressions(file).some(joinsSources))
			.filter((file) => !namesCleaner(file))
			.map((f) => f.relPath);
		expect(
			concatenating.sort(),
			'a leaf’s bytes are being built from more than one source. A DESTRUCTIVE join crosses ' +
				'`cleanJoinedRaw`, or live surfaces the delimiter runs the join orphaned; anything else ' +
				'joins NON_JOIN_CONCATENATIONS with the reason it is not one'
		).toEqual(Object.keys(NON_JOIN_CONCATENATIONS).sort());
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the operand split sees two sources and skips literals and terminators', () => {
		expect(joinsSources('targetText + currentText + lineEnding')).toBe(true);
		expect(joinsSources("display.slice(0, at) + '\\n'")).toBe(false);
		expect(joinsSources('body + trailingLineEnding(node.raw)')).toBe(false);
		// A `+` inside a call argument or a string is not a top-level operand boundary.
		expect(joinsSources('marker.repeat(a + b) + lineEnding')).toBe(false);
		expect(joinsSources("'| ' + cells.join(' | ')")).toBe(false);
	});

	// Miss-analysis: the private split knew quotes and brackets only, and its own cases fed it
	// nothing else, so a regex quantifier read as two sources meeting with no test to say so.
	it('a quantifier inside a regex literal is not an operand boundary', () => {
		expect(joinsSources('/a+b/.test(head) ? head : head + lineEnding')).toBe(false);
	});

	it('an undeclared file building a join fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/tree-operations/rogue.ts',
			text: 'node.raw = prevText + currText + lineEnding;',
			code: 'node.raw = prevText + currText + lineEnding;'
		};
		expect(byteExpressions(rogue).some(joinsSources)).toBe(true);
	});
});
