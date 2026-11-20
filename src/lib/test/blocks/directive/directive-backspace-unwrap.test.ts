// @vitest-environment jsdom
// Backspace at the start of a plain directive container's first body block holds the gap under its
// opener line, whose end is the name a letter would rename; the line is the container's first
// child and is kept.
// Miss-analysis: no test pressed Backspace at the start of a directive body.
import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
import { activateDirectives } from '#lib/plugin.js';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor<EditorTestSurface>>;

beforeEach(() => {
	activateDirectives();
});

afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const BACKSPACE = { key: 'Backspace' };

function editor(source: string): ReturnType<typeof mountEditor<EditorTestSurface>> {
	mounted = mountEditor<EditorTestSurface>({ source });
	return mounted;
}

describe('directive container Backspace at the body start', () => {
	it('holds the gap under the opener line and keeps the container', async () => {
		editor(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');
		expect(mounted.instance.__test.getGapCaret()).toEqual({
			parentPath: [0],
			index: 1,
			held: true
		});
	});

	// Also proves a Backspace at offset 0 inside the body reaches the container at all: a caret
	// that could not get there would fail this test too.
	it('merges a later body block into its predecessor', async () => {
		editor(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');

		await pressKeyAt(mounted, [0, 2], 0, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nfirstsecond\n\n:::\n');
	});

	it('leaves a mid-content Backspace to the block itself', async () => {
		editor(':::spoiler\n\nbody\n\n:::\n');

		await pressKeyAt(mounted, [0, 1], 2, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nbody\n\n:::\n');
	});
});
