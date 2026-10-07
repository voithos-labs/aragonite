/**
 * No module in a published entry barrel's own import closure may import the barrel back (G4.54):
 * a bundler that splits such a cycle across chunks breaks execution order, which only a consumer's
 * bundler sees, since in-repo `#lib` resolves to source.
 */
import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	EDITOR_SRC,
	publishedEntrySources,
	resolveSpecifier
} from './scan-source';
import { SOURCE } from './source-paths';

// Type-only edges erase before bundling, so they cannot put a barrel in a chunk cycle.
const VALUE_REEXPORT = /^\s*(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm;

// ── The module graph ─────────────────────────────────────────────────────────

// Library-scoped, not repo-wide: only the library holds modules a published entry can reach.
function buildGraph(): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	for (const file of collectEditorSources(EDITOR_SRC)) {
		const targets: string[] = [];
		const re = new RegExp(VALUE_REEXPORT.source, VALUE_REEXPORT.flags);
		let match: RegExpExecArray | null;
		while ((match = re.exec(file.code)) !== null) {
			const resolved = resolveSpecifier(file.relPath, match[1]);
			if (resolved !== null) targets.push(resolved);
		}
		graph.set(file.relPath, targets);
	}
	return graph;
}

/** Every `importer → entry` edge reachable from `entry`: empty when the barrel is a dead end. */
function backEdgesInto(graph: Map<string, string[]>, entry: string): string[] {
	const seen = new Set([entry]);
	const stack = [entry];
	const offenders: string[] = [];
	while (stack.length > 0) {
		const from = stack.pop()!;
		for (const to of graph.get(from) ?? []) {
			if (to === entry) {
				offenders.push(`${from} → ${entry}`);
				continue;
			}
			if (seen.has(to)) continue;
			seen.add(to);
			stack.push(to);
		}
	}
	return offenders;
}

// ── The scan ─────────────────────────────────────────────────────────────────

describe('published entry barrels are import sinks', () => {
	const entries = [...publishedEntrySources()].sort();
	const graph = buildGraph();

	it('found the entry points and their import graph', () => {
		expect(entries).toContain(SOURCE.pluginBarrel);
		expect(entries).toContain(SOURCE.publicBarrel);
		expect(graph.get(SOURCE.pluginBarrel)?.length ?? 0).toBeGreaterThan(0);
	});

	it.each(entries)('%s is imported by nothing it imports', (entry) => {
		expect(backEdgesInto(graph, entry), 'modules reaching back into the barrel').toEqual([]);
	});
});

// ── Self-tests (non-vacuity) ─────────────────────────────────────────────────

describe('entry-barrel sink: classifier non-vacuity', () => {
	const entry = SOURCE.pluginBarrel;

	it('reports a back edge however deep in the closure it sits', () => {
		const graph = new Map([
			[entry, ['a.ts']],
			['a.ts', ['b.svelte']],
			['b.svelte', [entry]]
		]);
		expect(backEdgesInto(graph, entry)).toEqual([`b.svelte → ${entry}`]);
	});

	it('passes a cycle that does not close on the entry', () => {
		const graph = new Map([
			[entry, ['a.ts']],
			['a.ts', ['b.ts']],
			['b.ts', ['a.ts']]
		]);
		expect(backEdgesInto(graph, entry)).toEqual([]);
	});
});
