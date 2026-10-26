/**
 * G4.262: the list fix-up's package (`tree-operations/fix-up/`, its writer and editor host aside)
 * loads at runtime only its own files, the line helpers and the splice helper. It reads Markdown
 * through the host it is handed and returns a patch, so it can neither parse on its own nor write
 * the tree; a type import loads nothing.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, importSpecifiers, resolveSpecifier } from './scan-source';

const FIX_UP = 'src/lib/tree-operations/fix-up/';

/** The package's two edge files: the writer into the tree, and the host over the editor's grammar. */
const EDGES = [`${FIX_UP}apply.ts`, `${FIX_UP}editor-host.ts`];

const ALLOWED = ['src/lib/core/lines.ts', 'src/lib/tree-operations/splice-many.ts'];

const RULE =
	'a fix-up package file loads a module outside the package: ask the host (`fix-up/types.ts :: Host`), or move the write into `fix-up/apply.ts`';

/** Every runtime import of a package file that leaves the package, as `file -> target`. */
function leavingImports(): string[] {
	const found: string[] = [];
	for (const file of collectEditorSources()) {
		if (!file.relPath.startsWith(FIX_UP) || EDGES.includes(file.relPath)) continue;
		for (const { specifier, typeOnly } of importSpecifiers(file.code)) {
			if (typeOnly) continue;
			const target = resolveSpecifier(file.relPath, specifier) ?? specifier;
			if (target.startsWith(FIX_UP) || ALLOWED.includes(target)) continue;
			found.push(`${file.relPath} -> ${target}`);
		}
	}
	return found;
}

describe('G4.262 the fix-up package loads nothing that parses or writes the tree', () => {
	const leaving = leavingImports();
	const files = collectEditorSources().filter(
		(file) => file.relPath.startsWith(FIX_UP) && !EDGES.includes(file.relPath)
	);

	it('no package file imports a module outside the package at runtime', () => {
		expect(leaving, RULE).toEqual([]);
	});

	it('scans the package (not vacuous)', () => {
		expect(files.length).toBeGreaterThan(5);
	});
});
