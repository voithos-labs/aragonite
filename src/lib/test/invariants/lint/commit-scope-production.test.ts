/**
 * G4.60 — the commit scope is production-live. `invariants/commit-scope.ts` routes the
 * decoration engine's deferral, not only a DEV assertion, so a build-flag guard on its writes
 * would leave `invalidate()` running inside the commit in production while every test stayed
 * green (`esm-env` resolves DEV to true under vitest, so no behavior test can see this).
 */

import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

const SCOPE_FILE = 'invariants/commit-scope.ts';

const BUILD_FLAG_RE = /from\s*['"]esm-env['"]|\bDEV\b/;
/** A write at statement position: anything ahead of it on the line is a guard. */
const UNGUARDED_WRITE_RE = /^\s*inCommit = (?:true|false);$/gm;

interface ScopeDefect {
	defect: string;
}

function findDefects(code: string): ScopeDefect[] {
	const defects: ScopeDefect[] = [];
	if (BUILD_FLAG_RE.test(code)) defects.push({ defect: 'reads a build flag' });
	const writes = code.match(UNGUARDED_WRITE_RE) ?? [];
	if (writes.length !== 2) {
		defects.push({ defect: `${writes.length} unguarded writes, expected 2 (begin and end)` });
	}
	return defects;
}

describe('G4.60 the commit scope is production-live', () => {
	const file = readEditorFile(SCOPE_FILE);

	it('found the scope module to inspect', () => {
		expect(file.code, `${SCOPE_FILE} not found`).toContain('isCommitInProgress');
	});

	it('sets the flag unconditionally, reading no build flag', () => {
		expect(findDefects(file.code)).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('flags the DEV-guarded shape this guard exists to keep out', () => {
		const guarded =
			"import { DEV } from 'esm-env';\n" +
			'let inCommit = false;\n' +
			'export function beginCommit(): void {\n\tif (DEV) inCommit = true;\n}\n' +
			'export function endCommit(): void {\n\tif (DEV) inCommit = false;\n}\n';
		expect(findDefects(guarded)).toEqual([
			{ defect: 'reads a build flag' },
			{ defect: '0 unguarded writes, expected 2 (begin and end)' }
		]);
	});

	it('flags a guard that keeps the writes bare but reads the flag elsewhere', () => {
		const sneaky =
			"import { DEV } from 'esm-env';\n" +
			'let inCommit = false;\n' +
			'export function beginCommit(): void {\n\tinCommit = true;\n}\n' +
			'export function endCommit(): void {\n\tinCommit = false;\n}\n' +
			'export const isCommitInProgress = () => DEV && inCommit;\n';
		expect(findDefects(sneaky)).toEqual([{ defect: 'reads a build flag' }]);
	});

	it('accepts the shipped shape', () => {
		const live =
			'let inCommit = false;\n' +
			'export function beginCommit(): void {\n\tinCommit = true;\n}\n' +
			'export function endCommit(): void {\n\tinCommit = false;\n}\n';
		expect(findDefects(live)).toEqual([]);
	});
});
