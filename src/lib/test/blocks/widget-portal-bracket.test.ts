// @vitest-environment jsdom
// Through the real widget pool, each out-of-pass acquire or unbalanced pass warns on the
// `invariant:pool-bracket` tag, and a legal pass stays silent, since every e2e spec fails on a
// false warning (G1.25).
import { describe, it, expect } from 'vitest';

import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	createWidgetPool,
	type WidgetPool,
	type WidgetPoolAdapter
} from '#lib/components/blocks/widget-portal.js';
import type { AnyInlineKind, InlineNode } from '#lib/core/nodes.js';

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

describe('widget pool: bracket discipline (G1.25)', () => {
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
