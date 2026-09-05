/**
 * G4.26 — comment blocks stay inside the budget: at most 7 text lines for a file's first
 * block (the header), 6 for any other (the stated budget is 1-2 with headers ~5; the slack
 * absorbs legitimate contract prose and leaves the finer register to review). The budget
 * was documented-only and drifted exactly as the enforcement ladder predicts. A why that
 * needs more lines belongs in a design doc, a requirement file, or the commit.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, ROUTES_SRC } from './scan-source';

const HEADER_LIMIT = 7;
const BLOCK_LIMIT = 6;

/** Blocks allowed over budget, each with the reason it is load-bearing where it stands. */
const KNOWN_LONG: Record<string, string> = {};

interface CommentBlock {
	/** 1-based line the block starts on. */
	line: number;
	/** Lines carrying text once comment syntax is stripped. */
	textLines: number;
	isHeader: boolean;
}

interface BudgetHit {
	relPath: string;
	line: number;
	textLines: number;
	limit: number;
}

const BLOCK_OPENERS: [open: string, close: string][] = [
	['/*', '*/'],
	['<!--', '-->']
];

function stripCommentSyntax(line: string): string {
	return line
		.trim()
		.replace(/^\/\*+|^\*+\/?|^\/\/+|^<!--|-->$|\*+\/$/g, '')
		.trim();
}

const HEADER_WINDOW = 30;

export function findCommentBlocks(code: string): CommentBlock[] {
	const lines = code.split('\n');
	const blocks: CommentBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const trimmed = lines[i].trim();
		const opener = BLOCK_OPENERS.find(([open]) => trimmed.startsWith(open));
		if (opener) {
			const start = i;
			let text = 0;
			while (i < lines.length) {
				if (stripCommentSyntax(lines[i]) !== '') text += 1;
				if (lines[i].includes(opener[1])) break;
				i += 1;
			}
			blocks.push({ line: start + 1, textLines: text, isHeader: false });
		} else if (trimmed.startsWith('//')) {
			const start = i;
			let text = 0;
			while (i < lines.length && lines[i].trim().startsWith('//')) {
				if (stripCommentSyntax(lines[i]) !== '') text += 1;
				i += 1;
			}
			i -= 1;
			blocks.push({ line: start + 1, textLines: text, isHeader: false });
		}
		i += 1;
	}
	// The header allowance goes to a file's FIRST block (imports may precede it), within a
	// window that keeps a mid-file block from borrowing it.
	if (blocks.length > 0 && blocks[0].line <= HEADER_WINDOW) blocks[0].isHeader = true;
	return blocks;
}

export function findBudgetHits(relPath: string, code: string): BudgetHit[] {
	return findCommentBlocks(code)
		.map((b) => ({ b, limit: b.isHeader ? HEADER_LIMIT : BLOCK_LIMIT }))
		.filter(({ b, limit }) => b.textLines > limit && !(`${relPath}:${b.line}` in KNOWN_LONG))
		.map(({ b, limit }) => ({ relPath, line: b.line, textLines: b.textLines, limit }));
}

describe('G4.26 comment blocks stay inside the budget', () => {
	// Stylesheets and the demo harness are in scope because they were the blind spots: the
	// only drift past these limits landed in the two file classes nothing else scans.
	const sources = [
		...collectEditorSources(EDITOR_SRC, { includeTests: true, includeStyles: true }),
		...collectEditorSources(ROUTES_SRC, { includeTests: true, includeStyles: true })
	];

	it('no comment block under src/lib or src/routes runs past its limit', () => {
		const violations = sources.flatMap((f) => findBudgetHits(f.relPath, f.text));
		expect(violations).toEqual([]);
	});

	// Losing either widened surface passes the budget assertion silently, which is the state
	// this scan was extended to end.
	it('the walk still reaches both of the blind spots', () => {
		expect(sources.some((f) => f.relPath.endsWith('.css'))).toBe(true);
		expect(sources.some((f) => f.relPath.startsWith('src/routes/'))).toBe(true);
	});

	it('every allowlist entry still names an over-budget block', () => {
		const stale = Object.keys(KNOWN_LONG).filter((key) => {
			const [relPath, line] = [
				key.slice(0, key.lastIndexOf(':')),
				key.slice(key.lastIndexOf(':') + 1)
			];
			const file = sources.find((f) => f.relPath === relPath);
			if (!file) return true;
			const block = findCommentBlocks(file.text).find((b) => String(b.line) === line);
			return !block || block.textLines <= (block.isHeader ? HEADER_LIMIT : BLOCK_LIMIT);
		});
		expect(stale).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('flags a seven-line run, spares six, and allows a header up to seven', () => {
		const run = (n: number) => Array.from({ length: n }, (_, k) => `// line ${k}`).join('\n');
		const preamble = '// header\nconst a = 1;\n';
		expect(findBudgetHits('s.ts', `${preamble}${run(7)}`)).toHaveLength(1);
		expect(findBudgetHits('s.ts', `${preamble}${run(6)}`)).toEqual([]);
		expect(findBudgetHits('s.ts', `/**\n${' * h\n'.repeat(7)} */\nconst a = 1;`)).toEqual([]);
		expect(findBudgetHits('s.ts', `/**\n${' * h\n'.repeat(8)} */\nconst a = 1;`)).toHaveLength(1);
	});

	it('divider lines and blank comment lines carry no text', () => {
		const divider = '// ── Section ──────────\nconst a = 1;';
		expect(findBudgetHits('s.ts', divider)).toEqual([]);
	});

	it('a first block after imports is the header; a mid-file block is not', () => {
		const spec = `import { x } from 'y';\n/**\n${' * h\n'.repeat(7)} */\nx();`;
		expect(findBudgetHits('s.spec.ts', spec)).toEqual([]);
		const late = `${'const a = 1;\n'.repeat(31)}/**\n${' * h\n'.repeat(7)} */\nconst b = 2;`;
		expect(findBudgetHits('s.ts', late)).toHaveLength(1);
	});
});
