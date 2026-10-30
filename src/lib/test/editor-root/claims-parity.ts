// The parity table between `claimsChord` and the keydown handlers: each row mounts an editor, puts
// focus in one context, asks `claimsChord` from a window capture listener (where a host asks) and
// then reads what the handlers did with the same keystroke.

import { expect } from 'vitest';
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
import { mountEditor, type MountedEditor } from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

export type Probe = {
	getBlockComponent(path: number[]): BlockComponent | null;
	getGapCaret(): GapCaretPosition | null;
};

export interface ClaimContext {
	name: string;
	source: string;
	mode?: PresentationMode;
	plugins?: EditorPlugin[];
	keybindings?: KeybindingOverride[];
	/** Chords the context's plugins bind, which register only once it mounts. */
	pluginChords?: string[];
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
