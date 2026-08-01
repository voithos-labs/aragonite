// `OpenContext.isDocumentParse` is the only signal separating a whole-document parse from a
// standalone parse of a fragment that happens to start at line 0 (issue #52). Position is
// composed from it plus `index`/`depth`, so the flag itself stays constant while nesting.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { registerBlockOpener, type OpenContext } from '../../schema/block-openers';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { resetEditorEnv } from '../../env';
import { activateDirectiveGrammar } from '../../core/directive/activate';
import { FRONT_MATTER, registerDocumentTopKind } from '../support/position-scoped-kind';

/** Every context the parser offers, in dispatch order; the probe declines them all. */
function observeContexts(): OpenContext[] {
	const seen: OpenContext[] = [];
	const kind = declarePluginKind('scope-probe');
	registerBlockOpener(kind, {
		priority: 0,
		interruptsParagraph: false,
		tryOpen: (ctx) => {
			seen.push(ctx);
			return null;
		}
	});
	return seen;
}

describe('parse scope', () => {
	beforeEach(__resetSchemaRegistriesForTests);
	afterEach(() => {
		__resetSchemaRegistriesForTests();
		resetEditorEnv();
	});

	it('a whole-document parse mints a position-scoped kind at the document top', () => {
		const kind = registerDocumentTopKind();

		expect(parse(FRONT_MATTER + '\nbody\n').children[0].kind).toBe(kind);
	});

	it('and nowhere else in that document', () => {
		const kind = registerDocumentTopKind();

		const doc = parse('intro\n\n' + FRONT_MATTER);

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	it('a fragment-scoped parse of the document-top bytes declines it', () => {
		const kind = registerDocumentTopKind();

		const doc = parse(FRONT_MATTER, { scope: 'fragment' });

		expect(doc.children.map((c) => c.kind)).not.toContain(kind);
	});

	// One case per container parser that forwards the flag — each forward defaults to false
	// when dropped, so only a per-parser pin makes an omitted forward red.
	const NESTED_BODIES: Array<{ label: string; source: string; activate?: () => void }> = [
		{ label: 'blockquote', source: '> quoted\n' },
		{ label: 'list item', source: '- item\n' },
		{
			label: 'directive container',
			source: ':::note\nbody\n:::\n',
			activate: activateDirectiveGrammar
		}
	];

	for (const body of NESTED_BODIES) {
		it(`reports true through ${body.label} recursion`, () => {
			body.activate?.();
			const seen = observeContexts();

			parse(body.source);

			const nested = seen.filter((ctx) => ctx.depth > 0);
			expect(nested.length).toBeGreaterThan(0);
			expect(nested.map((ctx) => ctx.isDocumentParse)).toEqual(nested.map(() => true));
		});

		it(`reports false at every depth of a ${body.label} fragment parse`, () => {
			body.activate?.();
			const seen = observeContexts();

			parse(body.source, { scope: 'fragment' });

			expect(seen.length).toBeGreaterThan(1);
			expect(seen.map((ctx) => ctx.isDocumentParse)).toEqual(seen.map(() => false));
		});
	}
});
