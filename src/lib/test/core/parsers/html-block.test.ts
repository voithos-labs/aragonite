import { describe, it, expect } from 'vitest';
import {
	matchHtmlBlock,
	parseHtmlBlock,
	canInterruptParagraph
} from '../../../core/parsers/html-block';
import { splitLines } from '../../../core/lines';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';

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

describe('matchHtmlBlock — type 7 (complete-tag catch-all)', () => {
	it('detects <custom> as type 7', () => {
		expect(matchHtmlBlock('<custom>')).toBe(7);
	});
	it('detects <custom-element> as type 7', () => {
		expect(matchHtmlBlock('<custom-element>')).toBe(7);
	});
	it('detects </custom> close tag as type 7', () => {
		expect(matchHtmlBlock('</custom>')).toBe(7);
	});
	it('detects self-closing <custom /> as type 7', () => {
		expect(matchHtmlBlock('<custom />')).toBe(7);
	});
	it('detects <custom> with unquoted attribute value', () => {
		expect(matchHtmlBlock('<custom data-x=foo>')).toBe(7);
	});
	it('detects <custom> with double-quoted attribute value', () => {
		expect(matchHtmlBlock('<custom data-x="foo bar">')).toBe(7);
	});
	it('detects <custom> with single-quoted attribute value', () => {
		expect(matchHtmlBlock("<custom data-x='foo bar'>")).toBe(7);
	});
	it('detects <custom> with multiple attributes', () => {
		expect(matchHtmlBlock('<custom a="1" b=2 c=\'3\'>')).toBe(7);
	});
	it('does NOT match when tag is followed by non-whitespace', () => {
		expect(matchHtmlBlock('<custom>foo')).toBeNull();
	});
	it('does NOT match when tag is not at line start', () => {
		expect(matchHtmlBlock('text <custom>')).toBeNull();
	});
	it('allows trailing whitespace', () => {
		expect(matchHtmlBlock('<custom>   ')).toBe(7);
		expect(matchHtmlBlock('<custom>\t')).toBe(7);
	});
	it('priority: <script> still matches type 1, not type 7', () => {
		expect(matchHtmlBlock('<script>')).toBe(1);
	});
	it('priority: <div> still matches type 6, not type 7', () => {
		expect(matchHtmlBlock('<div>')).toBe(6);
	});
});

function parseHtmlBlockFromSource(src: string) {
	const lines = splitLines(src);
	const type = matchHtmlBlock(lines[0].text)!;
	return parseHtmlBlock(lines, 0, lines.length, '', type);
}

