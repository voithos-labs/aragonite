// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { tokenizeBody } from '../../code-surface/code-renderer';
import { bootstrapCodeLanguages, __resetBootForTests } from '../../code-surface/code-bootstrap';
import { __resetRegistryForTests } from '../../code-surface/code-languages';

describe('tokenizeBody', () => {
	beforeEach(() => {
		__resetRegistryForTests();
		__resetBootForTests();
		bootstrapCodeLanguages();
	});

	it('tokenizes javascript into spans', () => {
		const frag = tokenizeBody('const x = 42;\n', 'javascript');
		expect(frag.textContent).toBe('const x = 42;\n');
		expect(frag.querySelector('.code-tok-keyword')).not.toBeNull();
		expect(frag.querySelector('.code-tok-number')).not.toBeNull();
	});

	it('resolves aliases (js → javascript)', () => {
		const frag = tokenizeBody('const x = 42;\n', 'js');
		expect(frag.querySelector('.code-tok-keyword')?.textContent).toBe('const');
	});

	it('falls through to plain text for empty info string', () => {
		const frag = tokenizeBody('const x = 42;\n', '');
		expect(frag.textContent).toBe('const x = 42;\n');
		expect(frag.querySelector('.code-tok-keyword')).toBeNull();
		expect(frag.childNodes.length).toBe(1);
		expect(frag.firstChild?.nodeType).toBe(Node.TEXT_NODE);
	});

	it('falls through to plain text for unknown language', () => {
		const frag = tokenizeBody('xyz abc\n', 'klingon');
		expect(frag.textContent).toBe('xyz abc\n');
		expect(frag.querySelector('[class^="code-tok"]')).toBeNull();
	});

	it('returns an empty fragment for empty body', () => {
		const frag = tokenizeBody('', 'javascript');
		expect(frag.childNodes.length).toBe(0);
	});

	it('preserves textContent invariant for all inputs', () => {
		const inputs: Array<[string, string]> = [
			['const x = 42;\n', 'javascript'],
			['def foo():\n    return 1\n', 'python'],
			['fn main() {\n    println!("hi");\n}\n', 'rust'],
			['# Heading\n\ntext\n', 'markdown'],
			['unknown content\n', 'unknown-lang']
		];
		for (const [body, lang] of inputs) {
			const frag = tokenizeBody(body, lang);
			expect(frag.textContent).toBe(body);
		}
	});

	it('ignoreIllegals — mid-typing invalid syntax does not throw', () => {
		expect(() => tokenizeBody('const x = ', 'javascript')).not.toThrow();
	});
});
