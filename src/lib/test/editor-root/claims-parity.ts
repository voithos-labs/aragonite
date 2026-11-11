// The parity table between `claimsChord` and the keydown handlers: each row mounts an editor, puts
// focus in one context, asks `claimsChord` from a window capture listener (where a host asks) and
// then reads what the handlers did with the same keystroke.
// Miss-analysis for the keyless row: every row sent a `KeyboardEvent`, which always names a key, so
// none sent the keyless keydown Chrome's autofill dispatches.

import { describe, expect, it } from 'vitest';
import type { BlockComponent } from '#lib/block-component.js';
import type { KeybindingOverride } from '#lib/schema/keybinding-overrides.js';
import type { EditorPlugin } from '#lib/plugin.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { getAllRegisteredKinds } from '#lib/schema/block-kind-descriptor.js';
import { kindKeymap } from '#lib/schema/commands.js';
import { textKeyRole } from '#lib/schema/keybindings.js';
import { collectReservedChords } from '#lib/schema/reserved-chords.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import type { GapCaretPosition } from '#lib/selection/gap-caret.js';
import type { KeyFocus } from '#lib/components/editor-root/key-claims.js';
import { mountEditor, type MountedEditor } from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

export type Probe = {
	getBlockComponent(path: number[]): BlockComponent | null;
	getGapCaret(): GapCaretPosition | null;
	getKeyFocus(e: KeyboardEvent): KeyFocus;
};

export interface ClaimContext {
	name: string;
	source: string;
	mode?: PresentationMode;
	plugins?: EditorPlugin[];
	keybindings?: KeybindingOverride[];
	/** Chords the context's plugins bind, which register only once it mounts. A `-t` filter for one
	 *  of them escapes the `+` (`-t "container.*Mod.7"`). */
	pluginChords?: string[];
	/** Narrows the row's keys to the chords the context differs on. */
	only?: string[];
	/** Where the handler that takes the context's keys stands, which `claimsChord` must read too. */
	focus?: Partial<KeyFocus>;
	/** Puts focus where the row's keys go and returns the element a browser would send them to. */
	enter(editor: MountedEditor<Probe>): Promise<HTMLElement>;
}

/** A chord in the keymap's spelling as the keydown a non-Mac browser sends for it. */
export function chordInit(chord: string): KeyboardEventInit {
	const parts = chord.split('+');
	let key = parts.pop()!;
	if (key === '') key = '+';
	const shiftKey = parts.includes('Shift');
	if (/^[A-Za-z]$/.test(key)) key = shiftKey ? key.toUpperCase() : key.toLowerCase();
	if (key === 'Space') key = ' ';
	return { key, ctrlKey: parts.includes('Mod'), altKey: parts.includes('Alt'), shiftKey };
}

const EXTRA_KEYS = [
	'Enter',
	'Shift+Enter',
	'Tab',
	'Shift+Tab',
	'Escape',
	'Backspace',
	'Delete',
	'A',
	'Shift+A',
	'Space',
	'F5',
	'ContextMenu',
	'PageDown',
	'Shift+PageUp',
	'Home',
	'Shift+End',
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Shift+ArrowDown',
	'Alt+ArrowLeft',
	'Alt+ArrowRight',
	'Mod+ArrowLeft',
	'Mod+ArrowUp',
	'Alt+Shift+K',
	'Mod+Q',
	'Mod+U',
	'Mod+V',
	'Mod+C',
	'Mod+X',
	'Shift+Insert',
	'Mod+Shift+7'
];

/** Every chord any table binds, plus the bare keys, caret keys and unbound chords a host might
 *  bind, read once the suite's kinds are registered. */
export function keysToProbe(): string[] {
	const keymaps = getAllRegisteredKinds().flatMap((kind) => kindKeymap(kind).map((b) => b.chord));
	const union = collectReservedChords({ searchBar: true, activation: everyInstalledPlugin });
	return [...new Set([...union, ...keymaps, ...EXTRA_KEYS])].sort();
}

/** Mounts `context`, sends `chord` where it puts focus, and returns both answers. */
export async function probe(context: ClaimContext, chord: string) {
	const editor = mountEditor<Probe>({
		source: context.source,
		presentationMode: context.mode ?? 'source',
		plugins: context.plugins,
		keybindings: context.keybindings
	});
	try {
		await editor.settle();
		const el = await context.enter(editor);
		let claimed: boolean | null = null;
		const ask = (e: KeyboardEvent) => (claimed = editor.instance.claimsChord(e));
		window.addEventListener('keydown', ask, true);
		const event = await pressKey(el, chordInit(chord));
		window.removeEventListener('keydown', ask, true);
		return { claimed: claimed as boolean | null, prevented: event.defaultPrevented, event };
	} finally {
		await editor.destroy();
	}
}

// A claimed key was prevented and an unclaimed one was not, read once the handlers finish (one that
// prevents only after a real wait is a handler defect); a text field's own keys need no prevent.
export async function expectParity(context: ClaimContext, chord: string): Promise<void> {
	const { claimed, prevented, event } = await probe(context, chord);
	expect(claimed, `${context.name}: claimsChord was never asked`).not.toBeNull();
	if (claimed && textKeyRole(event) !== null) return;
	expect(claimed, `${context.name} ${chord}: claimsChord against what the keydown did`).toBe(
		prevented
	);
}

const isTextKey = (chord: string) =>
	textKeyRole(new KeyboardEvent('keydown', chordInit(chord))) !== null;

