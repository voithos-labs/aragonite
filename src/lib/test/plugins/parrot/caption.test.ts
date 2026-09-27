// @vitest-environment jsdom
// The parrot's caption: the bytes after the marker, without the Markdown whitespace around them.
//
// Miss-analysis: every caption case was ASCII, so `trim()` dropping a typed non-breaking space,
// which Markdown counts as text, had nothing to fail.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { parrotPlugin } from '$lib/plugins/parrot';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

const captionOf = (source: string): string | null | undefined =>
	mountEditor({ source, plugins: [parrotPlugin()], scrollMode: 'host' }).target.querySelector(
		'.parrot-caption'
	)?.textContent;

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

describe('parrot caption', () => {
	it('trims spaces, tabs and the CRLF ending around the caption', () => {
		expect(captionOf('%%parrot \tparty\t \r\n')).toBe('party');
	});

	it('keeps a non-breaking space, which is part of the caption', () => {
		expect(captionOf('%%parrot party\n')).toBe(' party');
	});
});
