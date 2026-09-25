/**
 * G4.61: the commit scope is production-live. `invariants/commit-scope.ts` routes the
 * decorations' deferral, not only a DEV assertion, so a build-flag guard on its depth counter
 * would leave `invalidate()` running inside the commit in production while every test stayed
 * green (`esm-env` resolves DEV to true under vitest, so no behavior test can see this).
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

const SCOPE_FILE = 'invariants/commit-scope.ts';

const BUILD_FLAG_RE = /from\s*['"]esm-env['"]|\bDEV\b|\bNODE_ENV\b|import\.meta\.env/;
const DECLARATION_RE = /^\s*(?:let|var|const)\s+depth\b/;
const WRITE_RE = /(?:\+\+|--)\s*depth\b|\bdepth\s*(?:\+\+|--|[-+*]?=(?!=))/;
/** A write at statement position: anything ahead of it on the line is a condition. */
const BARE_WRITE_RE = /^\s*(?:(?:\+\+|--)depth|depth(?:\+\+|--|\s*[-+]?=\s*[^=;]+));\s*$/;

interface ScopeDefect {
	defect: string;
}

function findDefects(code: string): ScopeDefect[] {
	const defects: ScopeDefect[] = [];
	if (BUILD_FLAG_RE.test(code)) defects.push({ defect: 'reads a build flag' });
	const writes = code
		.split('\n')
		.filter((line) => !DECLARATION_RE.test(line) && WRITE_RE.test(line));
	if (writes.length === 0) defects.push({ defect: 'never writes the depth counter' });
	for (const write of writes) {
		if (!BARE_WRITE_RE.test(write)) defects.push({ defect: `conditional write: ${write.trim()}` });
	}
	return defects;
}

describe('G4.61 the commit scope is production-live', () => {
	const file = readEditorFile(SCOPE_FILE);

	it('found the scope module to inspect', () => {
		expect(file.code, `${SCOPE_FILE} not found`).toContain('isCommitInProgress');
	});

	it('writes the depth counter unconditionally, reading no build flag', () => {
		expect(findDefects(file.code)).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('flags the DEV-guarded shape this guard exists to keep out', () => {
		const guarded =
			"import { DEV } from 'esm-env';\n" +
			'let depth = 0;\n' +
			'export function beginCommit(): void {\n\tif (DEV) depth++;\n}\n' +
			'export function endCommit(): void {\n\tif (DEV) depth--;\n}\n';
		expect(findDefects(guarded)).toEqual([
			{ defect: 'reads a build flag' },
			{ defect: 'conditional write: if (DEV) depth++;' },
			{ defect: 'conditional write: if (DEV) depth--;' }
		]);
	});

	it('flags a guard that keeps the writes bare but reads the flag elsewhere', () => {
		const sneaky =
			"import { DEV } from 'esm-env';\n" +
			'let depth = 0;\n' +
			'export function beginCommit(): void {\n\tdepth++;\n}\n' +
			'export function endCommit(): void {\n\tdepth--;\n}\n' +
			'export const isCommitInProgress = () => DEV && depth > 0;\n';
		expect(findDefects(sneaky)).toEqual([{ defect: 'reads a build flag' }]);
	});

	it('flags a module that never writes the counter', () => {
		expect(
			findDefects('let depth = 0;\nexport const isCommitInProgress = () => depth > 0;\n')
		).toEqual([{ defect: 'never writes the depth counter' }]);
	});

	it('accepts the shipped shape, and a bare reset beside it', () => {
		const live =
			'let depth = 0;\n' +
			'export function beginCommit(): void {\n\tdepth++;\n}\n' +
			'export function endCommit(): void {\n\tdepth--;\n}\n' +
			'export function resetCommitScope(): void {\n\tdepth = 0;\n}\n' +
			'export const isCommitInProgress = () => depth > 0;\n';
		expect(findDefects(live)).toEqual([]);
	});
});
