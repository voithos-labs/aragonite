/**
 * A rung may not claim past the range it was given. The scan range is not always a
 * block's whole raw (a heading's excludes its closing `#` run, a table cell's the `|`),
 * so a recognizer searching the STRING swallows bytes the block still needs — and the
 * overrun leaves no trace, since the scan loop then exits as if it had finished.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { parseInline } from '../../../core/inline';
import type { InlineNode } from '../../../core/nodes';
import {
	INLINE_PRIORITIES,
	__resetInlineSyntaxForTests,
	registerInlineSyntax
} from '../../../core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

const RAW = '@tag@ trailing';
const SHORT_END = 5; // `@tag@` — the block offers only this much

describe('a rung may not claim past the scan range', () => {
	// The unbounded terminator search: a real closer, found by reading the whole
	// string rather than the range the block offered.
	it('throws naming the rung, the claimed end and the range end', () => {
		registerInlineSyntax('@', (raw, pos) => {
			const close = raw.indexOf('g', pos + 1);
			return close < 0 ? null : { kind: 'text', start: pos, end: close + 6, text: 'x' };
		});
		expect(() => parseInline(RAW, 0, SHORT_END)).toThrow(
			/inline-syntax "@" claimed \[0, 9\), past the scan range end 5/
		);
	});

	// Half-open `[start, end)`: `end` IS the scan advance, so a claim ending exactly
	// at the range end is the ordinary full-range case, not an overrun.
	it('accepts a claim ending exactly at the range end', () => {
		registerInlineSyntax('@', (raw, pos, end) => ({
			kind: 'text',
			start: pos,
			end,
			text: raw.slice(pos, end)
		}));
		expect(parseInline(RAW, 0, SHORT_END)).toMatchObject([
			{ kind: 'text', start: 0, end: 5, text: '@tag@' }
		]);
	});

	// A range-honouring rung is unaffected by bytes past `end` whatever they spell —
	// declining a claim that would exceed the range is the contract.
	it('leaves a rung that honours the range alone', () => {
		registerInlineSyntax('@', (raw, pos, end) => {
			const close = raw.indexOf('@', pos + 1);
			return close < 0 || close + 1 > end
				? null
				: { kind: 'text', start: pos, end: close + 1, text: 'ok' };
		});
		expect(parseInline(RAW, 0, SHORT_END)[0]).toMatchObject({ start: 0, end: 5 });
	});

	// Both dispatch routes share `tryRungs`, but only structurally — the reserved
	// prefix rung is consulted before the switch, the bare rung from its `default` arm.
	it('guards the pre-switch reserved-prefix route too', () => {
		registerInlineSyntax(
			'!',
			(raw, pos): InlineNode => ({ kind: 'text', start: pos, end: raw.length, text: 'x' }),
			{ prefix: '![[', priority: INLINE_PRIORITIES.prefixOverride }
		);
		expect(() => parseInline('![[a]] trailing', 0, 6)).toThrow(
			/inline-syntax "!\[\[" claimed \[0, 15\), past the scan range end 6/
		);
	});
});
