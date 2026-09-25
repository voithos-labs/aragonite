// @vitest-environment jsdom
//
// Keydown with a widget selected routes custom keys, such as Shift+Arrow to resize an image,
// through the widget kind's editing policy, with no branch on `kind === 'image'`. These run the
// whole dispatch: a real parse, `flattenInlineWidgets`, the policy lookup and the handler,
// including the nested `[![alt][ref]][repo]` reference image.
import { describe, it, expect, beforeAll } from 'vitest';
import { augmentInlineWidgetKind } from '$lib/core/inline/inline-widgets';
import { imageWidgetOnSelectedKey } from '$lib/components/image/image-widget-editing';
import { harness } from './widget-selected-fixture';
import { fixtureReading } from '../../harness/fixture-grammar';

beforeAll(() => {
	// Mirrors the mount-time wire-up (built-in-blocks.ts): the core image kind
	// carries no onSelectedKey until the editor layer attaches its resize handler.
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
});

function shiftRight(): KeyboardEvent {
	return new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true });
}

describe('handleSelectedWidgetKeydown: Shift+Arrow through the editing policy', () => {
	it('resizes a selected image via its onSelectedKey handler', async () => {
		const { interaction, commits } = harness('![a](x)\n', 0);
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ index: 0, before: 0, after: 11 });
		expect(commits[0].raw).toContain('![a|420](x)');
	});

	it('resizes a reference image nested in a link, keeping the reference form', async () => {
		const resolve = (label: string) => {
			const norm = label.toLowerCase();
			if (norm === 'shot') return { url: 'cat.png' };
			if (norm === 'repo') return { url: 'https://repo' };
			return undefined;
		};
		const { interaction, commits } = harness(
			'[![cat][shot]][repo]\n',
			1,
			fixtureReading({
				resolver: resolve,
				resolverSignature: 'shot|repo'
			})
		);
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ index: 0, before: 1, after: 17 });
		expect(commits[0].raw).toContain('![cat|420][shot]');
		expect(commits[0].raw).not.toContain('cat.png');
	});

	it('consumes Shift+Arrow on a non-resizable widget without committing an edit', async () => {
		// A `<br>` is a live widget whose policy declares no `onSelectedKey`: the key is
		// consumed, so it never leaks into stepping out, but nothing resizes.
		const { interaction, commits } = harness('a<br>b\n', 1);
		expect(await interaction.handleSelectedWidgetKeydown(shiftRight())).toBe(true);
		expect(commits).toEqual([]);
	});
});
