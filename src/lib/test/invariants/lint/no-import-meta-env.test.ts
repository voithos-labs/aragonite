/**
 * G4.25 — nothing under `src/lib` reads the `import.meta` env object. It is a Vite-only
 * extension: outside a Vite bundle the object is undefined, so a module-scope read throws at
 * import time and the library will not load at all. Toolchain flags come from `esm-env`,
 * whose export conditions every bundler resolves. The whole tree, tests included, because
 * `svelte-package` copies and inspects all of it. Library-scoped rather than repo-wide: the
 * reference plugins and the consumer example are Vite APPS, where the read is legitimate.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, EDITOR_SRC } from './scan-source';

const ENV_READ_RE = /import\s*\.\s*meta\s*\.\s*env\b/;

/** Spelled in parts, since this file is in the scan's own scope — and `svelte-package`
 *  reads the contiguous token too, so a literal fixture would trip the very warning
 *  this guard exists to keep silent. */
const envRead = (separator: string) => ['import', 'meta', 'env'].join(separator);

interface EnvHit {
	relPath: string;
}

function findEnvHits(relPath: string, code: string): EnvHit[] {
	const re = new RegExp(ENV_READ_RE.source, 'g');
	const hits: EnvHit[] = [];
	while (re.exec(code) !== null) hits.push({ relPath });
	return hits;
}

describe('G4.25 no Vite env reads under src/lib', () => {
	const sources = collectEditorSources(EDITOR_SRC, { includeTests: true });

	it('inspected the test tree as well as the library', () => {
		expect(sources.some((f) => f.relPath.startsWith('src/lib/test/'))).toBe(true);
		expect(sources.some((f) => !f.relPath.startsWith('src/lib/test/'))).toBe(true);
	});

	it('no file under src/lib reads the Vite env object', () => {
		const violations = sources.flatMap((f) => findEnvHits(f.relPath, f.code));
		expect(violations).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('matcher flags a read however it is spaced', () => {
		expect(findEnvHits('synthetic.ts', `if (${envRead('.')}.DEV) x();`)).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
		expect(findEnvHits('synthetic.ts', `const m = ${envRead(' . ')};`)).toEqual([
			{ relPath: 'synthetic.ts' }
		]);
	});

	it('matcher ignores the standard-ESM sibling esm-env does not replace', () => {
		const benign = 'new URL("./x.json", import.meta.url);\nimport { DEV } from "esm-env";';
		expect(findEnvHits('synthetic.ts', benign)).toEqual([]);
	});
});
