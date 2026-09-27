/**
 * G4.26, the length half: a comment block holds at most 2 text lines, a header at most 5
 * (`comment-lines.ts` says which blocks are headers). Each directory's count of blocks over
 * that budget is pinned below and only goes down; no block anywhere runs past 6 lines (7 for
 * a header). A why that needs more lines belongs in a design doc or the commit message.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, ROUTES_SRC } from './scan-source';
import { budgetLines, findCommentBlocks, isOverBudget } from './comment-lines';

const HEADER_CEILING = 7;
const BLOCK_CEILING = 6;

/** Over-budget blocks per directory; a directory not listed holds none.
 *  Lower a number when a sweep lands; never raise one. */
const BASELINE: Record<string, number> = {
	'src/lib': 51,
	'src/lib/components': 311,
	'src/lib/core': 95,
	'src/lib/cursor': 50,
	'src/lib/decorations': 7,
	'src/lib/e2e': 560,
	'src/lib/editor-actions': 60,
	'src/lib/inline-menu': 11,
	'src/lib/invariants': 33,
	'src/lib/plugins': 24,
	'src/lib/reactivity': 34,
	'src/lib/schema': 85,
	'src/lib/search': 5,
	'src/lib/selection': 132,
	'src/lib/styles': 34,
	'src/lib/test': 806,
	'src/lib/testing': 30,
	'src/lib/tree-operations': 92,
	'src/routes': 45
};

interface BudgetHit {
	relPath: string;
	line: number;
	textLines: number;
	limit: number;
}

export function findCeilingHits(relPath: string, code: string): BudgetHit[] {
	return findCommentBlocks(code, relPath)
		.map((b) => ({ b, limit: b.isHeader ? HEADER_CEILING : BLOCK_CEILING }))
		.filter(({ b, limit }) => budgetLines(b) > limit)
		.map(({ b, limit }) => ({ relPath, line: b.line, textLines: budgetLines(b), limit }));
}

export function overBudgetLines(relPath: string, code: string): string[] {
	return findCommentBlocks(code, relPath)
		.filter(isOverBudget)
		.map((b) => `${relPath}:${b.line}`);
}

/** The baseline row a file counts against: the test trees and the demo routes are rows of
 *  their own, and a production file counts against its directory under `src/lib/`. */
export function budgetRow(relPath: string): string {
	const parts = relPath.split('/');
	if (parts[1] === 'routes') return 'src/routes';
	return parts.length > 3 ? parts.slice(0, 3).join('/') : 'src/lib';
}

describe('G4.26 comment blocks stay inside the budget', () => {
	// Stylesheets and the demo harness are in scope: the only drift past the ceilings landed
	// in the two file classes nothing else scans.
	const sources = [
		...collectEditorSources(EDITOR_SRC, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];
	const overByRow = new Map<string, string[]>();
	for (const f of sources) {
		for (const hit of overBudgetLines(f.relPath, f.text)) {
			const row = budgetRow(f.relPath);
			overByRow.set(row, [...(overByRow.get(row) ?? []), hit]);
		}
	}

	it('no comment block under src/lib or src/routes runs past its ceiling', () => {
		const violations = sources.flatMap((f) => findCeilingHits(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	it('no directory holds more over-budget blocks than its baseline', () => {
		const over = [...overByRow]
			.filter(([row, hits]) => hits.length > (BASELINE[row] ?? 0))
			.map(([row, hits]) => ({ row, count: hits.length, baseline: BASELINE[row] ?? 0, hits }));
		expect(over).toEqual([]);
	});

	it('no baseline sits above its count (lower it when a sweep lands)', () => {
		const stale = Object.entries(BASELINE)
			.filter(([row, n]) => n > (overByRow.get(row)?.length ?? 0))
			.map(([row, n]) => ({ row, count: overByRow.get(row)?.length ?? 0, baseline: n }));
		expect(stale).toEqual([]);
	});

	it('the walk still reaches both of the blind spots', () => {
		expect(sources.some((f) => f.relPath.endsWith('.css'))).toBe(true);
		expect(sources.some((f) => f.relPath.startsWith('src/routes/'))).toBe(true);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const run = (n: number) => Array.from({ length: n }, (_, k) => `// line ${k}`).join('\n');
	const docblock = (n: number) => `/**\n${' * h\n'.repeat(n)} */\n`;
	const preamble = '// header\nconst a = 1;\n';

	it('a body block is over past two lines', () => {
		expect(overBudgetLines('s.ts', `${preamble}${run(3)}\nconst b = 2;`)).toEqual(['s.ts:3']);
		expect(overBudgetLines('s.ts', `${preamble}${run(2)}\nconst b = 2;`)).toEqual([]);
	});

	it('a docblock above an exported interface or type is a header', () => {
		expect(overBudgetLines('s.ts', `${preamble}${docblock(5)}export interface X {}`)).toEqual([]);
		expect(overBudgetLines('s.ts', `${preamble}${docblock(5)}export type X = 1;`)).toEqual([]);
		expect(overBudgetLines('s.ts', `${preamble}${docblock(6)}export interface X {}`)).toHaveLength(
			1
		);
		expect(overBudgetLines('s.ts', `${preamble}${docblock(5)}export function f() {}`)).toHaveLength(
			1
		);
	});

	it('a docblock on an export of a published entry point is a header, members included', () => {
		const onExport = `${preamble}${docblock(5)}export function f() {}`;
		const onMember = `${preamble}export interface I {\n\ta(): void;\n${docblock(5).replace(/^/gm, '\t')}\tb(): void;\n}`;
		expect(overBudgetLines('src/lib/editor-props.ts', onExport)).toEqual([]);
		expect(overBudgetLines('src/lib/editor-props.ts', onMember)).toEqual([]);
		expect(overBudgetLines('src/lib/core/x.ts', onMember)).toHaveLength(1);
	});

	it('a section divider is not a text line', () => {
		const divided = `${preamble}// ── Section ──────────\n// a\n// b\nconst b = 2;`;
		expect(overBudgetLines('s.ts', divided)).toEqual([]);
		expect(overBudgetLines('s.ts', `${preamble}// ── Short ──\n${run(3)}`)).toHaveLength(1);
	});

	it('a first block after imports is the header; a mid-file block is not', () => {
		const spec = `import { x } from 'y';\n${docblock(5)}x();`;
		expect(overBudgetLines('s.spec.ts', spec)).toEqual([]);
		const late = `${'const a = 1;\n'.repeat(31)}${docblock(3)}const b = 2;`;
		expect(overBudgetLines('s.ts', late)).toHaveLength(1);
	});

	it('the ceilings stay at six lines and seven for a header', () => {
		expect(findCeilingHits('s.ts', `${preamble}${run(7)}`)).toHaveLength(1);
		expect(findCeilingHits('s.ts', `${preamble}${run(6)}`)).toEqual([]);
		expect(findCeilingHits('s.ts', `${docblock(7)}const a = 1;`)).toEqual([]);
		expect(findCeilingHits('s.ts', `${docblock(8)}const a = 1;`)).toHaveLength(1);
	});

	it('a file counts against its directory, and the test trees and routes are rows', () => {
		expect(budgetRow('src/lib/cursor/walk.ts')).toBe('src/lib/cursor');
		expect(budgetRow('src/lib/index.ts')).toBe('src/lib');
		expect(budgetRow('src/lib/test/cursor/walk.test.ts')).toBe('src/lib/test');
		expect(budgetRow('src/lib/e2e/tests/a.spec.ts')).toBe('src/lib/e2e');
		expect(budgetRow('src/routes/test/editor/+page.svelte')).toBe('src/routes');
	});
});
