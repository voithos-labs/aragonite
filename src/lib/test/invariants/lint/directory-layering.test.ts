/**
 * Which top-level directory of `src/lib` may import which (G4.122). Production imports are read
 * into a directory graph and held to the edges `directory-layering-baseline.ts` lists, both ways:
 * a new edge fails, and so does a listed edge that no longer exists, so the list only shrinks.
 */

import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	EDITOR_SRC,
	importSpecifiers,
	resolveSpecifier,
	sourceFile,
	type SourceFile
} from './scan-source';
import { SOURCE, SOURCE_DIR } from './source-paths';
import { RUNTIME_EDGES, TYPE_EDGES } from './directory-layering-baseline';

/** The graph node a library path belongs to: its top-level directory, or the root file itself. */
function layerOf(relPath: string): string | null {
	if (!relPath.startsWith(SOURCE_DIR.library)) return null;
	const rest = relPath.slice(SOURCE_DIR.library.length);
	const slash = rest.indexOf('/');
	return slash === -1 ? rest : rest.slice(0, slash);
}

interface LayerGraph {
	/** `from -> to` for every pair with at least one import that loads at runtime. */
	runtime: string[];
	/** `from -> to` for every pair joined only by `import type` or `export type`. */
	typeOnly: string[];
	/** Library imports that name no file, which would otherwise drop out of the graph unseen. */
	unresolved: string[];
}

function layerGraph(sources: SourceFile[]): LayerGraph {
	const runtime = new Set<string>();
	const typed = new Set<string>();
	const unresolved: string[] = [];
	for (const file of sources) {
		const from = layerOf(file.relPath);
		if (from === null) continue;
		for (const { specifier, typeOnly } of importSpecifiers(file.code)) {
			if (!specifier.startsWith('.') && !specifier.startsWith('$lib')) continue;
			const target = resolveSpecifier(file.relPath, specifier);
			if (target === null) {
				unresolved.push(`${file.relPath}: ${specifier}`);
				continue;
			}
			const to = layerOf(target);
			if (to !== null && to !== from) (typeOnly ? typed : runtime).add(`${from} -> ${to}`);
		}
	}
	return {
		runtime: [...runtime].sort(),
		typeOnly: [...typed].filter((edge) => !runtime.has(edge)).sort(),
		unresolved
	};
}

const edge = (from: string, to: string): string => `${layerOf(from)} -> ${layerOf(to)}`;

/** A pure CST mutation never reaches up into the action or the rendering layer. */
const FORBIDDEN = [
	edge(SOURCE_DIR.treeOperations, SOURCE_DIR.editorActions),
	edge(SOURCE_DIR.treeOperations, SOURCE_DIR.components)
];

const lines = (edges: string[]): string => edges.map((e) => `\n  ${e}`).join('');
const missingFrom = (edges: string[], from: readonly string[]): string[] =>
	edges.filter((e) => !from.includes(e));

// ── The gate ─────────────────────────────────────────────────────────────────

describe('G4.122 the directory import graph holds to its baseline', () => {
	const graph = layerGraph(collectEditorSources(EDITOR_SRC));

	it('built the graph from the library', () => {
		expect(graph.runtime.length).toBeGreaterThan(20);
		expect(graph.runtime).toContain(edge(SOURCE_DIR.editorActions, SOURCE_DIR.treeOperations));
	});

	it('resolves every library import to a file', () => {
		expect(graph.unresolved, `imports naming no file:${lines(graph.unresolved)}`).toEqual([]);
	});

	it('adds no runtime edge between directories', () => {
		const added = missingFrom(graph.runtime, RUNTIME_EDGES);
		expect(
			added,
			`new runtime edges: import from a lower directory, or move the shared code down:${lines(added)}`
		).toEqual([]);
	});

	it('adds no type-only edge between directories', () => {
		const added = missingFrom(graph.typeOnly, TYPE_EDGES);
		expect(
			added,
			`new type-only edges: move the shared type down to a directory both sides can import:${lines(added)}`
		).toEqual([]);
	});

	it('every baseline edge still exists, so the baseline only shrinks', () => {
		const gone = [
			...missingFrom([...RUNTIME_EDGES], graph.runtime).map((e) => `${e} (runtime)`),
			...missingFrom([...TYPE_EDGES], graph.typeOnly).map((e) => `${e} (type-only)`)
		];
		expect(gone, `delete these edges from the baseline:${lines(gone)}`).toEqual([]);
	});

	it('no edge runs from tree-operations up into editor-actions or components', () => {
		const held = [...graph.runtime, ...graph.typeOnly, ...RUNTIME_EDGES, ...TYPE_EDGES];
		expect(
			FORBIDDEN.filter((e) => held.includes(e)),
			'a pure CST mutation may not reach up a layer: declare what it needs on its own deps interface (paste-deps.ts) and let editor-actions supply it'
		).toEqual([]);
	});
});

// ── Self-tests (non-vacuity) ─────────────────────────────────────────────────

describe('G4.122 the directory graph reads each import shape', () => {
	const libSpecifier = (relPath: string): string =>
		`$lib/${relPath.slice(SOURCE_DIR.library.length).replace(/\.ts$/, '')}`;
	const from = `${SOURCE_DIR.treeOperations}probe.ts`;
	const graphOf = (code: string) => layerGraph([sourceFile(from, code)]);

	it('names a top-level directory, or a root file as its own node', () => {
		expect(layerOf(SOURCE.settle)).toBe('tree-operations');
		expect(layerOf(SOURCE.envFlags)).toBe('env.ts');
		expect(layerOf(SOURCE.showcaseRoute)).toBeNull();
	});

	it('reads a $lib import, a relative one and a directory barrel', () => {
		expect(graphOf(`import { x } from '${libSpecifier(SOURCE.commands)}';`).runtime).toEqual([
			edge(from, SOURCE.commands)
		]);
		expect(graphOf("import { x } from '../env';").runtime).toEqual([edge(from, SOURCE.envFlags)]);
		expect(graphOf("import { x } from '$lib/editor-actions';").runtime).toEqual([
			edge(from, SOURCE_DIR.editorActions)
		]);
	});

	it('marks an edge type-only until one runtime import joins it', () => {
		const typeImport = `import type { X } from '${libSpecifier(SOURCE.commands)}';`;
		expect(graphOf(typeImport)).toMatchObject({
			runtime: [],
			typeOnly: [edge(from, SOURCE.commands)]
		});
		expect(
			graphOf(`${typeImport}\nimport { y } from '${libSpecifier(SOURCE.keybindings)}';`)
		).toMatchObject({
			runtime: [edge(from, SOURCE.commands)],
			typeOnly: []
		});
	});

	it('skips an import in a comment, a package import and one within the directory', () => {
		const code = [
			"// import { x } from '$lib/editor-actions';",
			"import { tick } from 'svelte';",
			"import { y } from './node-ops';"
		].join('\n');
		expect(graphOf(code)).toEqual({ runtime: [], typeOnly: [], unresolved: [] });
	});

	it('reports an import that names no file', () => {
		expect(graphOf("import { x } from './no-such-module';").unresolved).toEqual([
			`${from}: ./no-such-module`
		]);
	});

	it('flags an edge outside the baseline and spares one inside it', () => {
		const added = (code: string) => missingFrom(graphOf(code).runtime, RUNTIME_EDGES);
		expect(added("import { x } from '$lib/editor-actions';")).toEqual(FORBIDDEN.slice(0, 1));
		expect(added(`import { x } from '${libSpecifier(SOURCE.cstNodes)}';`)).toEqual([]);
	});
});
