// @vitest-environment jsdom
// Miss-analysis: a DOM container view marks one element twice (its own listener and the factory's
// box), and no row let one owner go while the other still dispatched from it.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	containerChordKinds,
	listenForContainerChords
} from '#lib/editor-actions/container-chords.svelte.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

const KIND = 'listItem' as AnyBlockKind;

beforeAll(installLayoutStubs);
afterEach(destroyMountedEditors);

describe('container chord marks', () => {
	it('keep an element marked until its last owner lets go', () => {
		const box = document.body.appendChild(document.createElement('div'));
		const leaf = box.appendChild(document.createElement('p'));
		const first = listenForContainerChords(box, KIND, () => {});
		const second = listenForContainerChords(box, KIND, () => {});
		first();
		expect(containerChordKinds(leaf)).toEqual([KIND]);
		second();
		expect(containerChordKinds(leaf)).toEqual([]);
		box.remove();
	});

	// Miss-analysis: the mark read the container's node, so every edit inside that copied the node
	// marked its box again and rebound the list item's keydown.
	it('are written once, not again as the text inside the containers changes', async () => {
		const editor = mountEditor({
			source: '> - item text\n\n:::note\n\nTip\n\n:::\n',
			presentationMode: 'source',
			plugins: [admonitionsPlugin()]
		});
		await editor.settle();
		const marked: string[] = [];
		const setAttribute = Element.prototype.setAttribute;
		Element.prototype.setAttribute = function (name: string, value: string) {
			if (name === 'data-container-chords') marked.push(value);
			setAttribute.call(this, name, value);
		};
		try {
			const item = surfaceAt(editor, [0, 0, 0, 0]);
			typeInto(item, `${item.textContent}x`);
			await editor.settle();
			const tip = [...editor.target.querySelectorAll<HTMLElement>('[contenteditable]')].find(
				(el) => el.textContent === 'Tip'
			)!;
			typeInto(tip, 'Tipx');
			await editor.settle();
		} finally {
			Element.prototype.setAttribute = setAttribute;
		}
		expect(editor.instance.getSource()).toBe('> - item textx\n\n:::note\n\nTipx\n\n:::\n');
		expect(marked).toEqual([]);
	});
});
