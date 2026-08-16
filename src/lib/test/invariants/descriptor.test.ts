import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { checkContentRange } from '../../invariants/descriptor';
import { parse } from '../../core/parser';
import type { CstNode } from '../../core/nodes';
import { declaredPluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { DIRECTIVE_LEAF, registerDirectiveKinds } from '../../core/directive/kinds';

function leaf(source: string): CstNode {
	return parse(source).children[0];
}

describe('checkContentRange (G1.8)', () => {
	it('fires when start exceeds end', () => {
		const node = leaf('hello\n');
		const violation = checkContentRange(node, () => ({ start: 4, end: 2 }));
		expect(violation?.code).toBe('content-range-out-of-bounds');
	});

	it('fires when end exceeds displayLength(raw)', () => {
		const node = leaf('hi\n');
		const violation = checkContentRange(node, () => ({ start: 0, end: 99 }));
		expect(violation?.detail).toMatchObject({ start: 0, end: 99, len: 2 });
	});

	it('fires when start is negative', () => {
		const node = leaf('hi\n');
		expect(checkContentRange(node, () => ({ start: -1, end: 2 }))).not.toBeNull();
	});

	it('passes for a real paragraph', () => {
		expect(checkContentRange(leaf('hello world\n'))).toBeNull();
	});

	it('passes for a real heading (marker-skipping range)', () => {
		expect(checkContentRange(leaf('## Title\n'))).toBeNull();
	});

	it('passes for an empty range at the boundary', () => {
		const node = leaf('hi\n');
		expect(checkContentRange(node, () => ({ start: 2, end: 2 }))).toBeNull();
	});

	it('returns null for a non-prose kind', () => {
		expect(checkContentRange(leaf('---\n'))).toBeNull();
	});
});

// Miss-analysis (M-2): the fixtures were all prose kinds, so the gate's premise — that
// `supportsInline` and `getContentRange` travel together — was never tested against the kind
// that breaks it. The directive leaf ships a content range with `supportsInline: false`, and
// the range is consumed unconditionally (the split-cut clamp reads it).
describe('checkContentRange (G1.8) covers a non-prose kind that declares a content range', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerDirectiveKinds();
	});
	afterEach(() => __resetSchemaRegistriesForTests());

	const directiveLeaf = (): CstNode => ({
		kind: declaredPluginKind(DIRECTIVE_LEAF),
		leadingTrivia: '',
		raw: '::toc info\n'
	});

	it('fires on an out-of-bounds range', () => {
		const violation = checkContentRange(directiveLeaf(), () => ({ start: 0, end: 99 }));
		expect(violation?.code).toBe('content-range-out-of-bounds');
	});

	it('passes on the declared range', () => {
		expect(checkContentRange(directiveLeaf())).toBeNull();
	});
});
