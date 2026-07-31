/**
 * G4.14 — component props reading the CST hold readonly views. A component annotating
 * `node: CstNode` compiles (a mutable is assignable to its readonly view, and the
 * registration boundary in block-component-registry.ts erases prop types), so the type
 * system cannot hold this position and the scan is the channel that catches the drift:
 * every `.svelte` prop naming a node or the document must be typed `NodeView` /
 * `DocumentView` (G1.9, `core/node-views.ts`).
 * The doc-owning root is the sole legitimate mutable holder. Scoped to `.svelte`, since
 * the same regex over `.ts` would flag owned mutables that core layers legitimately pass.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

// A prop annotation `node`/`document`/`doc` (optional) typed as the mutable
// `CstNode`/`Document`. `\bDocument\b` excludes `DocumentView`; `CstNode`
// excludes `NodeView` — so the view annotations pass clean.
const MUTABLE_NODE_PROP_RE = /\b(node|document|doc)\??\s*:\s*(CstNode|Document)\b/;

// The doc-owning root is the sole legitimate mutable holder; everything else reads views.
const ALLOWED_HOLDER = 'src/lib/components/Editor.svelte';

interface PropHit {
	relPath: string;
}

function findMutablePropHits(relPath: string, code: string): PropHit[] {
	const re = new RegExp(MUTABLE_NODE_PROP_RE.source, 'g');
	const hits: PropHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('G4.14 readonly-view prop annotation parity source-scan', () => {
	const sources = collectEditorSources().filter((f) => f.relPath.endsWith('.svelte'));

	it('inspected at least one component source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('only the doc-owning root annotates a mutable node/document prop', () => {
		const violations = sources
			.flatMap((f) => findMutablePropHits(f.relPath, f.code))
			.filter((h) => h.relPath !== ALLOWED_HOLDER);
		expect(
			violations,
			'component props reading the CST must be typed NodeView/DocumentView (readonly views, G1.9); ' +
				'only the doc-owning root (Editor.svelte) holds a mutable Document. Retype the prop to a view.'
		).toEqual([]);
	});

	// ── Non-vacuity guards ──────────────────────────────────────────────────

	// Proves the pattern matches real source and that the allowlist is load-bearing.
	it('finds the doc-owning root as the sole mutable-prop holder', () => {
		const holders = sources.filter((f) => MUTABLE_NODE_PROP_RE.test(f.code));
		expect(holders.map((f) => f.relPath)).toEqual([ALLOWED_HOLDER]);
	});

	it('matcher flags a synthetic mutable annotation on each governed prop', () => {
		expect(findMutablePropHits('x.svelte', 'let { node }: { node: CstNode } = $props();')).toEqual([
			{ relPath: 'x.svelte' }
		]);
		expect(findMutablePropHits('x.svelte', 'document?: Document;')).toEqual([
			{ relPath: 'x.svelte' }
		]);
		expect(findMutablePropHits('x.svelte', 'doc: Document;')).toEqual([{ relPath: 'x.svelte' }]);
	});

	it('matcher ignores the readonly-view annotations', () => {
		const views =
			'let { node, index }: { node: NodeView; index: number } = $props();\n' +
			'document?: DocumentView;';
		expect(findMutablePropHits('x.svelte', views)).toEqual([]);
	});
});
