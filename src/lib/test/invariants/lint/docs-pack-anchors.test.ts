/**
 * `scripts/build-docs-pack.mjs` resolves every in-pack `#anchor` against its target doc's headings,
 * so a renamed heading reds `npm run lint` instead of stranding a cross-reference inside the npm
 * tarball, where a reader cannot fall back to searching the repo. This is that reader's
 * non-vacuity half: an empty anchor set, or a parse that finds no fragment at all, would let the
 * gate pass on nothing. Miss-analysis: the gate dropped the fragment before checking, so no test
 * could tell a resolved anchor from an ignored one.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { anchorsOf, headingsOf } from '../../../../../scripts/check-codebase-map.mjs';

const ROOT = path.resolve('.');

// ── The heading index ────────────────────────────────────────────────────────

describe('in-pack anchors — the index', () => {
	const guide = readFileSync(path.join(ROOT, 'docs/guide/plugin-guide.md'), 'utf8');

	it('indexes a real pack doc rather than an empty set', () => {
		expect(anchorsOf(guide).size).toBeGreaterThan(20);
		expect(anchorsOf(guide)).toContain('the-closure-block');
	});

	it('drops the anchor a renamed heading no longer defines', () => {
		const renamed = guide.replace(/^#+ The closure block$/m, '## The closure');
		expect(anchorsOf(renamed).has('the-closure-block')).toBe(false);
		expect(anchorsOf(renamed)).toContain('the-closure');
	});

	// A `# comment` in a shell snippet is no heading, and an anchor resolving against one would
	// name a section the reader lands nowhere near.
	it('mints no anchor from a heading-shaped line inside a fence', () => {
		const fenced = '## Real\n\n```bash\n# install deps\n```\n';
		expect(anchorsOf(fenced)).toContain('real');
		expect(anchorsOf(fenced).has('install-deps')).toBe(false);
	});

	// A `#fragment` means one slug, where the § reader indexes a heading under every spelling a
	// prose citer writes — reusing that set would let an approximation of an anchor resolve.
	it('is the strict half of the § pointer index', () => {
		const heading = '## Merge eligibility: roles, not pairs\n';
		expect(headingsOf(heading)).toContain('roles-not-pairs');
		expect(anchorsOf(heading).has('roles-not-pairs')).toBe(false);
		expect(anchorsOf(heading)).toContain('merge-eligibility-roles-not-pairs');
	});
});

// ── The gate ─────────────────────────────────────────────────────────────────

/** The pack gate's output over a scratch pack, git-initialised so the corpus gate under Gate 1
 *  can ask git for the ignored files and the run reaches its summary line. */
function packGateOutput(docs: Record<string, string>): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'aragonite-pack-'));
	try {
		execFileSync('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' });
		mkdirSync(path.join(dir, 'docs/guide'), { recursive: true });
		for (const [name, body] of Object.entries(docs)) {
			writeFileSync(path.join(dir, 'docs/guide', name), body);
		}
		try {
			return execFileSync('node', [path.join(ROOT, 'scripts/build-docs-pack.mjs')], {
				cwd: dir,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
		} catch (err) {
			const failure = err as { stdout?: string; stderr?: string };
			return `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const DANGLING = 'docs-pack: dangling anchors';

const pack = (anchors: [same: string, cross: string]): Record<string, string> => ({
	'a.md': `# Title\n\n[here](#${anchors[0]}) and [there](b.md#${anchors[1]})\n\n## The new name\n`,
	'b.md': '# Other\n\n## A section\n'
});

describe('in-pack anchors — the gate', () => {
	it('reds on an anchor no heading spells, same doc or across two', () => {
		const output = packGateOutput(pack(['the-old-name', 'the-old-section']));
		expect(output).toContain(DANGLING);
		expect(output).toContain('a.md: #the-old-name');
		expect(output).toContain('a.md: b.md#the-old-section');
	});

	it('passes the same two links once each heading spells them', () => {
		const output = packGateOutput(pack(['the-new-name', 'a-section']));
		// The summary line prints past both gates, so a green here cannot be a crash before Gate 1.
		expect(output).toContain('docs-pack: 2 docs link-closed');
		expect(output).not.toContain(DANGLING);
	});
});
