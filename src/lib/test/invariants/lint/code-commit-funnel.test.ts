/**
 * G4.24: the code block commits its display through one function, `commitDisplay`, because the
 * fence has to grow past any body line the parser would read as its closer on every commit. This
 * fails the day another gesture in `CodeBlock.svelte` writes around it; byte writes reaching a code
 * block from elsewhere answer to G4.28.
 */
import { describe, it, expect } from 'vitest';
import { balancedBlock, balancedRegion, readEditorFile, stripComments } from './scan-source';

const CALL = 'blockEdit.updateBlockContent(';

/** The `commitDisplay` body, or null where the declaration is gone; pass comment-stripped code. */
function commitDisplayBody(code: string): string | null {
	const start = code.indexOf('function commitDisplay(');
	if (start < 0) return null;
	const params = balancedRegion(code, code.indexOf('(', start));
	if (params === null) return null;
	const open = code.indexOf('{', code.indexOf('(', start) + params.length);
	return open < 0 ? null : balancedBlock(code, open + 1);
}

describe('G4.24 code-surface commit shared path', () => {
	const { code } = readEditorFile('components/blocks/code/CodeBlock.svelte');

	it('CodeBlock holds exactly one updateBlockContent call', () => {
		const calls = code.split(CALL).length - 1;
		expect(
			calls,
			'every display commit goes through commitDisplay, which is where the fence bytes are written'
		).toBe(1);
	});

	it('that call is the shared path’s own', () => {
		const body = commitDisplayBody(code);
		expect(body, 'commitDisplay is gone: the shared path it names is the rule').not.toBeNull();
		expect(body).toContain(CALL);
	});

	// The count is what catches a new gesture, so show that it can.
	it('counts a planted second call site', () => {
		const planted = `${code}\nfunction rogue() { ${CALL}0, 'x'); }\n`;
		expect(planted.split(CALL).length - 1).toBe(2);
	});

	it('reads the body past a brace inside a comment or a string', () => {
		const source = [
			'function commitDisplay(display: string): number {',
			'	// a stray } in a comment',
			"	const close = '}';",
			`	void ${CALL}display);`,
			'	return 0;',
			'}'
		].join('\n');
		const code = stripComments(source);
		expect(commitDisplayBody(code)).toContain(CALL);
	});
});
