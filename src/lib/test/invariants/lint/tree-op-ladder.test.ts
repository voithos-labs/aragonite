/**
 * The tree-operation files below have a fixed order, and every import between them points down
 * that order (G4.64). A module cycle between two of them can pass every behavioral test, so only
 * a source scan can hold the shape.
 */

import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	EDITOR_SRC,
	importSpecifiers,
	resolveSpecifier
} from './scan-source';
import { SOURCE_DIR } from './source-paths';

/** Lowest level first: a file may import only the levels below its own. */
const LADDER = [
	'node-primitives',
	'unshare',
	'settle',
	'content-write',
	'stored-as',
	'leaf-range',
	'node-ops',
	'chain-rebuild'
] as const;

type Rung = (typeof LADDER)[number];

const LAYER_DIR = SOURCE_DIR.treeOperations;

/** The level a listed file sits at, or -1 for every other file. */
function rungOfFile(relPath: string): number {
	if (!relPath.startsWith(LAYER_DIR) || !relPath.endsWith('.ts')) return -1;
	const name = relPath.slice(LAYER_DIR.length, -'.ts'.length);
	return name.includes('/') ? -1 : LADDER.indexOf(name as Rung);
}

/** The level the file a specifier names sits at, or -1. */
function rungOfSpecifier(relPath: string, spec: string): number {
	return rungOfFile(resolveSpecifier(relPath, spec) ?? '');
}

/** Every specifier in `code` naming a level above `rung`, as `file -> specifier`. */
function upwardEdges(relPath: string, rung: number, code: string): string[] {
	return importSpecifiers(code)
		.filter(({ specifier }) => rungOfSpecifier(relPath, specifier) > rung)
		.map(({ specifier }) => `${relPath} -> ${specifier}`);
}

describe('G4.64 the tree-ops layer order', () => {
	// Library-internal: the order names files under src/lib, so the reference plugins and the
	// consumer example have nothing to model.
	const rungs = collectEditorSources(EDITOR_SRC)
		.map((f) => ({ ...f, rung: rungOfFile(f.relPath) }))
		.filter((f) => f.rung >= 0);

	it('found every inline syntax handler', () => {
		expect(rungs.map((f) => f.rung).sort((a, b) => a - b)).toEqual(LADDER.map((_, i) => i));
	});

	it('no import between the layers points upward', () => {
		const violations = rungs.flatMap((f) => upwardEdges(f.relPath, f.rung, f.code));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const settle = LADDER.indexOf('settle');
	const SETTLE = `${LAYER_DIR}settle.ts`;

	it('names an upward edge, and skips a downward or off-list one', () => {
		expect(upwardEdges(SETTLE, settle, "import { x } from './content-write';")).toEqual([
			`${SETTLE} -> ./content-write`
		]);
		expect(upwardEdges(SETTLE, settle, "import { x } from './unshare';")).toEqual([]);
		expect(upwardEdges(SETTLE, settle, "import { x } from '../core/lines';")).toEqual([]);
		expect(upwardEdges(SETTLE, settle, "import { x } from './list/ordered-markers';")).toEqual([]);
	});

	it('a type-only import and a dynamic import are edges too', () => {
		expect(upwardEdges(SETTLE, settle, "import type { T } from './node-ops';")).toEqual([
			`${SETTLE} -> ./node-ops`
		]);
		expect(
			upwardEdges(SETTLE, settle, "const m = await import('#lib/tree-operations/node-ops.js');")
		).toEqual([`${SETTLE} -> #lib/tree-operations/node-ops.js`]);
	});

	it('an import inside a comment cannot trip the scan', () => {
		expect(upwardEdges(SETTLE, settle, "// import { x } from './node-ops';\nconst a = 1;")).toEqual(
			[]
		);
	});
});
