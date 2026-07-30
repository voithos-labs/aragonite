// @vitest-environment jsdom
//
// The blockquote's ONE behavioral override: Enter on an empty trailing paragraph
// leaves the quote instead of appending another `>` line. It is installed by
// `createContainerBlock` wiring `createBlockquoteOverrides` into the nested bundle,
// and the component names nothing to select it — so the override arriving at all is
// invisible from the component's own source.
//
// No GFM source parses to a blockquote holding an empty trailing paragraph (the blank
// `>` line lands in innerSuffix), so that child only exists after an in-editor Enter.
// Both presses are driven here, which is also the gesture a user actually makes.
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

		// Two `>` lines, not one: the split's blank-line separator plus the empty
		// paragraph it made. Without the separator a line typed there would lazily
		// continue `alpha` on reload.
		await pressKeyAt(mounted, [0, 0], 5, ENTER);
		expect(mounted.source()).toBe('> alpha\n>\n>\n');

		await pressKeyAt(mounted, [0, 1], 0, ENTER);

		expect(mounted.source()).toBe('> alpha\n\n\n');
	});

	// The same keystroke on a non-trailing child: the override declines and the shared
	// split runs. Without this the exit test alone would still pass if the override
	// swallowed every Enter.
	it('leaves an Enter on a non-trailing child to the default split', async () => {
		mounted = mountEditor({ source: '> alpha\n>\n> beta\n' });

		await pressKeyAt(mounted, [0, 0], 5, ENTER);

		expect(mounted.source()).toBe('> alpha\n>\n>\n>\n> beta\n');
	});
});
