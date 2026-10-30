// The generic `:::name` container's first child is its opener line as written: attributes,
// trailing spaces and the line ending all round-trip through it, since the rebuild writes it back.
import { describe, it, expect, beforeEach } from 'vitest';
import { activateDirectives } from '#lib/plugin.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';

beforeEach(() => activateDirectives());

describe('the directive container holds its opener line verbatim', () => {
	it.each([
		[':::note\nbody\n:::\n', ':::note\n'],
		['::::note\nbody\n::::\n', '::::note\n'],
		[':::note {#id}\nbody\n:::\n', ':::note {#id}\n'],
		[':::note   \nbody\n:::\n', ':::note   \n'],
		[':::note\r\nbody\r\n:::\r\n', ':::note\r\n']
	])('%j holds %j', (source, expected) => {
		const doc = parse(source);
		expect(doc.children[0].children?.[0]).toMatchObject({
			kind: 'directiveOpenerLine',
			raw: expected
		});
		expect(serialize(doc)).toBe(source);
	});
});
