// The document converter reads a document as an editor listing admonitions reads it, whatever the
// page has turned on, so an alert inside a `:::` box stays even where nothing else reads `:::`.
// Miss-analysis: every converter row ran after a grammar had turned `:::` on page-wide, so no row
// asked what the converter reads in a process where nothing has.
import { expect, it } from 'vitest';
import { convertGithubAlertsInDocument } from '#packages/admonitions/src/index.js';

it('leaves an alert inside a box as it is, in a process nothing turned `:::` on in', () => {
	const boxes = ':::note Outer\n> [!TIP]\n> x\n:::\n\n:::aside\n> [!TIP]\n> y\n:::\n\n';
	expect(convertGithubAlertsInDocument(`${boxes}> [!NOTE]\n> top\n`)).toEqual({
		converted: `${boxes}:::note\ntop\n:::\n`,
		changed: true
	});
});
