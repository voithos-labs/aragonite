// The conformance kit's copy cell must assert the CONTRACT, not re-derive the slice under
// test: for a kind with no character positions a cross-block range carries the unit whole,
// at either endpoint role.
import { describe, it, expect, vi, afterEach } from 'vitest';

// A collector that puts an interior offset back on a whole-unit endpoint — the pre-fix bytes.
// Keyed on the endpoint's own value, so neither arm depends on the kit's anchor/focus order.
const stub = vi.hoisted(() => ({ mode: 'off' as 'off' | 'unit-start' | 'unit-end' }));
vi.mock('$lib/selection/clipboard-text', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/selection/clipboard-text')>();
	const { nodeAt } = await import('$lib/tree-operations/node-ops');
	const { getBlockKindDescriptor } = await import('$lib/schema/block-kind-descriptor');
	const { displayLength } = await import('$lib/core/lines');
	type Args = Parameters<typeof actual.collectCrossBlockText>;
	const cut = (doc: Args[0], point: Args[1]): Args[1] => {
		const node = nodeAt(doc, point.path);
		if (!node || !('raw' in node)) return point;
		if (getBlockKindDescriptor(node.kind).blockFocus !== 'whole-block') return point;
		const target = stub.mode === 'unit-start' ? 0 : displayLength(node.raw);
		return stub.mode !== 'off' && point.offset === target ? { ...point, offset: 1 } : point;
	};
	return {
		...actual,
		collectCrossBlockText: (doc: Args[0], anchor: Args[1], focus: Args[2]) =>
			actual.collectCrossBlockText(doc, cut(doc, anchor), cut(doc, focus))
	};
});

import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { checkCopyIsRawByteSlice, resetPluginPlatformForTests } from '$lib/testing';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import { declaredPluginKind } from '$lib/plugin';

function mermaidFixture() {
	registerMermaidKind();
	const kind = declaredPluginKind(MERMAID);
	return { kind, fixture: getBlockKindDescriptor(kind).conformanceFixture! };
}

afterEach(() => {
	stub.mode = 'off';
	resetPluginPlatformForTests();
});

describe('kind conformance — the whole-unit copy contract', () => {
	it('accepts a childless opaque kind whose range copy carries it whole', () => {
		const { kind, fixture } = mermaidFixture();
		expect(() => checkCopyIsRawByteSlice(kind, fixture)).not.toThrow();
	});

	it('rejects a copy that truncates the unit it starts in', () => {
		const { kind, fixture } = mermaidFixture();
		stub.mode = 'unit-start';
		expect(() => checkCopyIsRawByteSlice(kind, fixture)).toThrow(/raw byte slice/);
	});

	// Reds on a kit that only ever drives the kind as the range START: with no end-side
	// range there is no whole-unit end offset for the stub to cut.
	it('rejects a copy that truncates the unit it ends in', () => {
		const { kind, fixture } = mermaidFixture();
		stub.mode = 'unit-end';
		expect(() => checkCopyIsRawByteSlice(kind, fixture)).toThrow(/raw byte slice/);
	});
});
