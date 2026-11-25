// @vitest-environment jsdom
// Miss-analysis: the language offer was tested by clicking into a fence, never by keyboard arrival.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, tick } from 'svelte';
import { createCaretMemory } from '#lib/caret/caret-memory.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { makeStubBlockEdit } from '#lib/test/harness/editor-actions.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { mountCode, type MountedCode } from './mount-code';

const BARE_FENCE = '```\n```\n';

let mounted: MountedCode | null = null;

afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

async function focusFence(arrival: 'step' | 'seat' | 'removal'): Promise<void> {
	const caretMemory = createCaretMemory();
	if (arrival === 'step') caretMemory.noteKey({ key: 'ArrowRight' }, null);
	if (arrival === 'removal') caretMemory.noteRemovalLanding();
	mounted = mountCode(BARE_FENCE, {
		mode: () => 'live',
		services: { caretMemory }
	});
	mounted.el.focus();
	flushSync();
	// The offer defers past the completion's own focus work by two ticks.
	await tick();
	await tick();
	await tick();
	flushSync();
}

const picker = () => mounted!.target.querySelector('.code-lang-picker');
const completions = () => mounted!.blockEdit.updateBlockContent;

describe('a bare fence taking the caret', () => {
	it('completes and offers a language when the caret was placed, not stepped', async () => {
		await focusFence('seat');

		expect(completions()).toHaveBeenCalledWith(
			0,
			'```\n\n```\n',
			'authored',
			'join-typing',
			expect.anything(),
			4,
			undefined
		);
		expect(picker()).not.toBeNull();
	});

	// Miss-analysis: every stub write resolved at once, so a picker opened on a guessed number of
	// ticks looked the same as one opened after the completion landed.
	it('offers the language only once the completion has landed', async () => {
		let land: (wrote: boolean) => void = () => {};
		const landing = new Promise<boolean>((resolve) => (land = resolve));
		const blockEdit = makeStubBlockEdit();
		blockEdit.updateBlockContent.mockImplementationOnce((_i, _text, _mode, _pre, caret) =>
			withStoredCaret(landing, caret ?? 0)
		);
		mounted = mountCode(BARE_FENCE, {
			blockEdit,
			mode: () => 'live'
		});
		mounted.el.focus();
		await settleEditor();
		flushSync();
		expect(completions()).toHaveBeenCalledOnce();
		expect(picker()).toBeNull();

		land(true);
		await settleEditor();
		flushSync();
		expect(picker()).not.toBeNull();
	});

	// A step from a neighbour passes through; a removal's landing is an edit, not someone authoring.
	it.each(['step', 'removal'] as const)(
		'completes but keeps the caret when the caret arrived by a %s',
		async (arrival) => {
			await focusFence(arrival);

			expect(completions()).toHaveBeenCalledWith(
				0,
				'```\n\n```\n',
				'authored',
				'join-typing',
				expect.anything(),
				4,
				undefined
			);
			expect(picker()).toBeNull();
		}
	);
});
