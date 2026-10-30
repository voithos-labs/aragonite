// @vitest-environment jsdom
// Miss-analysis: a DOM container view marks one element twice (its own listener and the factory's
// box), and no row let one owner go while the other still dispatched from it.
import { describe, expect, it } from 'vitest';
import {
	containerChordKinds,
	listenForContainerChords
} from '#lib/editor-actions/container-chords.svelte.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';

const KIND = 'listItem' as AnyBlockKind;

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
});
