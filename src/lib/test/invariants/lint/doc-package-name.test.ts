/**
 * G4.55: docs name the package `@voithos-labs/aragonite`, never the bare `aragonite`, which
 * belongs to a stranger's npm package. `docs/changelog/` is exempt, recording what shipped
 * under the name of the day.
 *
 * Miss-analysis: the scope rename matched quoted and backticked forms only, so two survivors in
 * a plain code block went unseen twice, and no gate anywhere reads a package name.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');

/** Records of what shipped, under whatever the package was called then. */
const EXEMPT_DIRS = ['docs/changelog'];

/** `aragonite/<subpath>` with no scope in front of it, which is always the wrong package. */
const BARE_SUBPATH = /(^|[^\w/-])aragonite\/(plugin|plugins|testing|styles)\b/;

/** `npm install aragonite`, in any of the spellings a doc reaches for. */
const BARE_INSTALL = /\bnpm (?:install|i|add) +aragonite(?![\w/-])/;

function markdownFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		const rel = path.relative(ROOT, full).replace(/\\/g, '/');
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || rel.startsWith('docs/superpowers')) continue;
			markdownFiles(full, out);
		} else if (entry.name.endsWith('.md')) {
			out.push(rel);
		}
	}
	return out;
}

describe('G4.55 docs name the scoped package', () => {
	const files = [...markdownFiles(path.join(ROOT, 'docs')), 'README.md', 'CONTRIBUTING.md'].filter(
		(f) => !EXEMPT_DIRS.some((d) => f.startsWith(d))
	);

	it('scans a corpus rather than vacuously passing', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('no doc names a bare `aragonite` subpath or install', () => {
		const offenders: string[] = [];
		for (const file of files) {
			readFileSync(path.join(ROOT, file), 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (BARE_SUBPATH.test(line) || BARE_INSTALL.test(line)) {
						offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
					}
				});
		}
		expect(offenders).toEqual([]);
	});
});
