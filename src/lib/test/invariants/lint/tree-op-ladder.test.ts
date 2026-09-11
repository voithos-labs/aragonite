/**
 * G4.64 — the six files node-ops split into form a ladder, and every import between them points
 * down it. The one module cycle tree-operations ever had (node-ops ↔ unshare) passed every
 * behavioral test, so only a source scan can hold the shape.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC, stripComments } from './scan-source';

/** Lowest rung first: a file may import only the rungs below its own. */
const LADDER = [
	'node-primitives',
	'unshare',
	'settle',
	'content-write',
	'node-ops',
	'chain-rebuild'
] as const;

type Rung = (typeof LADDER)[number];

const LAYER_DIR = 'src/lib/tree-operations/';

const IMPORT_SOURCE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;

/** The rung a file on the ladder sits at, or -1 for every other file. */
function rungOfFile(relPath: string): number {
	if (!relPath.startsWith(LAYER_DIR) || !relPath.endsWith('.ts')) return -1;
	const name = relPath.slice(LAYER_DIR.length, -'.ts'.length);
	return name.includes('/') ? -1 : LADDER.indexOf(name as Rung);
}

/** The rung a specifier names (a sibling `./name`, or a full `tree-operations/name`), or -1. */
function rungOfSpecifier(spec: string): number {
	const name = /^\.\/([\w-]+)$/.exec(spec)?.[1] ?? /\/tree-operations\/([\w-]+)$/.exec(spec)?.[1];
	return name === undefined ? -1 : LADDER.indexOf(name as Rung);
}

/** Every specifier in `text` naming a rung above `rung`, as `file -> specifier`. */
function upwardEdges(relPath: string, rung: number, text: string): string[] {
	const edges: string[] = [];
	const re = new RegExp(IMPORT_SOURCE.source, IMPORT_SOURCE.flags);
	let match: RegExpExecArray | null;
	while ((match = re.exec(stripComments(text))) !== null) {
		const spec = match[1] ?? match[2];
		if (rungOfSpecifier(spec) > rung) edges.push(`${relPath} -> ${spec}`);
	}
	return edges;
}

describe('G4.64 the tree-ops ladder', () => {
	// Library-internal: the ladder names six files under src/lib, so the plugin and consumer
	// stand-ins have nothing to model.
	const rungs = collectEditorSources(EDITOR_SRC)
		.map((f) => ({ ...f, rung: rungOfFile(f.relPath) }))
		.filter((f) => f.rung >= 0);

	it('found every rung', () => {
		expect(rungs.map((f) => f.rung).sort((a, b) => a - b)).toEqual(LADDER.map((_, i) => i));
	});

	it('no import between the rungs points up the ladder', () => {
		const violations = rungs.flatMap((f) => upwardEdges(f.relPath, f.rung, f.text));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const settle = LADDER.indexOf('settle');

	it('names an upward edge, and skips a downward or off-ladder one', () => {
		expect(upwardEdges('settle.ts', settle, "import { x } from './content-write';")).toEqual([
			'settle.ts -> ./content-write'
		]);
		expect(upwardEdges('settle.ts', settle, "import { x } from './unshare';")).toEqual([]);
		expect(upwardEdges('settle.ts', settle, "import { x } from '../core/lines';")).toEqual([]);
		expect(upwardEdges('settle.ts', settle, "import { x } from './list/terminator';")).toEqual([]);
	});

	it('a type-only import and a dynamic import are edges too', () => {
		expect(upwardEdges('settle.ts', settle, "import type { T } from './node-ops';")).toEqual([
			'settle.ts -> ./node-ops'
		]);
		expect(
			upwardEdges('settle.ts', settle, "const m = await import('$lib/tree-operations/node-ops');")
		).toEqual(['settle.ts -> $lib/tree-operations/node-ops']);
	});

	it('an import inside a comment cannot trip the scan', () => {
		expect(
			upwardEdges('settle.ts', settle, "// import { x } from './node-ops';\nconst a = 1;")
		).toEqual([]);
	});
});
