// @vitest-environment jsdom
// Every key the range's own handler claims is one `rangeOwnsKey` says it owns, so a container the
// key bubbles through stands down for exactly the keys the range handles.
// Miss-analysis: `rangeOwnsKey` restated the handler's branches by hand, and no test pressed the
// same keys through both, so the arrows, Escape and Mod+A ran in a container and the range at once.
import { describe, it, expect } from 'vitest';
import { makeKeydownEnv, press } from './keydown-env';
import { rangeOwnsKey } from '$lib/selection/cross-block/keydown';

const SOURCE = '- alpha\n- beta\n- gamma\n';

// Claimed and unclaimed keys side by side; Mod+] is bound to the list indent, Mod+[ to nothing.
const KEYS: [name: string, key: string, init: KeyboardEventInit][] = [
	['Backspace', 'Backspace', {}],
	['Delete', 'Delete', {}],
	['Mod+B', 'b', { ctrlKey: true }],
	['Mod+Shift+X', 'x', { ctrlKey: true, shiftKey: true }],
	['Tab', 'Tab', {}],
	['Shift+Tab', 'Tab', { shiftKey: true }],
	['Mod+] rebound to indent', ']', { ctrlKey: true }],
	['Enter', 'Enter', {}],
	['Mod+1', '1', { ctrlKey: true }],
	['Shift+ArrowDown', 'ArrowDown', { shiftKey: true }],
	['Shift+ArrowUp', 'ArrowUp', { shiftKey: true }],
	['Shift+ArrowLeft', 'ArrowLeft', { shiftKey: true }],
	['Shift+ArrowRight', 'ArrowRight', { shiftKey: true }],
	['Escape', 'Escape', {}],
	['ArrowLeft', 'ArrowLeft', {}],
	['ArrowDown', 'ArrowDown', {}],
	['Mod+A', 'a', { ctrlKey: true }],
	['Mod+Shift+End', 'End', { ctrlKey: true, shiftKey: true }],
	['a', 'a', {}],
	['Home', 'Home', {}],
	['Mod+Enter', 'Enter', { ctrlKey: true }],
	['Mod+X', 'x', { ctrlKey: true }],
	['Mod+Tab', 'Tab', { ctrlKey: true }],
	['Mod+[ unbound', '[', { ctrlKey: true }]
];

describe('the keys a live range owns', () => {
	for (const [name, key, init] of KEYS) {
		it(`${name}: the range's handler claims it exactly when the range owns it`, async () => {
			const env = makeKeydownEnv(SOURCE, {
				myPath: [0, 2, 0],
				keybindings: [{ chord: 'Mod+]', command: 'list.indent', kind: 'listItem' }]
			});
			env.selection.enterCrossBlock({ path: [0, 1, 0], offset: 1 }, { path: [0, 2, 0], offset: 2 });
			const event = press(key, init);
			const owned = rangeOwnsKey(event, env.ctx);

			await env.keydown.handleKeyDown(event);

			expect(event.defaultPrevented).toBe(owned);
		});
	}
});
