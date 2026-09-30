// @vitest-environment jsdom
// The parrot's caption: the bytes after the marker, without the Markdown whitespace around them.
// Miss-analysis: every caption case was ASCII with one space after the marker.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installEditorDomStubsForTests } from '$lib/testing';
import { parrotPlugin, PARROT } from '$lib/plugins/parrot';
import { declaredPluginKind } from '$lib/plugin';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

const mountParrot = (source: string): HTMLElement =>
	mountEditor({ source, plugins: [parrotPlugin()], scrollMode: 'host' }).target;

const captionOf = (source: string): string | null | undefined =>
	mountParrot(source).querySelector('.parrot-caption')?.textContent;

/** The source offset a click on the caption's first character shows the source at. */
function offsetAtCaptionStart(source: string): number | undefined {
	const root = mountParrot(source);
	const caption = root.querySelector<HTMLElement>('.parrot-caption')!;
	const { left, top } = caption.getBoundingClientRect();
	return tryGetBlockKindDescriptor(declaredPluginKind(PARROT))?.caretTargetAtPoint?.(
		root,
		left,
		top
	)?.offset;
}

beforeEach(() => {
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
});

describe('parrot caption', () => {
	it('trims spaces, tabs and the CRLF ending around the caption', () => {
		expect(captionOf('%%parrot \tparty\t \r\n')).toBe('party');
	});

	it('keeps a non-breaking space, which is part of the caption', () => {
		expect(captionOf('%%parrot\u00a0party\n')).toBe('\u00a0party');
	});

	it.each([
		['one space', '%%parrot party\n', 9],
		['two spaces', '%%parrot  party\n', 10],
		['a non-breaking space', '%%parrot\u00a0party\n', 8],
		['no space', '%%parrotparty\n', 8]
	])('a press on the caption start after %s reveals the source at %i', (_label, source, offset) => {
		expect(offsetAtCaptionStart(source)).toBe(offset);
	});
});
