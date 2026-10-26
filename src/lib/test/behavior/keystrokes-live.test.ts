// @vitest-environment jsdom
// Every key at every offset of the small documents in live mode, recorded as rows.
import { beforeAll, it } from 'vitest';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { keystrokeRows } from './strata';
import { recordRows } from './rows';

beforeAll(installLayoutStubs);

it('records where each key lands', async () => {
	recordRows('keys live', await keystrokeRows('live'));
}, 600_000);
