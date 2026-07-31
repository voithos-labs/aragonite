// @vitest-environment jsdom
//
// The blockquote's ONE behavioral override: Enter on an empty trailing paragraph leaves
// the quote. `createContainerBlock` wires `createBlockquoteOverrides` into the nested
// bundle and the component names nothing to select it, so its arrival is invisible from
// the source. No GFM parses to a blockquote holding an empty trailing paragraph, so that
// child only exists after an in-editor Enter — both presses are driven here.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../editor-mount';

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

const ENTER = { key: 'Enter' };

describe('blockquote Enter override', () => {
	it('exits the quote on a second Enter, dropping the empty line it made', async () => {
		mounted = mountEditor({ source: '> alpha\n' });

		// Two `>` lines: the split's blank-line separator plus the empty paragraph it made.
		// Without the separator a line typed there would lazily continue `alpha` on reload.
		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n');
	});

	// Non-vacuity: the exit case alone passes even if the override swallowed every Enter.
	it('leaves an Enter on a non-trailing child to the default split', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);

		expect(mounted.source()).toBe('> alpha\n>\n>\n>\n> beta\n');
	});
});
