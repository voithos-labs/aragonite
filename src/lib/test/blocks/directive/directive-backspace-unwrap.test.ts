// @vitest-environment jsdom
//
// Backspace at the start of a plain directive container's body lifts that block out; the
// fences ride metadata through `rebuildRaw`, so the remainder is still a directive.
//
// Miss-analysis: the container declared the quote-shaped lift without the capability that
// armed it, so the strategy's empty result read as a decline; no test ever pressed
// Backspace at a directive body's start.
import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { activateDirectives } from '$lib/plugin';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;

beforeEach(() => {
	resetPluginPlatformForTests();
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

describe('directive container Backspace unwrap (U2)', () => {
	it('lifts the first body block out and keeps the fences around the rest', async () => {
		editor(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('first\n\n:::spoiler\n\nsecond\n\n:::\n');
		expect(mounted.instance.getSelection()?.focus).toEqual({ path: [0], offset: 0 });
	});

	it('unwraps a sole body block into a bare paragraph', async () => {
		editor(':::spoiler\n\nbody\n\n:::\n');

		await pressKeyAt(mounted, [0, 0], 0, BACKSPACE);

		expect(mounted.source()).toBe('body\n');
	});

	// The sibling arm, and the proof that an offset-0 press inside the body reaches the
	// container's dispatch at all: a caret that could not land there would leave this red too.
	it('merges a later body block into its predecessor instead of lifting', async () => {
		editor(':::spoiler\n\nfirst\n\nsecond\n\n:::\n');

		await pressKeyAt(mounted, [0, 1], 0, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nfirstsecond\n\n:::\n');
	});

	it('leaves a mid-content Backspace to the block itself', async () => {
		editor(':::spoiler\n\nbody\n\n:::\n');

		await pressKeyAt(mounted, [0, 0], 2, BACKSPACE);

		expect(mounted.source()).toBe(':::spoiler\n\nbody\n\n:::\n');
	});
});
