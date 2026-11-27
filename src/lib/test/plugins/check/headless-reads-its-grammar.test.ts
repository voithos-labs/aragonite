// `createHeadlessActions`, which the kits build on, reads text with the grammar its caller's
// reading names, so a plugin value's syntax reads as that value's editor reads it, never page-wide.
// Miss-analysis: every kit handed it a tree it had parsed itself, so no row passed it text with a
// reading, where it parsed page-wide and `:::note` read as a generic box.
import { afterEach, describe, expect, it } from 'vitest';
import { check, configureEditorEnv, resetEditorEnv } from '#lib/testing.js';
import { createHeadlessActions } from '#lib/testing/headless-actions.js';
import { kitReading } from '#lib/testing/kit-reading.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { ADMONITION, admonitionsGrammar } from '../../support/admonitions-grammar';

describe('createHeadlessActions reads with its caller’s grammar', () => {
	afterEach(() => resetEditorEnv());

	it('check() over the admonitions value passes: the author’s own route reads boxes', async () => {
		configureEditorEnv({ isDev: true });
		const report = await check(admonitions);
		expect(report.rows.filter((row) => row.status === 'failed')).toEqual([]);
	});

	it('text handed with a reading reads with that reading’s grammar', () => {
		const reading = { ...kitReading(), grammar: admonitionsGrammar() };
		const { doc } = createHeadlessActions(':::note\nbody\n:::\n', { reading });
		expect(doc.children[0].kind).toBe(ADMONITION);
	});
});
