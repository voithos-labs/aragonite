// @vitest-environment jsdom
// Backspace at the start of a plain directive container's first body block goes to its opener
// line, as it does in an admonition: the line is the container's first child and is kept.
// Miss-analysis: no test pressed Backspace at the start of a directive body.
import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
import { activateDirectives } from '#lib/plugin.js';
import {
	installLayoutStubs,
	mountEditor,
	pressKeyAt
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;

beforeEach(() => {
	activateDirectives();
});

afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const BACKSPACE = { key: 'Backspace' };

function editor(source: string): ReturnType<typeof mountEditor> {
	mounted = mountEditor({ source });
	return mounted;
}

describe('directive container Backspace at the body start', () => {
	it('goes to the end of the opener line and keeps the container', async () => {
		editor(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');
		expect(mounted.instance.getSelection()?.focus).toEqual({ path: [0, 0], offset: 10 });
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
