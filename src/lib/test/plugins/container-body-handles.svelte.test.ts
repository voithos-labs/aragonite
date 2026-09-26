// @vitest-environment jsdom
//
// A container whose children reorder among themselves shows their drag handles, the way a quote
// does, so a body block the keyboard can move can be dragged too; text inside still shows none.
// Miss-analysis: the handle tests mounted built-in containers only, and the plugin container
// factory hardcoded its children as not reorderable while its descriptors declared otherwise.
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | undefined;

beforeEach(() => {
	resetPluginPlatformForTests();
});

afterEach(async () => {
	await mounted?.destroy();
	mounted = undefined;
});

function hostAt(path: number[]): Element {
	const host = mounted!.target.querySelector(
		`.block-host[data-block-path="${JSON.stringify(path)}"]`
	);
	expect(host, `no block at ${JSON.stringify(path)}`).not.toBeNull();
	return host!;
}

const handleOn = (path: number[]) => hostAt(path).querySelector(':scope > .block-drag-handle');

const CASES = [
	{
		name: 'an alert',
		source: '> [!NOTE]\n> a\n>\n> ```\n> code\n> ```\n',
		plugins: () => [admonitionsPlugin()]
	},
	{
		name: 'a footnote definition',
		source: '[^1]: a\n\n    ```\n    code\n    ```\n',
		plugins: () => [footnotesPlugin()]
	}
];

describe('drag handles on the body of a container that reorders its children', () => {
	for (const { name, source, plugins } of CASES) {
		it(`shows one on a code block in ${name}, and none on its text`, () => {
			mounted = mountEditor({ source, plugins: plugins() });
			expect(hostAt([0, 0]).classList.contains('reorder-host')).toBe(true);
			expect(handleOn([0, 0])).toBeNull();
			expect(handleOn([0, 1])).not.toBeNull();
		});
	}
});
