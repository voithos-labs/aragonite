// @vitest-environment jsdom
// Every key that lifts a nested item out of its sublist keeps the document's order, since the
// item's later siblings become its own last children.
// Miss-analysis: every lift fixture lifted the last item of its sublist, or checked the lifted
// line with a regex, so none read the order of the items left after it.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '$lib/test/harness/mount-editor.svelte';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

// Each route lifts one item out of `alpha`'s sublist with two siblings still after it.
const ROUTES: [route: string, source: string, key: KeyboardEventInit, lifted: string][] = [
	[
		'Shift+Tab',
		'- alpha\n  - beta\n  - gamma\n  - delta\n- omega\n',
		{ key: 'Tab', shiftKey: true },
		'- alpha\n- beta\n  - gamma\n  - delta\n- omega\n'
	],
	[
		'Backspace at the start of a sublist',
		'- alpha\n  - beta\n  - gamma\n  - delta\n- omega\n',
		{ key: 'Backspace' },
		'- alpha\n- beta\n  - gamma\n  - delta\n- omega\n'
	],
	[
		'Enter in an empty nested item',
		'- alpha\n  - beta\n  - \n  - gamma\n  - delta\n- omega\n',
		{ key: 'Enter' },
		'- alpha\n  - beta\n- \n  - gamma\n  - delta\n- omega\n'
	]
];

describe('lifting a nested item keeps the document in order', () => {
	for (const [route, source, key, lifted] of ROUTES) {
		it(`${route}: the later siblings become the lifted item's children`, async () => {
			mounted = mountEditor({ source });
			const path = route.startsWith('Enter') ? [0, 0, 1, 1, 0] : [0, 0, 1, 0, 0];
			await pressKeyAt(mounted, path, 0, key);

			expect(mounted.source()).toBe(lifted);
		});
	}

	// Everything after the lifted item inside `alpha` comes along: a paragraph, another sublist, or
	// the next sublist of a loose list, which parses into one sublist per item.
	const AFTER_THE_SUBLIST: [shape: string, source: string, lifted: string][] = [
		[
			'a paragraph',
			'- alpha\n  - beta\n  - gamma\n\n  more\n',
			'- alpha\n- beta\n  - gamma\n\n  more\n'
		],
		[
			'an ordered sublist',
			'- alpha\n  - beta\n  - gamma\n\n  1. one\n',
			'- alpha\n- beta\n  - gamma\n\n  1. one\n'
		],
		[
			'the next item of a loose list',
			'- alpha\n\n  - beta\n\n  - gamma\n\n- delta\n',
			'- alpha\n- beta\n\n  - gamma\n\n- delta\n'
		]
	];
	for (const [shape, source, lifted] of AFTER_THE_SUBLIST) {
		for (const [route, key] of [
			['Shift+Tab', { key: 'Tab', shiftKey: true }],
			['Backspace', { key: 'Backspace' }]
		] as const) {
			it(`${route} on beta carries ${shape} after its sublist`, async () => {
				mounted = mountEditor({ source });
				await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, key);

				expect(mounted.source()).toBe(lifted);
			});
		}
	}

	it('Enter in an empty item of a loose nested list carries the next item', async () => {
		mounted = mountEditor({ source: '- alpha\n\n  - beta\n\n  - \n\n  - gamma\n' });
		await pressKeyAt(mounted, [0, 0, 2, 0, 0], 0, { key: 'Enter' });

		expect(mounted.source().indexOf('- \n')).toBeLessThan(mounted.source().indexOf('gamma'));
		expect(mounted.source().match(/alpha|beta|gamma/g)).toEqual(['alpha', 'beta', 'gamma']);
	});

	it('the lifted item keeps its own children first, then takes its siblings', async () => {
		mounted = mountEditor({ source: '- alpha\n  - beta\n    - one\n  - gamma\n' });
		await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, { key: 'Tab', shiftKey: true });

		expect(mounted.source()).toBe('- alpha\n- beta\n  - one\n  - gamma\n');
	});

	it('ordered siblings renumber from one under the lifted item', async () => {
		mounted = mountEditor({ source: '1. P A\n   1. N A\n   2. N B\n   3. N C\n2. P B\n' });
		await pressKeyAt(mounted, [0, 0, 1, 0, 0], 0, { key: 'Tab', shiftKey: true });

		expect(mounted.source()).toBe('1. P A\n2. N A\n   1. N B\n   2. N C\n3. P B\n');
	});
});
