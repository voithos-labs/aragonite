/**
 * `tree-operations/` is pure CST mutations and the DAG runs one way:
 * `editor-actions -> tree-operations`. A single reverse import made the two a cycle, and
 * every behavioral test passed either way — a cycle is a design defect, not a runtime
 * one, so only a source scan can hold the rule. `components/` is listed with it: an
 * upward import there would put a rendering artifact under a renderer-agnostic layer.
 * Root-level `$lib/*.ts` files are contract leaves, not layers, and stay allowed.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments } from './scan-source';

// No trailing slash: a sibling module file (`tree-operations.ts` beside the
// directory) is the same layer and must be scanned as one.
const GUARDED_LAYER = 'src/lib/tree-operations';
const FORBIDDEN_UPWARD = ['editor-actions', 'components'];

const IMPORT_SOURCE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;

// The layer name must END the specifier or be followed by `/`: requiring the slash let
// the layer's BARREL import through clean. The leading boundary keeps `./my-components` out.
const forbiddenLayer = (layer: string) => new RegExp(`(^|/)${layer}(/|$)`);

/** Upward specifiers a file under the guarded layer reaches for, by directory name. */
function upwardImports(code: string): string[] {
	const hits: string[] = [];
	const re = new RegExp(IMPORT_SOURCE.source, IMPORT_SOURCE.flags);
	let match: RegExpExecArray | null;
	while ((match = re.exec(stripComments(code))) !== null) {
		const spec = match[1] ?? match[2];
		if (FORBIDDEN_UPWARD.some((layer) => forbiddenLayer(layer).test(spec))) hits.push(spec);
	}
	return hits;
}

describe('tree-operations imports no layer above it', () => {
	const sources = collectEditorSources();

	it('inspected the guarded layer', () => {
		expect(sources.filter((f) => f.relPath.startsWith(GUARDED_LAYER)).length).toBeGreaterThan(0);
	});

	it('has no upward edge into editor-actions or components', () => {
		const offenders = sources
			.filter((f) => f.relPath.startsWith(GUARDED_LAYER))
			.map((f) => ({ relPath: f.relPath, hits: upwardImports(f.code) }))
			.filter((f) => f.hits.length > 0);

		expect(
			offenders,
			'a pure CST mutation may not reach up a layer — declare what it needs on its own deps interface (paste-deps.ts) and let editor-actions supply it'
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matches the upward shapes', () => {
		expect(upwardImports("import { x } from '../../editor-actions/focus/focus-dispatch';")).toEqual(
			['../../editor-actions/focus/focus-dispatch']
		);
		expect(upwardImports("import X from '$lib/components/BlockList.svelte';")).toEqual([
			'$lib/components/BlockList.svelte'
		]);
		expect(upwardImports("const m = await import('../../editor-actions/deps');")).toEqual([
			'../../editor-actions/deps'
		]);
	});

	it('matches a layer barrel, not just a deep path', () => {
		expect(upwardImports("import { createEditorActions } from '../../editor-actions';")).toEqual([
			'../../editor-actions'
		]);
		expect(upwardImports("import { x } from '$lib/components';")).toEqual(['$lib/components']);
	});

	it('skips same-layer and contract-leaf imports', () => {
		expect(upwardImports("import { CstNode } from '../core/nodes';")).toEqual([]);
		expect(
			upwardImports("import type { CommitMultiScopeArgs } from '../../action-contracts';")
		).toEqual([]);
		expect(upwardImports("import { nodeAt } from './node-ops';")).toEqual([]);
	});

	it('does not fire on a name that merely starts with a forbidden layer', () => {
		expect(upwardImports("import { x } from './my-components';")).toEqual([]);
		expect(upwardImports("import { x } from '../core/components-util';")).toEqual([]);
	});

	it('an import inside a comment cannot trip the scan', () => {
		expect(
			upwardImports("// import { x } from '../../editor-actions/focus';\nconst a = 1;")
		).toEqual([]);
	});
});
