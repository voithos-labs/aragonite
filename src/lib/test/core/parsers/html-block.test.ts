import { describe, it, expect } from 'vitest';
import {
	matchHtmlBlock,
	parseHtmlBlock,
	canInterruptParagraph
} from '../../../core/parsers/html-block';
import { splitLines } from '../../../core/lines';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';

function describeMatchCases(family: string, cases: Array<[string, string, number | null]>): void {
	describe(family, () => {
		it.each(cases)('%s', (_label, line, expected) => {
			expect(matchHtmlBlock(line)).toBe(expected);
		});
	});
}

describeMatchCases('matchHtmlBlock — type 1 (script/pre/style/textarea)', [
	['detects <script> as type 1', '<script>', 1],
	['detects <pre> as type 1', '<pre>', 1],
	['detects <style> as type 1', '<style>', 1],
	['detects <textarea> as type 1', '<textarea>', 1],
	['case-insensitive: <SCRIPT>', '<SCRIPT>', 1],
	['case-insensitive: <Pre>', '<Pre>', 1],
	['matches with space after tag name', '<script lang="js">', 1],
	['matches at end-of-line after tag name', '<script', 1],
	['matches with self-closing tag', '<script/>', 1],
	['<scripting> is not type 1 (falls to type 7)', '<scripting>', 7]
]);

describeMatchCases('matchHtmlBlock — types 2-5 (comment/PI/declaration/CDATA)', [
	['detects <!-- as type 2', '<!-- comment', 2],
	['detects <!-- with same-line close', '<!-- inline -->', 2],
	['detects <? as type 3', '<?xml version="1.0"?>', 3],
	['detects <! followed by ASCII letter as type 4', '<!DOCTYPE html>', 4],
	['does NOT match <!1>', '<!1>', null],
	['does NOT match <!> with nothing after', '<!>', null],
	['detects <![CDATA[ as type 5', '<![CDATA[ data ]]>', 5],
	['CDATA is case-sensitive — <![cdata[ does NOT match', '<![cdata[ data ]]>', null]
]);

describeMatchCases('matchHtmlBlock — type 6 (listed tag)', [
	['detects <div> as type 6', '<div>', 6],
	['detects </div> (close tag) as type 6', '</div>', 6],
	['detects <table> with attributes', '<table class="x">', 6],
	['detects <h1>', '<h1>', 6],
	['detects <h6>', '<h6>', 6],
	['is case-insensitive', '<DIV>', 6],
	['matches at end-of-line', '<div', 6],
	['unknown tag is not type 6 (falls to type 7)', '<custom>', 7]
]);

describeMatchCases('matchHtmlBlock — indentation', [
	['allows 1 leading space', ' <div>', 6],
	['allows 2 leading spaces', '  <div>', 6],
	['allows 3 leading spaces', '   <div>', 6],
	['rejects 4+ space indent (indented-code territory)', '    <div>', null]
]);

describeMatchCases('matchHtmlBlock — non-HTML lines', [
	['returns null for plain text', 'hello world', null],
	['returns null for blank line', '', null],
	['returns null for lone <', '<', null]
]);

describeMatchCases('matchHtmlBlock — type 7 (complete-tag catch-all)', [
	['detects <custom> as type 7', '<custom>', 7],
	['detects <custom-element> as type 7', '<custom-element>', 7],
	['detects </custom> close tag as type 7', '</custom>', 7],
	['detects self-closing <custom /> as type 7', '<custom />', 7],
	['detects unquoted attribute value', '<custom data-x=foo>', 7],
	['detects double-quoted attribute value', '<custom data-x="foo bar">', 7],
	['detects single-quoted attribute value', "<custom data-x='foo bar'>", 7],
	['detects multiple attributes', '<custom a="1" b=2 c=\'3\'>', 7],
	['does NOT match when tag is followed by non-whitespace', '<custom>foo', null],
	['does NOT match when tag is not at line start', 'text <custom>', null],
	['allows trailing spaces', '<custom>   ', 7],
	['allows a trailing tab', '<custom>\t', 7]
]);

function parseHtmlBlockFromSource(src: string) {
	const lines = splitLines(src);
	const type = matchHtmlBlock(lines[0].text)!;
	return parseHtmlBlock(lines, 0, lines.length, '', type);
}

describe('parseHtmlBlock — per-type close conditions', () => {
	describe('type 1 (script/pre/style/textarea)', () => {
		it('same-line open and close yields a one-line block', () => {
			const { node, consumed } = parseHtmlBlockFromSource('<script>foo</script>\nafter\n');
			expect(node.kind).toBe('htmlBlock');
			expect(node.raw).toBe('<script>foo</script>\n');
			expect(consumed).toBe(1);
		});
		it('close-tag on later line includes that line in the block', () => {
			const { node, consumed } = parseHtmlBlockFromSource('<script>\nfoo\n</script>\nafter\n');
			expect(node.raw).toBe('<script>\nfoo\n</script>\n');
			expect(consumed).toBe(3);
		});
		it('any close tag closes any type-1 block (spec-exact)', () => {
			// <script> opener closed by </pre> per CommonMark §4.6.
			const { node, consumed } = parseHtmlBlockFromSource('<script>\nfoo\n</pre>\nafter\n');
			expect(node.raw).toBe('<script>\nfoo\n</pre>\n');
			expect(consumed).toBe(3);
		});
		it('case-insensitive close: </SCRIPT> closes <script>', () => {
			const { node } = parseHtmlBlockFromSource('<script>\n</SCRIPT>\nafter\n');
			expect(node.raw).toBe('<script>\n</SCRIPT>\n');
		});
		it('unclosed type 1 block extends to EOF (no blank-line stop)', () => {
			const { node, consumed } = parseHtmlBlockFromSource('<script>\nfoo\n\nbar\n');
			expect(node.raw).toBe('<script>\nfoo\n\nbar\n');
			expect(consumed).toBe(4);
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
			const { node, consumed } = parseHtmlBlockFromSource('<!DOCTYPE html>\nafter\n');
			expect(node.raw).toBe('<!DOCTYPE html>\n');
			expect(consumed).toBe(1);
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
			const { node, consumed } = parseHtmlBlockFromSource('<div>\ncontent\n\nafter\n');
			expect(node.raw).toBe('<div>\ncontent\n');
			expect(consumed).toBe(2);
		});
		it('type 7 closes on blank line; blank line is NOT part of block', () => {
			const { node, consumed } = parseHtmlBlockFromSource('<custom>\ncontent\n\nafter\n');
			expect(node.raw).toBe('<custom>\ncontent\n');
			expect(consumed).toBe(2);
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

describe('parse-level dispatch and interruption', () => {
	it('type 7 at document start opens and closes on the blank line', () => {
		const doc = parse('<custom-tag>\n\nfoo\n');
		expect(doc.children).toHaveLength(2);
		expect(doc.children[0].kind).toBe('htmlBlock');
		expect(doc.children[1].kind).toBe('paragraph');
	});
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
