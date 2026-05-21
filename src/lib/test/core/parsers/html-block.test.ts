import { describe, it, expect } from 'vitest';
import { matchHtmlBlock } from '../../../core/parsers/html-block';

describe('matchHtmlBlock — types 1-6 detection', () => {
	describe('type 1 (script/pre/style/textarea)', () => {
		it('detects <script> as type 1', () => {
			expect(matchHtmlBlock('<script>')).toBe(1);
		});
		it('detects <pre> as type 1', () => {
			expect(matchHtmlBlock('<pre>')).toBe(1);
		});
		it('detects <style> as type 1', () => {
			expect(matchHtmlBlock('<style>')).toBe(1);
		});
		it('detects <textarea> as type 1 (previously fell through)', () => {
			expect(matchHtmlBlock('<textarea>')).toBe(1);
		});
		it('is case-insensitive', () => {
			expect(matchHtmlBlock('<SCRIPT>')).toBe(1);
			expect(matchHtmlBlock('<Pre>')).toBe(1);
		});
		it('matches with space after tag name', () => {
			expect(matchHtmlBlock('<script lang="js">')).toBe(1);
		});
		it('matches at end-of-line after tag name', () => {
			expect(matchHtmlBlock('<script')).toBe(1);
		});
		it('matches with self-closing tag', () => {
			expect(matchHtmlBlock('<script/>')).toBe(1);
		});
		it('does NOT match <scripting>', () => {
			expect(matchHtmlBlock('<scripting>')).not.toBe(1);
		});
	});

	describe('type 2 (comment)', () => {
		it('detects <!-- as type 2', () => {
			expect(matchHtmlBlock('<!-- comment')).toBe(2);
		});
		it('detects <!-- with same-line close', () => {
			expect(matchHtmlBlock('<!-- inline -->')).toBe(2);
		});
	});

	describe('type 3 (processing instruction)', () => {
		it('detects <? as type 3', () => {
			expect(matchHtmlBlock('<?xml version="1.0"?>')).toBe(3);
		});
	});

	describe('type 4 (declaration)', () => {
		it('detects <! followed by ASCII letter as type 4', () => {
			expect(matchHtmlBlock('<!DOCTYPE html>')).toBe(4);
		});
		it('does NOT match <!1>', () => {
			expect(matchHtmlBlock('<!1>')).toBeNull();
		});
		it('does NOT match <!> with nothing after', () => {
			expect(matchHtmlBlock('<!>')).toBeNull();
		});
	});

	describe('type 5 (CDATA)', () => {
		it('detects <![CDATA[ as type 5', () => {
			expect(matchHtmlBlock('<![CDATA[ data ]]>')).toBe(5);
		});
		it('is case-sensitive — <![cdata[ does NOT match', () => {
			expect(matchHtmlBlock('<![cdata[ data ]]>')).not.toBe(5);
		});
	});

	describe('type 6 (listed tag)', () => {
		it('detects <div> as type 6', () => {
			expect(matchHtmlBlock('<div>')).toBe(6);
		});
		it('detects </div> (close tag) as type 6', () => {
			expect(matchHtmlBlock('</div>')).toBe(6);
		});
		it('detects <table> with attributes', () => {
			expect(matchHtmlBlock('<table class="x">')).toBe(6);
		});
		it('detects <h1> through <h6>', () => {
			expect(matchHtmlBlock('<h1>')).toBe(6);
			expect(matchHtmlBlock('<h6>')).toBe(6);
		});
		it('is case-insensitive', () => {
			expect(matchHtmlBlock('<DIV>')).toBe(6);
		});
		it('matches at end-of-line', () => {
			expect(matchHtmlBlock('<div')).toBe(6);
		});
		it('does NOT match unknown tags (e.g. <custom>)', () => {
			expect(matchHtmlBlock('<custom>')).not.toBe(6);
		});
		it('script/pre/style/textarea are NOT type 6 (priority handled)', () => {
			expect(matchHtmlBlock('<script>')).not.toBe(6);
			expect(matchHtmlBlock('<pre>')).not.toBe(6);
			expect(matchHtmlBlock('<style>')).not.toBe(6);
			expect(matchHtmlBlock('<textarea>')).not.toBe(6);
		});
	});

	describe('indentation', () => {
		it('allows 0-3 leading spaces', () => {
			expect(matchHtmlBlock('<div>')).toBe(6);
			expect(matchHtmlBlock(' <div>')).toBe(6);
			expect(matchHtmlBlock('  <div>')).toBe(6);
			expect(matchHtmlBlock('   <div>')).toBe(6);
		});
		it('rejects 4+ space indent (falls into indented-code territory)', () => {
			expect(matchHtmlBlock('    <div>')).toBeNull();
		});
	});

	describe('non-HTML lines', () => {
		it('returns null for plain text', () => {
			expect(matchHtmlBlock('hello world')).toBeNull();
		});
		it('returns null for blank line', () => {
			expect(matchHtmlBlock('')).toBeNull();
		});
		it('returns null for lone <', () => {
			expect(matchHtmlBlock('<')).toBeNull();
		});
	});
});
