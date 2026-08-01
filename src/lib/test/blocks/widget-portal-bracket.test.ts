// @vitest-environment jsdom
//
// G1.25 fired through the real pool: each illegal bracket transition reaches
// devWarn on the `invariant:pool-bracket` tag, and a legal bracketed pass stays
// silent (a false-firing invariant poisons the channel every e2e spec watches).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import {
	createWidgetPool,
	type WidgetPool,
	type WidgetPoolAdapter
} from '$lib/components/blocks/widget-portal';
import type { AnyInlineKind, InlineNode } from '$lib/core/nodes';

const KIND = 'math' as AnyInlineKind;
const INLINE = { kind: KIND, start: 0, end: 5 } as InlineNode;

function makePool(): WidgetPool {
	const adapter: WidgetPoolAdapter<HTMLSpanElement> = {
		create: () => document.createElement('span'),
		destroy: () => {},
		element: (el) => el
	};
	return createWidgetPool(adapter);
}

function bracketFires(): unknown[][] {
	return vi.mocked(devWarn).mock.calls.filter(([tag]) => tag === 'invariant:pool-bracket');
}

beforeEach(() => vi.mocked(devWarn).mockClear());

describe('widget pool — bracket discipline (G1.25)', () => {
	it('acquire outside a bracket fires', () => {
		makePool().acquire(KIND, INLINE, '$x$');
		expect(bracketFires()).toHaveLength(1);
		expect(bracketFires()[0][2]).toBe('acquire-outside-bracket');
	});

	it('beginPass over an unswept pass fires', () => {
		const pool = makePool();
		pool.beginPass();
		pool.beginPass();
		expect(bracketFires()).toHaveLength(1);
		expect(bracketFires()[0][2]).toBe('begin-unswept');
	});

	it('sweep without an open bracket fires', () => {
		makePool().sweep();
		expect(bracketFires()[0][2]).toBe('sweep-outside-bracket');
	});

	it('a bracketed pass and a teardown stay silent', () => {
		const pool = makePool();
		pool.beginPass();
		pool.acquire(KIND, INLINE, '$x$');
		pool.sweep();
		pool.beginPass();
		pool.sweep();
		pool.dispose();
		expect(devWarn).not.toHaveBeenCalled();
	});
});
