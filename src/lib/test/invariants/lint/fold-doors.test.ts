/**
 * G4.355: the chain rebuild pushes a fold in one place, `foldWrite`, which holds the fold to the
 * lines its list spelled (G1.220). A `folds.push` anywhere else is a fold nothing checks.
 */

import { describe, it, expect } from 'vitest';
import { balancedBlock, collectEditorSources, readSource } from './scan-source';
import { SOURCE } from './source-paths';

const PUSH = /\bfolds\.push\s*\(/g;
const DOOR = 'foldWrite';

/** The body of `function name(` in `code`, or null when there is none. */
function bodyOf(code: string, name: string): string | null {
	const at = code.search(new RegExp(`function\\s+${name}\\s*\\(`));
	const brace = at < 0 ? -1 : code.indexOf('{', code.indexOf(')', at));
	return brace < 0 ? null : balancedBlock(code, brace + 1);
}

describe('G4.355: every fold goes through the one push that checks it', () => {
	const door = bodyOf(readSource(SOURCE.chainRebuild).code, DOOR);
	const pushes = collectEditorSources().flatMap((file) =>
		[...file.code.matchAll(PUSH)].map(() => file.relPath)
	);

	it('pushes a fold nowhere but in that function', () => {
		expect(pushes).toEqual([SOURCE.chainRebuild]);
		expect(door?.match(PUSH)).toHaveLength(1);
	});

	it('checks the fold where it pushes it', () => {
		expect(door).toMatch(/assertInvariant\(\s*'fold-keeps-lines'/);
		expect(door).toMatch(/\bcheckFoldKeepsLines\s*\(/);
	});
});
