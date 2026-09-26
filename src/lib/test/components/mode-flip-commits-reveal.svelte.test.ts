// @vitest-environment jsdom
// A mode switch folds an open source view through its blur, and that commit must land while the
// editor is still in the mode the user typed in: a switch to reading would otherwise refuse it.
// Miss-analysis: the flip's commit was pinned only by e2e byte checks, and nothing read the mode
// the write saw, so a commit landing after the switch passed until reading mode refused writes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '$lib/test/harness/mount-editor.svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';
import type { PresentationMode } from '$lib/presentation-mode';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { takeDevWarns } from '../support/warn-gate';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

const OPENED = '$$\nold\n$$\n';

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

/** Opens the block's source, types a draft into it with focus inside, then switches modes. */
async function flipWithOpenDraft(to: PresentationMode): Promise<string> {
	const mounted = mountEditor<{
		getBlockComponent(path: number[]): { parkCaret?(offset: number): void } | null;
	}>({ source: OPENED, plugins: [latexPlugin({ renderer: stubRenderer })] });
	mounted.instance.__test.getBlockComponent([0])!.parkCaret!(0);
	await mounted.settle();
	const source = mounted.target.querySelector<HTMLElement>('.math-block-source');
	expect(source, 'the block opened no source view').not.toBeNull();
	source!.textContent = '$$\nnew\n$$';
	source!.focus();
	expect(document.activeElement).toBe(source);

	mounted.props.presentationMode = to;
	await mounted.settle();
	return mounted.source();
}

describe('a mode switch commits the edit an open source view was holding', () => {
	it.each(['reading', 'live'] as const)(
		'switching to %s keeps the edit, written in the mode it was typed in',
		async (to) => {
			expect(await flipWithOpenDraft(to)).toBe('$$\nnew\n$$\n');
			expect(takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG)).toEqual([]);
		}
	);
});
