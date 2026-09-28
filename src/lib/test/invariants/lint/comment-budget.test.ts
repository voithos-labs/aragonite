/**
 * G4.26, the length half: a comment block holds at most 2 text lines, a header at most 5
 * (`comment-lines.ts` says which blocks are headers). A why that needs more lines belongs in a
 * design doc or the commit message.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, ROUTES_SRC } from './scan-source';
import { findCommentBlocks, isOverBudget } from './comment-lines';

export function overBudgetLines(relPath: string, code: string): string[] {
	return findCommentBlocks(code, relPath)
		.filter(isOverBudget)
		.map((b) => `${relPath}:${b.line}`);
}

describe('G4.26 comment blocks stay inside the budget', () => {
	// Stylesheets and the demo harness are in scope, since no other scan reads them.
	const sources = [
		...collectEditorSources(EDITOR_SRC, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];

	it('no comment block under src/lib or src/routes runs past its budget', () => {
		expect(sources.flatMap((f) => overBudgetLines(f.relPath, f.text))).toEqual([]);
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

	it('a tool directive under a comment is not a text line', () => {
		const directive = `${preamble}// a
// b
// eslint-disable-next-line no-console
const b = 2;`;
		expect(overBudgetLines('s.ts', directive)).toEqual([]);
	});

	// Miss-analysis: every row wrote its comments on lines of their own, so nothing showed the
	// line reader skipping a comment that trails code.
	it('a comment trailing code is a block of its own', () => {
		const trailing = `${preamble}const b = 2; /* a\n * b\n * c */\nconst c = 3;`;
		expect(overBudgetLines('s.ts', trailing)).toEqual(['s.ts:3']);
		const sideBySide = `${preamble}const b = 2; // a\nconst c = 3; // b\nconst d = 4; // c`;
		expect(overBudgetLines('s.ts', sideBySide)).toEqual([]);
		const above = `${preamble}const b = 2; // a\n// b\n// c\nconst c = 3;`;
		expect(overBudgetLines('s.ts', above)).toEqual([]);
		expect(overBudgetLines('s.ts', above.replace('// c', '// c\n// d'))).toEqual(['s.ts:4']);
	});

	// Miss-analysis: no row put comment syntax inside a string, so nothing showed the line
	// reader budgeting template text.
	it('a comment marker inside a template or string is text', () => {
		expect(overBudgetLines('s.ts', `${preamble}const t = \`\n// x\n// y\n// z\n\`;`)).toEqual([]);
		expect(overBudgetLines('s.ts', `${preamble}const s = '/* x';\n// a\n// b\n// c`)).toEqual([
			's.ts:4'
		]);
	});

	it('a block comment that opens and closes mid-line holds only its own text', () => {
		const blocks = findCommentBlocks(`${preamble}const b = /* a */ 2; /* b */ f();`, 's.ts');
		expect(blocks.slice(1).map((b) => [b.line, b.text])).toEqual([
			[3, ['a']],
			[3, ['b']]
		]);
	});

	it('a stylesheet has no line comments, so a url(//…) is not one', () => {
		const sheet = `/* header */\na {\n\tbackground: url(\n\t\t//x.dev/a.png\n\t);\n}\n`;
		expect(findCommentBlocks(sheet, 's.css').map((b) => b.line)).toEqual([1]);
		const style = `<style>\n\ta { background: url(//x.dev/a.png); }\n</style>`;
		expect(findCommentBlocks(style, 's.svelte')).toEqual([]);
	});

	it('markup holds comments only as <!-- -->, and script only in braces and blocks', () => {
		const markup = [
			'<script lang="ts">\n\t// a\n</script>',
			"<p>\n\tsee https://x.dev\n\t//x.dev and Sam's /* list\n</p>",
			'<a href="https://x.dev" title="t {b /* c */}">x</a>',
			'<!-- d -->\n{f(/* e */)}'
		].join('\n');
		expect(findCommentBlocks(markup, 's.svelte').map((b) => b.text)).toEqual([
			['a'],
			['c'],
			['d'],
			['e']
		]);
	});

	it('a first block after imports is the header; a mid-file block is not', () => {
		const spec = `import { x } from 'y';\n${docblock(5)}x();`;
		expect(overBudgetLines('s.spec.ts', spec)).toEqual([]);
		const late = `${'const a = 1;\n'.repeat(31)}${docblock(3)}const b = 2;`;
		expect(overBudgetLines('s.ts', late)).toHaveLength(1);
		const trailed = `import { x } from 'y'; // a\n${docblock(5)}x();`;
		expect(overBudgetLines('s.spec.ts', trailed)).toEqual([]);
	});
});
