// @vitest-environment jsdom
// The parrot's caption: the bytes after the marker, without the Markdown whitespace around them.
// Miss-analysis: every caption case was ASCII with one space after the marker.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { headless } from '#lib/testing.js';
import { parrotPlugin, parrot } from '#packages/parrot/src/index.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import {
	blockHostAt,
	destroyMountedEditors,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const mountParrot = (source: string) =>
	mountEditor({ source, plugins: [parrotPlugin()], scrollMode: 'host' });

async function captionOf(source: string): Promise<string | null | undefined> {
	const m = mountParrot(source);
	await m.settle();
	return m.target.querySelector('.parrot-caption')?.textContent;
}

/** The source offset a click on the caption's first character shows the source at. */
async function offsetAtCaptionStart(source: string): Promise<number | undefined> {
	const m = mountParrot(source);
	await m.settle();
	const caption = m.target.querySelector<HTMLElement>('.parrot-caption')!;
	const { left, top } = caption.getBoundingClientRect();
	const descriptor = tryGetBlockKindDescriptor(parrot.name as never);
	return descriptor?.caretTargetAtPoint?.(blockHostAt(m, [0]), left, top)?.offset;
}

beforeEach(() => {
	headless();
});

afterEach(async () => {
	await destroyMountedEditors();
});

describe('parrot caption', () => {
	it('trims spaces, tabs and the CRLF ending around the caption', async () => {
		expect(await captionOf('%%parrot \tparty\t \r\n')).toBe('party');
	});

	it('keeps a non-breaking space, which is part of the caption', async () => {
		expect(await captionOf('%%parrot party\n')).toBe(' party');
	});

	it.each([
		['one space', 9, '%%parrot party\n'],
		['two spaces', 10, '%%parrot  party\n'],
		['a non-breaking space', 8, '%%parrot party\n'],
		['no space', 8, '%%parrotparty\n']
	])(
		'a press on the caption start after %s reveals the source at %i',
		async (_label, offset, source) => {
			expect(await offsetAtCaptionStart(source)).toBe(offset);
		}
	);
});
