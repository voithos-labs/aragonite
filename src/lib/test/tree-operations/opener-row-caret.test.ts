// A `:::name` typed above a block closes as it's typed, and the caret stays on its opener line
// through every letter of the name, the generic-to-admonition change included.
// Miss-analysis (#801): the directive container had no leaf on its opener line, so the closer moved
// the caret into the body; no row typed a container's name one letter at a time.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '#lib';
import { serialize } from '#lib/core/serializer.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { makeTopHarness, containerBundleOver } from '#lib/test/harness/editor-actions.js';

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('a container name typed above a block', () => {
	it('closes at its first letter with the caret on the opener line', async () => {
		const h = makeTopHarness('x\n\n:::tip\nbody\n:::\n');
		await h.actions.updateBlockContent(0, ':::n\n', 'authored', 'join-typing', 4);

		expect(serialize(h.deps.doc)).toBe(':::n\n:::\n\n:::tip\nbody\n:::\n');
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [0, 0], offset: 4 });
	});

	it('keeps the caret on the line as the name becomes an admonition', async () => {
		const h = makeTopHarness(':::not\n:::\n\n:::tip\nbody\n:::\n');
		const row = containerBundleOver(h.deps, h.controller, [0]);
		await row.bundle.blockEdit.updateBlockContent(0, ':::note\n', 'authored', 'join-typing', 7);

		expect(serialize(h.deps.doc)).toBe(':::note\n:::\n\n:::tip\nbody\n:::\n');
		expect(h.deps.doc.children[0].kind).toBe('admonition');
		expect(h.deps.doc.children[0].children?.[0].raw).toBe(':::note\n');
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [0, 0], offset: 7 });
	});
});
