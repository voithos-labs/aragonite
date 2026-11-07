// @vitest-environment jsdom
// Copy, cut, paste, Backspace, Delete and a typed key over drawn ranges in live mode, recorded as
// rows.
import { beforeAll, beforeEach, it } from 'vitest';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { rangeStratum } from './strata';
import { recordRows } from './rows';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});

it('records what each range gesture does', async () => {
	recordRows('range live', await rangeStratum('live'));
}, 600_000);
