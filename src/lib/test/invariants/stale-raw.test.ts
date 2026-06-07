import { describe, it, expect } from 'vitest';
// Side-effect import: populates rebuildRaw on container descriptors.
import '../../schema/container-raw';
import { checkStaleRaw } from '../../invariants/node-shape';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';

function firstBlock(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkStaleRaw (G1.1)', () => {
	// ── Valid documents must not fire ──────────────────────────────────────────
	// These pin the regression: `rebuildRaw` canonicalizes (re-derives `> `,
	// strips indentation), so byte-comparing a rebuild false-fired on faithful,
	// freshly-parsed nodes. The semantic re-parse check tolerates them.

	it('passes for blockquote with no space after marker (>foo)', () => {
		expect(checkStaleRaw(firstBlock('>foo\n'))).toBeNull();
	});

	it('passes for blockquote lazy continuation', () => {
		expect(checkStaleRaw(firstBlock('> foo\nbar\n'))).toBeNull();
	});

	it('passes for a list item with leading indentation', () => {
		const listItem = firstBlock('   - a\n').children?.[0];
		expect(listItem?.kind).toBe('listItem');
		expect(checkStaleRaw(listItem!)).toBeNull();
	});

	it('passes for a freshly parsed blockquote', () => {
		expect(checkStaleRaw(firstBlock('> hello\n> world\n'))).toBeNull();
	});

	it('passes for a freshly parsed list', () => {
		expect(checkStaleRaw(firstBlock('- a\n- b\n'))).toBeNull();
	});

	it('passes for a freshly parsed list item', () => {
		expect(checkStaleRaw(firstBlock('- a\n- b\n').children![0])).toBeNull();
	});

	// ── Genuine raw/children drift must fire ───────────────────────────────────

	it('fires when a child was mutated without updating the container raw', () => {
		const bq = firstBlock('> hello\n> world\n');
		bq.children![0].raw = 'changed\n';
		const violation = checkStaleRaw(bq);
		expect(violation?.code).toBe('stale-container-raw');
		expect(violation?.detail).toMatchObject({ kind: 'blockquote' });
	});

	it('fires when the container raw was mutated leaving children stale', () => {
		const bq = firstBlock('> hello\n> world\n');
		bq.raw = '> only one line now\n';
		expect(checkStaleRaw(bq)?.code).toBe('stale-container-raw');
	});

	it('fires for a stale list', () => {
		const list = firstBlock('- a\n- b\n');
		list.children![0].raw = '- z\n';
		expect(checkStaleRaw(list)).not.toBeNull();
	});

	// ── Purity and exemptions ──────────────────────────────────────────────────

	it('does not mutate the input node', () => {
		const bq = firstBlock('> hello\n> world\n');
		bq.children![0].raw = 'changed\n';
		const before = bq.raw;
		checkStaleRaw(bq);
		expect(bq.raw).toBe(before);
		expect(bq.children![0].raw).toBe('changed\n');
	});

	it('returns null for a grid container (table is exempt)', () => {
		const table = firstBlock('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		expect(table.kind).toBe('table');
		expect(checkStaleRaw(table)).toBeNull();
	});

	it('returns null for a leaf', () => {
		expect(checkStaleRaw(firstBlock('plain\n'))).toBeNull();
	});
});
