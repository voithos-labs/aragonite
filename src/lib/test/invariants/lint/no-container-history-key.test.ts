/**
 * G1.4 — only the editor root may `setContext(HISTORY_KEY, ...)`. A container
 * re-providing it would give descendants a second history actions object, splitting the
 * undo stack (invariants.md G1.4). The runtime guard in nested-actions.ts inspects a
 * fixed key set that cannot contain HISTORY_KEY, so this scan is the only channel that
 * catches a container author's stray provide.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const PROVIDE_HISTORY_KEY_RE = /setContext\s*\(\s*HISTORY_KEY\b/;

// The editor root is the sole legitimate provider; every other site must only
// `getContext` it.
const ALLOWED_PROVIDER = 'src/lib/components/Editor.svelte';

interface ProvideHit {
	relPath: string;
}

function findProvideHits(relPath: string, code: string): ProvideHit[] {
	const re = new RegExp(PROVIDE_HISTORY_KEY_RE.source, 'g');
	const hits: ProvideHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('G1.4 no container provides HISTORY_KEY source-scan', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('only the editor root provides HISTORY_KEY', () => {
		const violations = sources
			.flatMap((f) => findProvideHits(f.relPath, f.code))
			.filter((h) => h.relPath !== ALLOWED_PROVIDER);
		expect(violations).toEqual([]);
	});

	// ── Non-vacuity guards ──────────────────────────────────────────────────

	// Proves the pattern matches real provider code and that the allowlist is load-bearing.
	it('finds the editor-root provider in real source', () => {
		const providers = sources.filter((f) => PROVIDE_HISTORY_KEY_RE.test(f.code));
		expect(providers.map((f) => f.relPath)).toEqual([ALLOWED_PROVIDER]);
	});

	it('matcher flags a synthetic setContext(HISTORY_KEY, ...)', () => {
		expect(findProvideHits('synthetic.ts', 'setContext(HISTORY_KEY, x)')).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
		expect(findProvideHits('synthetic.ts', 'setContext( HISTORY_KEY , bundle.history )')).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
	});

	it('matcher ignores getContext consumers and the symbol declaration', () => {
		const benign =
			'const history = getContext<HistoryActions>(HISTORY_KEY);\n' +
			"export const HISTORY_KEY = Symbol('history-actions');";
		expect(findProvideHits('synthetic.ts', benign)).toEqual([]);
	});
});
