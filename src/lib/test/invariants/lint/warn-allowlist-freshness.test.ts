/**
 * The fail-on-warn gate's allowlist only shrinks. A row waives a tag at a site for the whole
 * run, so a row whose file moved or whose site stopped warning that tag is a hole nothing else
 * would report. Per-run bidirectionality (proving each row actually fires) is not reachable
 * across isolated Vitest workers; this scan is the reachable half.
 */
import { describe, it, expect } from 'vitest';
import { ALLOWED_WARNS, type AllowedWarn } from '../../support/warn-gate';
import { collectEditorSources, EDITOR_SRC } from './scan-source';

/** A `devWarn(` whose tag argument opens with the literal `tag`, on that line or the next. */
function warnsWithTag(code: string, tag: string): boolean {
	return new RegExp(`devWarn\\(\\s*['\`]${escapeLiteral(tag)}`).test(code);
}

function escapeLiteral(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Why a row went stale against its file's current source, or `''` while it stays honest. */
function staleReason(row: AllowedWarn, code: string | undefined): string {
	if (code === undefined) return `allowlisted site no longer exists: ${row.site}`;
	if (!code.includes('devWarn(')) return `${row.site} no longer calls devWarn`;
	if (row.callerSuppliedTag || warnsWithTag(code, row.tag)) return '';
	return `${row.site} no longer warns with tag "${row.tag}"`;
}

describe('warn-gate allowlist stays honest against the source', () => {
	const sources = collectEditorSources(EDITOR_SRC);
	const byPath = new Map(sources.map((f) => [f.relPath, f]));

	it('inspected the editor sources', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every row names a live file that still emits its tag', () => {
		for (const row of ALLOWED_WARNS) {
			expect(staleReason(row, byPath.get(row.site)?.code)).toBe('');
		}
	});

	it('every row carries a reason and no two rows share a tag+site key', () => {
		const keys = ALLOWED_WARNS.map((row) => `${row.tag}@${row.site}`);
		expect(new Set(keys).size).toBe(keys.length);
		for (const row of ALLOWED_WARNS) expect(row.reason.length).toBeGreaterThan(20);
	});

	// ── Matcher self-tests over synthetic rows (the manifest is short; these keep it non-vacuous) ──

	it('the row verdict catches a moved file, a dropped devWarn and a changed tag', () => {
		const row: AllowedWarn = { tag: 'probe', site: 'src/lib/probe.ts', reason: 'synthetic row' };
		expect(staleReason(row, "devWarn('probe', 'x');")).toBe('');
		expect(staleReason(row, undefined)).toContain('no longer exists');
		expect(staleReason(row, 'const quiet = 1;')).toContain('no longer calls devWarn');
		expect(staleReason(row, "devWarn('other', 'x');")).toContain('no longer warns with tag');
	});

	it('a caller-supplied-tag row asks only that its site still warns', () => {
		const row: AllowedWarn = {
			tag: 'anything',
			site: 'src/lib/probe.ts',
			reason: 'synthetic row',
			callerSuppliedTag: true
		};
		expect(staleReason(row, 'devWarn(tag, message);')).toBe('');
		expect(staleReason(row, 'const quiet = 1;')).toContain('no longer calls devWarn');
	});

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
