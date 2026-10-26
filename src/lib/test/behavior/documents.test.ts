// @vitest-environment jsdom
// How the spec examples, the showcase and the changelog parse, and keys at each join of their
// adjacent blocks, recorded as rows.
import { beforeAll, it } from 'vitest';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { documentRows } from './strata';
import { recordRows } from './rows';

beforeAll(installLayoutStubs);

it('records how the documents read and edit', async () => {
	recordRows('docs', await documentRows());
}, 600_000);
