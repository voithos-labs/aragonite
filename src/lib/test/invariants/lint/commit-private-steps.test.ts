/**
 * G4.258: the fix-up, the chain rebuild, the open last line, keep-a-block and the fold publish are
 * the commit's own steps, so outside `editor-actions/commit/` and `invariants/` nothing imports
 * them to run (a type import loads nothing). A mutation reaches them through its scope's `own`,
 * `writeLeaf` and `splice`; each file below says why it still calls one directly.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, importSpecifiers, resolveSpecifier } from './scan-source';

const PRIVATE = [
	'src/lib/tree-operations/fix-up/apply.ts',
	'src/lib/tree-operations/chain-rebuild.ts',
	'src/lib/editor-actions/ancestry-folds.ts'
];
/** The fix-up's own files, which only its writer (`fix-up/apply.ts`) imports. */
const FIX_UP = 'src/lib/tree-operations/fix-up/';
const isPrivate = (path: string): boolean => PRIVATE.includes(path) || path.startsWith(FIX_UP);

const COMMIT_HOMES = ['src/lib/editor-actions/commit/', 'src/lib/invariants/'];

/** The files outside the commit that run one of its steps, by the step's file: why, and what has
 *  to land before the import can go. */
const OUTSIDE: Record<string, { imports: string[]; why: string; until: string }> = {
	'src/lib/tree-operations/content-write.ts': {
		imports: ['src/lib/tree-operations/fix-up/apply.ts'],
		why: 'the content write runs its own slot’s fix-up inside the task-marker reconcile, and only the commit names that entry, `updateNodeContent` (G4.75)',
		until:
			'the keystroke drops its trial write and a paste writes its residue through the commit scope, so `updateNodeContent` moves into the commit'
	},
	'src/lib/tree-operations/node-ops.ts': {
		imports: ['src/lib/tree-operations/fix-up/apply.ts'],
		why: 'a split re-reads its second half’s seam where the caret cut it, a position only the split knows',
		until:
			'the commit’s fix-up can follow the seam into the new list item a split moves its second half to'
	},
	'src/lib/editor-actions/search-replace.ts': {
		imports: ['src/lib/tree-operations/chain-rebuild.ts'],
		why: 'replace-all rebuilds a private clone before its commits',
		until: 'replace-all writes each matched leaf through one commit’s `writeLeaf`'
	},
	'src/lib/testing/container-conformance.ts': {
		imports: [
			'src/lib/tree-operations/chain-rebuild.ts',
			'src/lib/tree-operations/fix-up/apply.ts'
		],
		why: 'the published kit checks a plugin’s `rebuildRaw` alone, driving the rebuild and the last-line walk outside any commit',
		until: 'never: the kit tests a plugin’s rebuild with no editor around it'
	}
};

const RULE =
	'a file runs one of the commit’s own steps: write through the commit scope (`own`, `writeLeaf`, `splice`) instead, or add it to OUTSIDE with the reason it cannot';

/** Every runtime import of a private step, as `importer -> step`. */
function privateImports(): string[] {
	const found: string[] = [];
	for (const file of collectEditorSources()) {
		if (isPrivate(file.relPath)) continue;
		if (COMMIT_HOMES.some((home) => file.relPath.startsWith(home))) continue;
		for (const { specifier, typeOnly } of importSpecifiers(file.code)) {
			if (typeOnly) continue;
			const target = resolveSpecifier(file.relPath, specifier);
			if (target && isPrivate(target)) found.push(`${file.relPath} -> ${target}`);
		}
	}
	return [...new Set(found)];
}

describe('G4.258 the commit’s own steps are imported only by the commit', () => {
	const found = privateImports();
	const declared = Object.entries(OUTSIDE).flatMap(([file, { imports }]) =>
		imports.map((step) => `${file} -> ${step}`)
	);

	it('no file outside the commit imports a step it is not declared for', () => {
		expect(
			found.filter((edge) => !declared.includes(edge)),
			RULE
		).toEqual([]);
	});

	it('every declared exception still imports what it declares', () => {
		expect(declared.filter((edge) => !found.includes(edge))).toEqual([]);
	});

	// A step nothing in the commit reaches, even through another step, is dead or misfiled.
	const reached = new Set(
		collectEditorSources()
			.filter((file) => file.relPath.startsWith(COMMIT_HOMES[0]) || isPrivate(file.relPath))
			.flatMap((file) =>
				importSpecifiers(file.code).map((s) => resolveSpecifier(file.relPath, s.specifier))
			)
	);

	it('every private step is one the commit reaches', () => {
		expect(PRIVATE.filter((step) => !reached.has(step))).toEqual([]);
	});
});