/** The chords a context is held to: `only`, or every probed key plus the context's plugin chords. */
export function contextChords(context: ClaimContext): string[] {
	return context.only ?? [...keysToProbe(), ...(context.pluginChords ?? [])];
}

/** `claimsChord`'s answer for each chord at the context's focus, asked with no handler run. */
async function askClaims(context: ClaimContext, chords: string[]): Promise<Map<string, boolean>> {
	const editor = mountEditor<Probe>({
		source: context.source,
		presentationMode: context.mode ?? 'source',
		plugins: context.plugins,
		keybindings: context.keybindings
	});
	try {
		await editor.settle();
		const el = await context.enter(editor);
		const answers = new Map<string, boolean>();
		let chord = '';
		const ask = (e: KeyboardEvent) => {
			answers.set(chord, editor.instance.claimsChord(e));
			e.stopImmediatePropagation();
		};
		window.addEventListener('keydown', ask, true);
		for (chord of chords) {
			el.dispatchEvent(
				new KeyboardEvent('keydown', { ...chordInit(chord), bubbles: true, cancelable: true })
			);
		}
		window.removeEventListener('keydown', ask, true);
		return answers;
	} finally {
		await editor.destroy();
	}
}

// A claimed text key passes whatever the handler does, so only the unclaimed ones press the key.
async function expectTextKeysParity(context: ClaimContext, chords: string[]): Promise<void> {
	const answers = await askClaims(context, chords);
	for (const chord of chords) {
		expect(answers.has(chord), `${context.name} ${chord}: claimsChord was never asked`).toBe(true);
		if (!answers.get(chord)) await expectParity(context, chord);
	}
}

/** A keydown and a keyup that name no key, as Chrome sends when it autofills a field, at the
 *  context's element and at the document: nothing throws, prevents or claims them, or moves. */
async function expectKeylessIgnored(context: ClaimContext): Promise<void> {
	const editor = mountEditor<Probe>({
		source: context.source,
		presentationMode: context.mode ?? 'source',
		plugins: context.plugins,
		keybindings: context.keybindings
	});
	const errors: unknown[] = [];
	const onError = (e: ErrorEvent) => errors.push(e.error);
	const onRejection = (reason: unknown) => errors.push(reason);
	const claims: boolean[] = [];
	const ask = (e: Event) => claims.push(editor.instance.claimsChord(e as KeyboardEvent));
	try {
		await editor.settle();
		const el = await context.enter(editor);
		const before = { source: editor.source(), selection: editor.instance.getSelection() };
		window.addEventListener('error', onError);
		process.on('unhandledRejection', onRejection);
		window.addEventListener('keydown', ask, true);
		const sent = [el, document].flatMap((target) =>
			['keydown', 'keyup'].map((type) => {
				const event = new Event(type, { bubbles: true, cancelable: true });
				target.dispatchEvent(event);
				return event;
			})
		);
		await editor.settle();
		// Node reports a rejected async handler only once the task ends.
		await new Promise((done) => setImmediate(done));
		expect(errors, context.name).toEqual([]);
		expect(claims, `${context.name}: claimsChord`).toEqual([false, false]);
		expect(sent.map((e) => e.defaultPrevented)).toEqual([false, false, false, false]);
		expect(editor.source()).toBe(before.source);
		expect(editor.instance.getSelection()).toEqual(before.selection);
	} finally {
		window.removeEventListener('keydown', ask, true);
		window.removeEventListener('error', onError);
		process.off('unhandledRejection', onRejection);
		await editor.destroy();
	}
}

/** One row per context: a key event naming no key, which every handler skips and `claimsChord`
 *  leaves alone. */
export function describeKeyless(contexts: ClaimContext[]): void {
	it.each(contexts)('a key event naming no key is ignored: $name', expectKeylessIgnored);
}

/** One row per non-text chord per context, one per context for its text keys, and the keyless
 *  row. */
export function describeParity(contexts: ClaimContext[]): void {
	describe('claimsChord reads the focus its handler stands at', () => {
		it.each(contexts.filter((context) => context.focus))('$name', expectFocusAgrees);
	});
	describe.each(contexts)('claimsChord agrees with the keydown: $name', (context) => {
		const chords = contextChords(context);
		it.each(chords.filter((chord) => !isTextKey(chord)))('%s', (chord) =>
			expectParity(context, chord)
		);
		it('text keys', { timeout: 60_000 }, () =>
			expectTextKeysParity(
				context,
				chords.filter((chord) => isTextKey(chord))
			)
		);
	});
	describeKeyless(contexts);
}

/** `claimsChord`'s read of where a key lands agrees with where the context's handler stands, the
 *  one way the two can still disagree once both ask the same decision. */
export async function expectFocusAgrees(context: ClaimContext): Promise<void> {
	const editor = mountEditor<Probe>({
		source: context.source,
		presentationMode: context.mode ?? 'source',
		plugins: context.plugins,
		keybindings: context.keybindings
	});
	try {
		await editor.settle();
		const el = await context.enter(editor);
		let focus: KeyFocus | null = null;
		const read = (e: KeyboardEvent) => (focus = editor.instance.__test.getKeyFocus(e));
		window.addEventListener('keydown', read, true);
		await pressKey(el, { key: 'F24' });
		window.removeEventListener('keydown', read, true);
		expect(focus, context.name).toMatchObject(context.focus!);
	} finally {
		await editor.destroy();
	}
}
