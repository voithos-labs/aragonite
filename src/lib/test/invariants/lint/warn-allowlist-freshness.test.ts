/**
 * The fail-on-warn gate's allowlist only shrinks. A row waives a tag at a site for the whole
 * run, so a row whose file moved or whose site stopped warming that tag is a hole nothing else
 * would report. Per-run bidirectionality (proving each row actually fires) is not reachable
 * across isolated Vitest workers; this scan is the reachable half.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_WARNS, type AllowedWarn } from '../../support/warn-gate';
import { collectEditorSources, EDITOR_SRC } from './scan-source';

/** A `devWarn(` whose tag argument opens with the literal `tag`, on that line or the next. */
function warnsWithTag(code: string, tag: string): boolean {
	return new RegExp(`devWarn\\(\\s*['\`]${escape(tag)}`).test(code);
}

function escape(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The caller-supplied-tag sites (`selection/primitives.ts`) key on site alone: their tag is a
// parameter, so no literal to match. A row for one asserts only that the site still warns.
function tagIsCallerSupplied(row: AllowedWarn): boolean {
	return row.site === 'src/lib/selection/primitives.ts';
}

describe('warn-gate allowlist stays honest against the source', () => {
	const sources = collectEditorSources(EDITOR_SRC);
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected the editor sources', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every row names a live file that still emits its tag', () => {
		for (const row of ALLOWED_WARNS) {
			const file = byPath.get(row.site);
			expect(file, `allowlisted site no longer exists: ${row.site}`).toBeDefined();
			expect(file!.code, `${row.site} no longer calls devWarn`).toContain('devWarn(');
			if (tagIsCallerSupplied(row)) continue;
			expect(
				warnsWithTag(file!.code, row.tag),
				`${row.site} no longer warns with tag "${row.tag}"`
			).toBe(true);
		}
	});

	it('every row carries a reason and no two rows share a tag+site key', () => {
		const keys = ALLOWED_WARNS.map((row) => `${row.tag}@${row.site}`);
		expect(new Set(keys).size).toBe(keys.length);
		for (const row of ALLOWED_WARNS) expect(row.reason.length).toBeGreaterThan(20);
	});

	// ── Matcher self-tests (the manifest is short; these keep the scan non-vacuous) ──

	it('the tag matcher reads both the direct and the invariant-relay spellings', () => {
		expect(warnsWithTag("devWarn('reorder', `out of bounds`);", 'reorder')).toBe(true);
		expect(warnsWithTag("devWarn(\n\t'tree-ops',\n\t`split`\n);", 'tree-ops')).toBe(true);
		expect(warnsWithTag('devWarn(`invariant:${tag}`, m, d);', 'invariant:')).toBe(true);
	});

	it('the tag matcher refuses a different tag and a bare mention', () => {
		expect(warnsWithTag("devWarn('reorder', 'x');", 'paste')).toBe(false);
		expect(warnsWithTag('// the paste tag lives in paste/dispatch.ts', 'paste')).toBe(false);
		expect(warnsWithTag("devWarnLater('paste', 'x');", 'paste')).toBe(false);
	});
});
