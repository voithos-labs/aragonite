// @vitest-environment jsdom
// A materialized blank-line row's raw IS a line ending, so in a CRLF document it must be
// CRLF (G4.20). The payload is normalized to LF before parsing, so the row's ending can
// only come from the target document.
import { describe, it, expect } from 'vitest';
import { materializeBlankLines } from '../../../tree-operations/paste/strategy';
import { pasteDispatch, __getDefaultTextSurface } from '../../../tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '../../../tree-operations/paste-surfaces';
import { parse } from '../../../core/parser';
import { makeEditorActionsDeps, makeStubBlockEdit } from '../../harness/editor-actions';
import { createPasteCoordinator } from '../../../editor-actions/paste-coordinator';
import { createUndoController } from '../../../editor-actions/commit/undo-controller';

const clipboard = () => parse('# Heading\n\nNew paragraph\n').children;

describe('materializeBlankLines — minted row line ending', () => {
	it('mints the blank-line row with the ending it is handed', () => {
		expect(materializeBlankLines(clipboard(), '\r\n')[1].raw).toBe('\r\n');
	});

	it('leaves an LF document on LF', () => {
		expect(materializeBlankLines(clipboard(), '\n')[1].raw).toBe('\n');
	});
});

// The payload's own bytes keep the endings the clipboard authored; only the MINTED row
// has no provenance of its own.
describe('structural paste into a CRLF document', () => {
	it('mints the payload blank-line row at the target document ending', async () => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
		const { deps } = makeEditorActionsDeps(parse('Hello\r\n').children);

		await pasteDispatch(
			{ pastedText: '# Heading\n\nNew paragraph\n', targetPath: [0], offset: 5 },
			{
				doc: deps.doc,
				blockEdit: makeStubBlockEdit(),
				controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
				undoEntry: 'own'
			}
		);

		const mintedRows = deps.doc.children.filter((n) => n.raw === '\n' || n.raw === '\r\n');
		expect(mintedRows.map((n) => n.raw)).toEqual(['\r\n']);
	});
});
