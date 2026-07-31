import { describe, it, expect } from 'vitest';
import { checkStaleRaw } from '../../invariants/node-shape';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';
import {
	assembleListHalf,
	buildListItemWithContent
} from '../../tree-operations/list/list-builders';

function firstBlock(source: string): CstNode {
	return parse(source).children[0];
}

function emptyParagraph(): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw: '\n' };
}

describe('checkStaleRaw (G1.1)', () => {
	// ── Valid documents must not fire ──────────────────────────────────────────
	// `rebuildRaw` canonicalizes, so byte-comparing against a rebuild false-fires on
	// faithful freshly-parsed nodes; the strip-vs-serialize check tolerates them.

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

	// The editor's empty item holds a placeholder leaf where the parser emits a childless
	// item; both satisfy the byte invariant, so neither form may fire.
	it('passes for an empty list item holding an empty-paragraph placeholder', () => {
		const listTemplate = firstBlock('- a\n');
		const emptyItem = buildListItemWithContent(listTemplate.children![0], [emptyParagraph()]);
		expect(emptyItem.raw).toBe('- \n');
		expect(checkStaleRaw(emptyItem)).toBeNull();

		const list = assembleListHalf(listTemplate, [emptyItem], 1);
		expect(list.raw).toBe('- \n');
		expect(checkStaleRaw(list)).toBeNull();
	});

	// The parser keeps a trailing blank quote line in `innerSuffix` where the editor
	// materializes it as an empty paragraph. Byte-faithful either way.
	it('passes for a blockquote with a trailing empty-paragraph placeholder', () => {
		const bq = firstBlock('> hi\n>\n');
		expect(bq.kind).toBe('blockquote');
		const trailingBlank = bq.innerSuffix ?? '';
		bq.innerSuffix = '';
		bq.children!.push({ kind: 'paragraph', leadingTrivia: '', raw: trailingBlank });
		expect(checkStaleRaw(bq)).toBeNull();
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

	// The empty-placeholder tolerance is sole-child only; these guard it from swallowing
	// real drift.

	it('fires when raw carries content but the sole child is an empty placeholder', () => {
		const item = buildListItemWithContent(firstBlock('- a\n').children![0], [emptyParagraph()]);
		item.raw = '- actual content\n';
		expect(checkStaleRaw(item)?.code).toBe('stale-container-raw');
	});

	it('fires for a trailing empty placeholder absent from the raw', () => {
		const item = firstBlock('- a\n').children![0];
		item.children!.push(emptyParagraph());
		expect(checkStaleRaw(item)?.code).toBe('stale-container-raw');
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