describe('parseHtmlBlock — per-type close conditions', () => {
	describe('type 1 (script/pre/style/textarea)', () => {
		it('same-line open and close yields a one-line block', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<script>foo</script>\nafter\n');
			expect(node.kind).toBe('htmlBlock');
			expect(node.raw).toBe('<script>foo</script>\n');
			expect(nextIndex).toBe(1);
		});
		it('close-tag on later line includes that line in the block', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<script>\nfoo\n</script>\nafter\n');
			expect(node.raw).toBe('<script>\nfoo\n</script>\n');
			expect(nextIndex).toBe(3);
		});
		it('any close tag closes any type-1 block (spec-exact)', () => {
			// <script> opener closed by </pre> per CommonMark §4.6.
			const { node, nextIndex } = parseHtmlBlockFromSource('<script>\nfoo\n</pre>\nafter\n');
			expect(node.raw).toBe('<script>\nfoo\n</pre>\n');
			expect(nextIndex).toBe(3);
		});
		it('case-insensitive close: </SCRIPT> closes <script>', () => {
			const { node } = parseHtmlBlockFromSource('<script>\n</SCRIPT>\nafter\n');
			expect(node.raw).toBe('<script>\n</SCRIPT>\n');
		});
		it('unclosed type 1 block extends to EOF (no blank-line stop)', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<script>\nfoo\n\nbar\n');
			expect(node.raw).toBe('<script>\nfoo\n\nbar\n');
			expect(nextIndex).toBe(4);
		});
	});

	describe('type 2 (comment)', () => {
		it('same-line open and close', () => {
			const { node } = parseHtmlBlockFromSource('<!-- inline -->\nafter\n');
			expect(node.raw).toBe('<!-- inline -->\n');
		});
		it('multi-line comment closes on --> line', () => {
			const { node } = parseHtmlBlockFromSource('<!--\nfoo\n-->\nafter\n');
			expect(node.raw).toBe('<!--\nfoo\n-->\n');
		});
	});

	describe('type 3 (processing instruction)', () => {
		it('closes on ?> line', () => {
			const { node } = parseHtmlBlockFromSource('<?xml\nfoo\n?>\nafter\n');
			expect(node.raw).toBe('<?xml\nfoo\n?>\n');
		});
	});

	describe('type 4 (declaration)', () => {
		it('same-line <!DOCTYPE html> is a one-line block (close is `>`)', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<!DOCTYPE html>\nafter\n');
			expect(node.raw).toBe('<!DOCTYPE html>\n');
			expect(nextIndex).toBe(1);
		});
		it('multi-line declaration closes on first line containing >', () => {
			const { node } = parseHtmlBlockFromSource('<!DOCTYPE\nhtml>\nafter\n');
			expect(node.raw).toBe('<!DOCTYPE\nhtml>\n');
		});
	});

	describe('type 5 (CDATA)', () => {
		it('closes on ]]> line', () => {
			const { node } = parseHtmlBlockFromSource('<![CDATA[\nfoo\n]]>\nafter\n');
			expect(node.raw).toBe('<![CDATA[\nfoo\n]]>\n');
		});
	});

	describe('type 6 (listed tag) and type 7 (catch-all)', () => {
		it('type 6 closes on blank line; blank line is NOT part of block', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<div>\ncontent\n\nafter\n');
			expect(node.raw).toBe('<div>\ncontent\n');
			expect(nextIndex).toBe(2);
		});
		it('type 7 closes on blank line; blank line is NOT part of block', () => {
			const { node, nextIndex } = parseHtmlBlockFromSource('<custom>\ncontent\n\nafter\n');
			expect(node.raw).toBe('<custom>\ncontent\n');
			expect(nextIndex).toBe(2);
		});
		it('type 6 unclosed at EOF runs to EOF', () => {
			const { node } = parseHtmlBlockFromSource('<div>\ncontent\n');
			expect(node.raw).toBe('<div>\ncontent\n');
		});
	});
});

describe('canInterruptParagraph', () => {
	it('returns true for types 1-6 openers', () => {
		expect(canInterruptParagraph('<script>')).toBe(true);
		expect(canInterruptParagraph('<!-- comment')).toBe(true);
		expect(canInterruptParagraph('<?xml')).toBe(true);
		expect(canInterruptParagraph('<!DOCTYPE html>')).toBe(true);
		expect(canInterruptParagraph('<![CDATA[')).toBe(true);
		expect(canInterruptParagraph('<div>')).toBe(true);
	});
	it('returns false for type 7 openers (catch-all)', () => {
		expect(canInterruptParagraph('<custom>')).toBe(false);
		expect(canInterruptParagraph('</custom>')).toBe(false);
	});
	it('returns false for non-HTML lines', () => {
		expect(canInterruptParagraph('hello world')).toBe(false);
		expect(canInterruptParagraph('')).toBe(false);
	});
});

describe('paragraph interruption by HTML blocks', () => {
	it('paragraph splits when <div> appears on the next line', () => {
		const doc = parse('Hello world\n<div>\ncontent\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[0].raw).toBe('Hello world\n');
		expect(doc.children[1].kind).toBe('htmlBlock');
		expect(doc.children[1].raw).toBe('<div>\ncontent\n');
	});
	it('paragraph does NOT split for type 7 (custom tag)', () => {
		const doc = parse('Hello world\n<custom-tag>\ncontent\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
	});
	it('paragraph splits on <script>, post-close becomes new paragraph', () => {
		const doc = parse('Hello\n<script>foo</script>\nafter\n');
		expect(doc.children).toHaveLength(3);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('htmlBlock');
		expect(doc.children[1].raw).toBe('<script>foo</script>\n');
		expect(doc.children[2].kind).toBe('paragraph');
		expect(doc.children[2].raw).toBe('after\n');
	});
	it('round-trip preserved across interruption', () => {
		const src = 'Hello world\n<div>\ncontent\n';
		expect(serialize(parse(src))).toBe(src);
	});
});
