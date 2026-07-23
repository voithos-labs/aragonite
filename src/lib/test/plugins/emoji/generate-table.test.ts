import { describe, it, expect } from 'vitest';
import {
	emojiTableEntries,
	renderEmojiTable
} from '../../../../../scripts/generate-emoji-table.mjs';

// The generation script's pure core, driven over a vendored db slice so the test
// never touches the network. gemoji entries carry `{ emoji, aliases[] }`; the
// script flattens each alias to its own key and emits a stably-ordered table.
const DB = [
	{ emoji: '😄', aliases: ['smile'] },
	{ emoji: '👍', aliases: ['+1', 'thumbsup'] },
	{ emoji: '❤️', aliases: ['heart'] }
];

describe('emojiTableEntries — flatten aliases to glyph, stably ordered', () => {
	it('maps every alias, including a multi-alias entry, to its glyph', () => {
		const table = new Map(emojiTableEntries(DB));
		expect(table.get('smile')).toBe('😄');
		expect(table.get('+1')).toBe('👍');
		expect(table.get('thumbsup')).toBe('👍');
		expect(table.get('heart')).toBe('❤️');
		expect(table.size).toBe(4);
	});

	it('orders entries by alias so a regen against reordered input is byte-stable', () => {
		const aliases = emojiTableEntries(DB).map(([alias]) => alias);
		expect(aliases).toEqual(['+1', 'heart', 'smile', 'thumbsup']);
		const shuffled = emojiTableEntries([...DB].reverse());
		expect(shuffled.map(([alias]) => alias)).toEqual(aliases);
	});

	it('skips an entry missing a glyph or aliases rather than emitting a broken key', () => {
		const table = new Map(emojiTableEntries([{ aliases: ['noglyph'] }, { emoji: '🙂' }, ...DB]));
		expect(table.has('noglyph')).toBe(false);
		expect(table.size).toBe(4);
	});
});

describe('renderEmojiTable — a generated, self-describing module', () => {
	const source = renderEmojiTable(emojiTableEntries(DB));

	it('marks the file generated and names the regeneration command', () => {
		expect(source).toContain('GENERATED');
		expect(source).toContain('generate-emoji-table.mjs');
	});

	it('emits a typed ReadonlyMap the plugin can import', () => {
		expect(source).toContain('export const EMOJI_TABLE: ReadonlyMap<string, string>');
		expect(source).toContain('["smile", "😄"]');
	});
});
