// @vitest-environment jsdom
// Miss-analysis: no row pressed inside a drawing that stops the press, since a component the
// editor renders gets its events after the editor's, and a drawing is mounted inside the editor.
// G1.252: a press that starts inside a block type's drawing reaches the editor; a dev build names
// one the drawing stopped, and stays quiet for one it claims with `keep`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** A box drawing one button whose press either stops or is claimed with `keep`. */
function pressing(name: 'stopping' | 'claiming') {
	const stops = name === 'stopping';
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				fencedBlock({
					name: 'box',
					label: 'Box',
					fence: { info: name },
					sample: `\`\`\`${name}\nx\n\`\`\``,
					insert: { none: 'a test block type' },
					edit: 'box',
					draw: () => {
						const dom = document.createElement('div');
						const button = document.createElement('button');
						if (stops) button.addEventListener('pointerdown', (e) => e.stopPropagation());
						dom.append(button);
						return { dom, keep: (e: Event) => !stops && e.type === 'pointerdown' };
					}
				})
			]
		})
	});
}

const PLUGINS = { stopping: pressing('stopping'), claiming: pressing('claiming') };

async function pressInside(name: keyof typeof PLUGINS): Promise<void> {
	const editor = mountEditor({
		source: `Above\n\n\`\`\`${name}\nx\n\`\`\`\n`,
		plugins: [PLUGINS[name]]
	});
	await editor.settle();
	const button = editor.target.querySelector('button')!;
	button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	document.dispatchEvent(new Event('pointerup', { bubbles: true }));
}

describe('a press inside a drawing (G1.252)', () => {
	it('is named in a dev build when the drawing stops it', async () => {
		await pressInside('stopping');
		const fired = takeDevWarnsOf('invariant:press-reaches-editor');
		expect(fired).toHaveLength(1);
		expect(fired[0].message).toContain('keep');
	});

	it('passes when the drawing claims it with keep', async () => {
		await pressInside('claiming');
		expect(takeDevWarnsOf('invariant:press-reaches-editor')).toHaveLength(0);
	});
});
