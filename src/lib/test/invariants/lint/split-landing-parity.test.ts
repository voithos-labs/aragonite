/**
 * Every split caller reads the split primitive's own landing index rather than putting its caret
 * at `i + 1`: a first half that reparses into several blocks pushes the second half down, and the
 * caret lands on the first half's tail (G4.43).
 */

import { describe, it, expect } from 'vitest';
import { callSites, collectEditorSources, type SourceFile } from './scan-source';
import { probeFile } from './file-rule';

/** Files that may name `splitNode`, aliased or not. */
const SPLIT_NAMERS: Record<string, string> = {
	'src/lib/tree-operations/node-ops.ts': 'defines the primitive',
	'src/lib/tree-operations/index.ts': 're-exports it',
	'src/lib/editor-actions/block-edit-core.ts': 'the top-level and container Enter split',
	'src/lib/editor-actions/list-context.ts': 'the list-item Enter split'
};

/** The two that re-export or define rather than land a caret. */
const NON_LANDING = new Set([
	'src/lib/tree-operations/node-ops.ts',
	'src/lib/tree-operations/index.ts'
]);

const namesToken = (token: string) => (file: SourceFile) =>
	new RegExp(`(?<![\\w'"])${token}\\b`).test(file.code);

const namesSplit = namesToken('splitNode');

/** What the file calls the primitive: its import alias, or the bare name. */
function splitCallName(code: string): string {
	return /(?<![\w'"])splitNode\s+as\s+(\w+)/.exec(code)?.[1] ?? 'splitNode';
}

const countCalls = (code: string, name: string): number => callSites(code, name).length;
const countReads = (code: string): number => code.match(/\.secondHalfIndex\b/g)?.length ?? 0;

describe('G4.43 split-landing parity census', () => {
	const sources = collectEditorSources();

	it('the files naming splitNode are the declared ones', () => {
		expect(
			sources
				.filter(namesSplit)
				.map((f) => f.relPath)
				.sort()
		).toEqual(Object.keys(SPLIT_NAMERS).sort());
	});

	// Per call site, not per file: an allowlisted caller growing a second split whose landing it
	// recomputes would pass a scan done per file.
	it('each split call in a caller reads its own secondHalfIndex', () => {
		const callers = sources.filter((f) => namesSplit(f) && !NON_LANDING.has(f.relPath));
		expect(callers.length).toBeGreaterThan(0);
		for (const { relPath, code } of callers) {
			const splits = countCalls(code, splitCallName(code));
			expect([relPath, countReads(code) >= splits]).toEqual([relPath, true]);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the matcher sees a call and an aliased import, and skips prose', () => {
		const probe = (text: string) => namesSplit(probeFile({ relPath: 'x', code: text }));
		expect(probe('splitNode(parent, i, offset, mode, ref);')).toBe(true);
		expect(probe("import { splitNode as performSplit } from '../tree-operations';")).toBe(true);
		expect(probe('// splitNode derives its own separator')).toBe(false);
		expect(probe('const liveSplitNode = 1;')).toBe(false);
	});

	it('a split caller landing at i + 1 fails the parity branch', () => {
		const rogue = 'const r = splitNode(p, i, 0);\nlanding: () => scope.at(i + 1, [], 0)';
		expect(countReads(rogue) >= countCalls(rogue, 'splitNode')).toBe(false);
	});

	it('a second split inside a file that reads one index fails the per-site branch', () => {
		const code =
			"import { splitNode as performSplit } from '../tree-operations';\n" +
			'const a = performSplit(p, i, 0);\nscope.at(a.secondHalfIndex, [], 0);\n' +
			'performSplit(p, j, 0);\nscope.at(j + 1, [], 0);';
		expect(splitCallName(code)).toBe('performSplit');
		expect(countCalls(code, 'performSplit')).toBe(2);
		expect(countReads(code) >= 2).toBe(false);
	});
});
