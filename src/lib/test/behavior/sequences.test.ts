// @vitest-environment jsdom
// Seeded runs of keys into one mount, then undoing and redoing them all, recorded as rows.
import { beforeAll, it } from 'vitest';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { sequenceStratum } from './strata';
import { recordRows } from './rows';

beforeAll(installLayoutStubs);

it('records what each seeded sequence does', async () => {
	recordRows('seq', await sequenceStratum());
}, 600_000);
