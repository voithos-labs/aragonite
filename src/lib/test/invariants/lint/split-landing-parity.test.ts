/**
 * The bypass G1.34 names, closed here: the dev-mode check only fires where a caller calls it, so
 * a split site that puts its caret at `i + 1` never reaches it and reopens the problem, because a
 * first half that reparses into several blocks pushes the second half down and the caret lands on
 * the first half's tail. Every split caller reads the primitive's answer and asserts against it.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** Files that may name `splitNode`, aliased or not. */
const SPLIT_NAMERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts': 'defines the primitive and the guard',
	'src/lib/tree-operations/index.ts': 're-exports both',
	'src/lib/editor-actions/block-edit-core.ts': 'the top-level and container Enter split',
	'src/lib/editor-actions/list-context.ts': 'the list-item Enter split'
};

/** The two that re-export or define rather than land a caret. */
const NON_LANDING = new Set([
	'src/lib/tree-operations/node-ops.ts',
	'src/lib/tree-operations/index.ts'
]);

const namesToken = (token: string) => (file: SourceFile) =>
	new RegExp(`(?<![\\w'"])${token}\\b`).test(stripComments(file.text));

const namesSplit = namesToken('splitNode');

/** What the file calls the primitive: its import alias, or the bare name. */
function splitCallName(code: string): string {
	return /(?<![\w'"])splitNode\s+as\s+(\w+)/.exec(code)?.[1] ?? 'splitNode';
}

function countCalls(code: string, name: string): number {
	return (code.match(new RegExp(`(?<![\\w'"])${name}\\s*\\(`, 'g')) ?? []).length;
}

describe('G1.34 split-landing parity census', () => {
	const sources = collectEditorSources();

	it('the files naming splitNode are the declared ones', () => {
		expect(
			sources
				.filter(namesSplit)
				.map((f) => f.relPath)
				.sort()
		).toEqual(Object.keys(SPLIT_NAMERS).sort());
	});

	it('every split caller reads secondHalfIndex and asserts the landing against it', () => {
		const callers = sources.filter((f) => namesSplit(f) && !NON_LANDING.has(f.relPath));
		expect(callers.length).toBeGreaterThan(0);
		for (const file of callers) {
			expect([file.relPath, namesToken('secondHalfIndex')(file)]).toEqual([file.relPath, true]);
			expect([file.relPath, namesToken('assertSplitLanding')(file)]).toEqual([file.relPath, true]);
		}
	});

	// Per call site, not per file: an allowlisted caller growing a second split whose landing it
	// recomputes would pass a scan done per file, which is the bypass this exists to close.
	it('each split call in a caller carries its own landing assertion', () => {
		for (const file of sources.filter((f) => namesSplit(f) && !NON_LANDING.has(f.relPath))) {
			const code = stripComments(file.text);
			const splits = countCalls(code, splitCallName(code));
			expect([file.relPath, countCalls(code, 'assertSplitLanding') >= splits]).toEqual([
				file.relPath,
				true
			]);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the matcher sees a call and an aliased import, and skips prose', () => {
		const probe = (text: string) => namesSplit({ relPath: 'x', text, code: '' });
		expect(probe('splitNode(parent, i, offset, mode, ref);')).toBe(true);
		expect(probe("import { splitNode as performSplit } from '../tree-operations';")).toBe(true);
		expect(probe('// splitNode derives its own separator')).toBe(false);
		expect(probe('const liveSplitNode = 1;')).toBe(false);
	});

	it('a split caller landing at i + 1 without the guard fails the parity arm', () => {
		const rogue = 'const r = splitNode(p, i, 0);\nscope.refAt(i + 1)?.focus(0);';
		expect(namesSplit({ relPath: 'x', text: rogue, code: '' })).toBe(true);
		expect(countCalls(rogue, 'assertSplitLanding') >= countCalls(rogue, 'splitNode')).toBe(false);
	});

	it('a SECOND unguarded split inside an already-guarded file fails the per-site arm', () => {
		const code =
			"import { splitNode as performSplit } from '../tree-operations';\n" +
			'performSplit(p, i, 0);\nassertSplitLanding(split, split.secondHalfIndex);\n' +
			'performSplit(p, j, 0);\nscope.refAt(j + 1)?.focus(0);';
		expect(splitCallName(code)).toBe('performSplit');
		expect(countCalls(code, 'performSplit')).toBe(2);
		expect(countCalls(code, 'assertSplitLanding') >= 2).toBe(false);
	});
});
