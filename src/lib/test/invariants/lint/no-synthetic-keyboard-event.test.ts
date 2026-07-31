/**
 * Synthetic `new KeyboardEvent(...)` is banned in editor runtime source: re-firing a key
 * at document.activeElement re-enters a block's onKeyDown, opaque control flow that
 * bypasses the command registry. Scope excludes `test/` and `e2e/`, where fabricating
 * events is how `eventToChord` is exercised. No allowlist: no runtime source has a
 * sanctioned reason to construct one.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources } from './scan-source';

const SYNTHETIC_KEY_EVENT_RE = /new\s+KeyboardEvent\s*\(/;

interface SyntheticHit {
	relPath: string;
}

function findSyntheticHits(relPath: string, code: string): SyntheticHit[] {
	const re = new RegExp(SYNTHETIC_KEY_EVENT_RE.source, 'g');
	const hits: SyntheticHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('no synthetic KeyboardEvent in editor runtime', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no runtime source constructs a KeyboardEvent', () => {
		const violations = sources.flatMap((f) => findSyntheticHits(f.relPath, f.code));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags a synthetic construction', () => {
		expect(findSyntheticHits('synthetic.ts', "new KeyboardEvent('keydown', { key: 'a' })")).toEqual(
			[{ relPath: 'synthetic.ts' }]
		);
		expect(findSyntheticHits('synthetic.ts', 'new  KeyboardEvent (e)')).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
	});

	it('matcher ignores type positions and instanceof checks', () => {
		const benign =
			'function f(e: KeyboardEvent): void {}\n' +
			'if (active instanceof KeyboardEvent) {}\n' +
			'const handler = (e: KeyboardEvent) => e.key;';
		expect(findSyntheticHits('synthetic.ts', benign)).toEqual([]);
	});
});
