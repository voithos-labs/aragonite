// @vitest-environment jsdom
// Reading mode leaves no way to start a composition, a beforeinput or a pending mark, so the text
// routes that start from one carry no reading-mode check of their own: the write refuses them.
// Miss-analysis: each route's own check hid whether reading mode could reach it at all.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const MIXED = '# Title\n\nprose\n\n> quoted\n\n- item\n\n```js\ncode\n```\n\n| a |\n| - |\n| b |\n';

function readingWrites(): number {
	return takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG).length;
}

/** Type `x` at the end of the paragraph's `hi`, after `Mod+B` there left a mark pending. */
async function typeAfterBoldChord(mounted: MountedEditor, switchToReading: boolean) {
	placeCaret(surfaceAt(mounted, [0]), 2);
	await pressKey(surfaceAt(mounted, [0]), { key: 'b', ctrlKey: true });
	if (switchToReading) {
		mounted.props.presentationMode = 'reading';
		flushSync();
		await mounted.settle();
	}
	const el = surfaceAt(mounted, [0]);
	placeCaret(el, 2);
	await pressKey(el, { key: 'x' });
	await mounted.settle();
}

describe('reading mode offers no text input to compose or type into', () => {
	it.each([
		['source', true],
		['reading', false]
	] as const)('in %s mode, a block accepts text: %s', (presentationMode, accepts) => {
		const mounted = mountEditor({ source: MIXED, presentationMode });

		const editable = mounted.target.querySelectorAll('[contenteditable="true"]');
		expect(editable.length > 0).toBe(accepts);
	});
});

describe('a mark left pending by a format chord', () => {
	it('carries into the next typed byte in live mode', async () => {
		const mounted = mountEditor({ source: 'hi\n', presentationMode: 'live' });

		await typeAfterBoldChord(mounted, false);

		expect(mounted.source()).toBe('hi**x**\n');
	});

	it('is gone once the editor switches to reading mode', async () => {
		const mounted = mountEditor({ source: 'hi\n', presentationMode: 'live' });

		await typeAfterBoldChord(mounted, true);

		expect(mounted.source()).toBe('hi\n');
		expect(readingWrites()).toBe(0);
	});

	it('is never left by the chord in reading mode', async () => {
		const mounted = mountEditor({ source: 'hi\n', presentationMode: 'reading' });

		await typeAfterBoldChord(mounted, false);

		expect(mounted.source()).toBe('hi\n');
		expect(readingWrites()).toBe(0);
	});
});
