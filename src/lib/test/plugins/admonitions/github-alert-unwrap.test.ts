import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { unwrapFirstChildFromQuote } from '$lib/tree-operations';
import { admonitionsPlugin } from '$lib/plugins/admonitions';

// The alert branch of the shared quote-unwrap primitive (Rule U2). A GitHub alert's
// `[!TYPE]` marker is opener-only, so lifting a body child drops it: the remainder
// reparses as a plain blockquote, not another alert. Blockquote coverage lives in
// tree-operations/unwrap-blockquote.

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

const parseAlert = (src: string) => {
	const node = parse(src).children[0];
	expect(node.kind).toBe('githubAlert');
	return node;
};

describe('github alert — unwrap first child drops the marker', () => {
	it('lifts the sole body block, leaving no alert', () => {
		const result = unwrapFirstChildFromQuote(parseAlert('> [!NOTE]\n> only line\n'));
		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('only line');
	});

	it('lifts the first body block; the remainder is a plain blockquote', () => {
		const result = unwrapFirstChildFromQuote(parseAlert('> [!NOTE]\n> a\n>\n> b\n'));
		expect(result).toHaveLength(2);
		expect((result[0].raw ?? '').trim()).toBe('a');
		expect(result[1].kind).toBe('blockquote');
		expect(result[1].raw ?? '').not.toContain('[!NOTE]');
		expect(result[1].raw ?? '').toContain('b');
	});
});
