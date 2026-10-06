// @vitest-environment jsdom
// Tab over a selection inside one block is left to a block that binds it to an indent, here or in
// a container above, and taken for nothing everywhere else.
// Miss-analysis: the mounted rows reach a list item's Tab through the item's own keydown, which
// answers first, so a rule that took Tab always still passed them.
import { describe, it, expect, afterEach } from 'vitest';
import { makeKeydownEnv, press, type KeydownEnvOptions } from './keydown-env';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

/** Tab with the block's first two characters selected: whether the handler took it. */
async function tabOverSelection(source: string, options: KeydownEnvOptions) {
	const env = makeKeydownEnv(source, options);
	const el = env.ctx.getEl()!;
	el.textContent = 'beta';
	document.body.appendChild(el);
	window.getSelection()!.setBaseAndExtent(el.firstChild!, 0, el.firstChild!, 2);

	const event = press('Tab');
	const taken = await env.keydown.handleKeyDown(event);
	return { taken, prevented: event.defaultPrevented, source: env.source() };
}

describe('Tab over a selection inside one block', () => {
	it("in a list item's paragraph is left for the item to indent", async () => {
		const result = await tabOverSelection('- alpha\n- beta\n', { myPath: [0, 1, 0] });

		expect(result).toEqual({ taken: false, prevented: false, source: '- alpha\n- beta\n' });
	});

	it('in a list item whose Tab is unbound is taken for nothing', async () => {
		const result = await tabOverSelection('- alpha\n- beta\n', {
			myPath: [0, 1, 0],
			keybindings: [{ kind: 'listItem', chord: 'Tab', command: null }]
		});

		expect(result).toEqual({ taken: true, prevented: true, source: '- alpha\n- beta\n' });
	});

	it('in a plain paragraph is taken for nothing', async () => {
		const result = await tabOverSelection('beta\n', { myPath: [0] });

		expect(result).toEqual({ taken: true, prevented: true, source: 'beta\n' });
	});
});
