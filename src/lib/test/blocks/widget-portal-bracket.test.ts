// @vitest-environment jsdom
//
// G1.25 fired through the real pool: each illegal bracket transition reaches
// devWarn on the `invariant:pool-bracket` tag, and a legal bracketed pass stays
// silent (a false-firing invariant poisons the channel every e2e spec watches).
import { describe, it, expect } from 'vitest';

import { takeDevWarns } from '$lib/test/support/warn-gate';
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

const POOL_BRACKET = ['invariant:pool-bracket'];

describe('widget pool — bracket discipline (G1.25)', () => {
	it('acquire outside a bracket fires', () => {
		makePool().acquire(KIND, INLINE, '$x$');
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(POOL_BRACKET);
		expect(fires[0].details).toBe('acquire-outside-bracket');
	});

	it('beginPass over an unswept pass fires', () => {
		const pool = makePool();
		pool.beginPass();
		pool.beginPass();
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(POOL_BRACKET);
		expect(fires[0].details).toBe('begin-unswept');
	});

	it('sweep without an open bracket fires', () => {
		makePool().sweep();
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(POOL_BRACKET);
		expect(fires[0].details).toBe('sweep-outside-bracket');
	});

	it('a bracketed pass and a teardown stay silent', () => {
		const pool = makePool();
		pool.beginPass();
		pool.acquire(KIND, INLINE, '$x$');
		pool.sweep();
		pool.beginPass();
		pool.sweep();
		pool.dispose();
		expect(takeDevWarns()).toEqual([]);
	});
});
