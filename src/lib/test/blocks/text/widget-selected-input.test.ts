// @vitest-environment jsdom
// Miss-analysis: text over a selected widget was claimed after the block's own input steps, and only
// text, so the auto-pair took `*` first and no test sent a delete or a break with no key.
import { describe, it, expect } from 'vitest';
import { harness } from './widget-selected-fixture';

const input = (inputType: string, init: InputEventInit = {}) =>
	new InputEvent('beforeinput', { inputType, cancelable: true, ...init });

describe('input that reaches a block whose widget is selected whole', () => {
	it.each(['Z', '*', '`'])('text %j replaces the widget, as its key does', (text) => {
		const { interaction, commits, selection } = harness('a ![x](u) b\n', 2);
		const e = input('insertText', { data: text });
		expect(interaction.inputOverSelected(e)).toBe(true);
		expect(e.defaultPrevented).toBe(true);
		expect(commits.map((c) => c.raw)).toEqual([`a ${text} b\n`]);
		expect(selection.widget).toBeNull();
	});

	it.each(['deleteContentBackward', 'deleteContentForward', 'deleteWordBackward'])(
		'%s removes the widget',
		(inputType) => {
			const { interaction, commits, selection } = harness('a ![x](u) b\n', 2);
			const e = input(inputType);
			expect(interaction.inputOverSelected(e)).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(commits.map((c) => c.raw)).toEqual(['a  b\n']);
			expect(selection.widget).toBeNull();
		}
	);

	it.each(['insertLineBreak', 'insertParagraph', 'insertReplacementText', 'formatBold'])(
		'%s is refused and the widget stays selected',
		(inputType) => {
			const { interaction, commits, selection } = harness('a ![x](u) b\n', 2);
			const e = input(inputType, { data: 'word' });
			expect(interaction.inputOverSelected(e)).toBe(true);
			expect(e.defaultPrevented).toBe(true);
			expect(commits).toEqual([]);
			expect(selection.widget).not.toBeNull();
		}
	);

	it.each([
		['an IME’s run', input('insertCompositionText', { data: 'か' })],
		['a paste', input('insertFromPaste')],
		['undo', input('historyUndo')],
		['an input that can’t be cancelled', input('insertText', { data: 'Z', cancelable: false })]
	])('%s is left alone', (_name, e) => {
		const { interaction, commits, selection } = harness('a ![x](u) b\n', 2);
		expect(interaction.inputOverSelected(e)).toBe(false);
		expect(e.defaultPrevented).toBe(false);
		expect(commits).toEqual([]);
		expect(selection.widget).not.toBeNull();
	});

	it('takes nothing once the widget is no longer selected', () => {
		const { interaction, selection } = harness('a ![x](u) b\n', 2);
		selection.clearWidget();
		expect(interaction.inputOverSelected(input('insertText', { data: 'Z' }))).toBe(false);
	});
});
