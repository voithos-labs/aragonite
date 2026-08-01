/**
 * G4.25 — the library reads no `import.meta` env object. It is a Vite-only extension:
 * outside a Vite bundle the object is undefined, so a module-scope read throws at import
 * time and the library will not load at all. Toolchain flags come from `esm-env`, whose
 * export conditions every bundler resolves. Library-scoped (`EDITOR_SRC`) rather than
 * repo-wide: the reference plugins and the consumer example are Vite APPS, where it is fine.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC } from './scan-source';

const ENV_READ_RE = /import\s*\.\s*meta\s*\.\s*env\b/;

/** Spelled in parts: `svelte-package` scans every file it copies for the contiguous
 *  token, and would flag this scanner's own fixtures. */
const ENV_READ = ['import', 'meta', 'env'].join('.');

interface EnvHit {
	relPath: string;
}

function findEnvHits(relPath: string, code: string): EnvHit[] {
	const re = new RegExp(ENV_READ_RE.source, 'g');
	const hits: EnvHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('G4.25 no Vite env reads in the library', () => {
	const sources = collectEditorSources(EDITOR_SRC);

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('no library source reads the Vite env object', () => {
		const violations = sources.flatMap((f) => findEnvHits(f.relPath, f.code));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags a read however it is spaced', () => {
		expect(findEnvHits('synthetic.ts', `if (${ENV_READ}.DEV) x();`)).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
		expect(findEnvHits('synthetic.ts', 'const m = import . meta . env ;')).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
	});

	it('matcher ignores the standard-ESM sibling esm-env does not replace', () => {
		const benign = 'new URL("./x.json", import.meta.url);\nimport { DEV } from "esm-env";';
		expect(findEnvHits('synthetic.ts', benign)).toEqual([]);
	});
});
