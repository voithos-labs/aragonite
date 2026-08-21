/**
 * G4.54 — a published entry barrel is a sink: no module in its own import closure may
 * import it back. Rollup splits such a re-export cycle across chunks and warns that
 * execution order will break, a hazard only a consumer's bundler sees, because in-repo
 * `$lib` resolves to source and assigns no chunks at all.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { collectEditorSources, EDITOR_SRC } from './scan-source';

const LIB = 'src/lib';
const DIST = './dist/';

// Type-only edges erase before bundling, so they cannot put a barrel in a chunk cycle.
const VALUE_REEXPORT = /^\s*(?:import|export)\s+(?!type\b)[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm;

// ── The published entry points ───────────────────────────────────────────────

/** Derived from package.json `exports`, so a new subpath inherits the rule unasked. */
function entryModules(): string[] {
	const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
	const entries = new Set<string>();
	for (const target of Object.values(pkg.exports ?? {})) {
		const file = typeof target === 'string' ? target : (target as Record<string, string>).default;
		if (typeof file !== 'string' || !file.startsWith(DIST) || !file.endsWith('.js')) continue;
		const source = `${LIB}/${file.slice(DIST.length, -'.js'.length)}.ts`;
		if (existsSync(path.resolve(source))) entries.add(source);
	}
	return [...entries].sort();
}

// ── The module graph ─────────────────────────────────────────────────────────

function resolveSpecifier(fromRelPath: string, specifier: string): string | null {
	let base: string;
	if (specifier === '$lib') base = `${LIB}/index`;
	else if (specifier.startsWith('$lib/')) base = `${LIB}/${specifier.slice('$lib/'.length)}`;
	else if (specifier.startsWith('.'))
		base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelPath), specifier));
	else return null;

	for (const candidate of [base, `${base}.ts`, `${base}.svelte`, `${base}/index.ts`]) {
		if (!candidate.endsWith('.ts') && !candidate.endsWith('.svelte')) continue;
		if (existsSync(path.resolve(candidate))) return candidate;
	}
	return null;
}

// Library-scoped, not repo-wide: only `src/lib` holds modules a published entry can reach.
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

/** Every `importer → entry` edge reachable from `entry` — empty when the barrel is a sink. */
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
	const entries = entryModules();
	const graph = buildGraph();

	it('found the entry points and their import graph', () => {
		expect(entries).toContain(`${LIB}/plugin.ts`);
		expect(entries).toContain(`${LIB}/index.ts`);
		expect(graph.get(`${LIB}/plugin.ts`)?.length ?? 0).toBeGreaterThan(0);
	});

	it.each(entries)('%s is imported by nothing it imports', (entry) => {
		expect(backEdgesInto(graph, entry), 'modules reaching back into the barrel').toEqual([]);
	});
});

// ── Self-tests (non-vacuity) ─────────────────────────────────────────────────

describe('entry-barrel sink — classifier non-vacuity', () => {
	const entry = `${LIB}/plugin.ts`;

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

	it('resolves the specifier spellings the library actually writes', () => {
		expect(resolveSpecifier(`${LIB}/x.ts`, '$lib/plugin')).toBe(`${LIB}/plugin.ts`);
		expect(resolveSpecifier(`${LIB}/x.ts`, '$lib/components/BlockList.svelte')).toBe(
			`${LIB}/components/BlockList.svelte`
		);
		expect(resolveSpecifier(`${LIB}/core/inline/x.ts`, './index')).toBe(
			`${LIB}/core/inline/index.ts`
		);
		expect(resolveSpecifier(`${LIB}/x.ts`, 'svelte')).toBeNull();
	});
});
