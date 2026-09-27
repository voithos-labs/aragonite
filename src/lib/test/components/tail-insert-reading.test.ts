// @vitest-environment jsdom
// The row under the last block is hidden in reading mode; shown anyway, its click reaches the write,
// which refuses it.
// Miss-analysis: the row's own reading-mode check was never tested, nor the write behind it.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TailInsert from '$lib/components/TailInsert.svelte';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '$lib/test/harness/mount-editor.svelte';
import { makeTopHarness } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';
import { settleEditor } from '../harness/settle';
import { takeDevWarns } from '../support/warn-gate';

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

const TAIL_ROW = '.editor-tail-row';

describe('the row under the last block', () => {
	it.each([
		['source', true],
		['reading', false]
	] as const)('in %s mode is shown: %s', (presentationMode, shown) => {
		const mounted = mountEditor({ source: 'one\n', presentationMode });

		expect(mounted.target.querySelector(TAIL_ROW) !== null).toBe(shown);
	});

	it('shown in reading mode anyway, writes nothing and warns', async () => {
		const h = makeTopHarness('one\n', { reading: fixtureReading({}, 'reading') });
		const target = document.body.appendChild(document.createElement('div'));
		const row = mount(TailInsert, {
			target,
			props: { blockEdit: h.actions, childCount: 1, readOnly: false }
		});
		flushSync();

		target.querySelector<HTMLButtonElement>(TAIL_ROW)!.click();
		await settleEditor();

		expect(serialize(h.deps.doc)).toBe('one\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
		await unmount(row);
		target.remove();
	});
});
