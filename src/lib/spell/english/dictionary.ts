/**
 * A Hunspell dictionary read into word sets: the affix file's prefix and suffix rules expand every
 * entry's flagged forms up front, so a check is one set lookup and the suggester has a plain word
 * list to test candidates against. Reads what the SCOWL English files use (PFX, SFX, REP, TRY,
 * NOSUGGEST, ONLYINCOMPOUND); compounding rules are left out, since digit-bearing words are not
 * checked anyway.
 */

import { splitLines } from '../../core/lines';

interface AffixRule {
	flag: string;
	cross: boolean;
	strip: string;
	add: string;
	/** Anchored at the end for a suffix, the start for a prefix. */
	condition: RegExp | null;
}

export interface Replacement {
	from: string;
	to: string;
}

export interface Dictionary {
	/** Every form as the dictionary spells it. */
	readonly forms: ReadonlySet<string>;
	/** Every form lower-cased, for a word written in capitals. */
	readonly lowerForms: ReadonlySet<string>;
	/** Forms a suggestion never offers (the taboo list). */
	readonly noSuggest: ReadonlySet<string>;
	/** The affix file's common misspelling pairs, tried first when suggesting. */
	readonly replacements: readonly Replacement[];
	/** The letters a suggestion may insert or substitute, most common first. */
	readonly tryChars: string;
}

export function readDictionary(aff: string, dic: string): Dictionary {
	const affix = parseAffix(aff);
	const forms = new Set<string>();
	const noSuggest = new Set<string>();
	const lines = splitLines(dic);
	// The first line is the entry count, and a trailing field after a tab is morphology.
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].text;
		if (line === '') continue;
		const entry = parseEntry(line);
		if (!entry) continue;
		const flags = entry.flags;
		if (affix.onlyInCompound && flags.includes(affix.onlyInCompound)) continue;
		const expanded = expandEntry(entry.word, flags, affix);
		const taboo = affix.noSuggest !== null && flags.includes(affix.noSuggest);
		for (const form of expanded) {
			forms.add(form);
			if (taboo) noSuggest.add(form);
		}
	}
	const lowerForms = new Set<string>();
	for (const form of forms) lowerForms.add(form.toLowerCase());
	return {
		forms,
		lowerForms,
		noSuggest,
		replacements: affix.replacements,
		tryChars: affix.tryChars
	};
}

// ── The affix file ───────────────────────────────────────────────────────────

interface AffixTable {
	prefixes: Map<string, AffixRule[]>;
	suffixes: Map<string, AffixRule[]>;
	replacements: Replacement[];
	tryChars: string;
	noSuggest: string | null;
	onlyInCompound: string | null;
}

function parseAffix(aff: string): AffixTable {
	const table: AffixTable = {
		prefixes: new Map(),
		suffixes: new Map(),
		replacements: [],
		tryChars: '',
		noSuggest: null,
		onlyInCompound: null
	};
	const crossFlags = new Map<string, boolean>();
	for (const rawLine of splitLines(aff)) {
		const line = rawLine.text.replace(/#.*$/, '').trim();
		if (line === '') continue;
		const fields = line.split(/\s+/);
		const [keyword] = fields;
		if (keyword === 'TRY') table.tryChars = fields[1] ?? '';
		else if (keyword === 'NOSUGGEST') table.noSuggest = fields[1] ?? null;
		else if (keyword === 'ONLYINCOMPOUND') table.onlyInCompound = fields[1] ?? null;
		else if (keyword === 'REP' && fields.length === 3) {
			table.replacements.push({ from: fields[1], to: fields[2].replace(/_/g, ' ') });
		} else if (keyword === 'PFX' || keyword === 'SFX') {
			const flag = fields[1];
			// A rule set's header names the flag, whether it crosses with the other kind, and a count.
			if (fields.length === 4 && (fields[2] === 'Y' || fields[2] === 'N')) {
				crossFlags.set(keyword + flag, fields[2] === 'Y');
				continue;
			}
			const rules = keyword === 'PFX' ? table.prefixes : table.suffixes;
			const strip = fields[2] === '0' ? '' : fields[2];
			const add = fields[3] === '0' ? '' : fields[3];
			const condition = fields[4] ?? '.';
			const rule: AffixRule = {
				flag,
				cross: crossFlags.get(keyword + flag) ?? false,
				strip,
				add,
				condition:
					condition === '.'
						? null
						: new RegExp(keyword === 'PFX' ? `^(?:${condition})` : `(?:${condition})$`, 'u')
			};
			const list = rules.get(flag);
			if (list) list.push(rule);
			else rules.set(flag, [rule]);
		}
	}
	return table;
}

// ── Entries and their forms ──────────────────────────────────────────────────

function parseEntry(line: string): { word: string; flags: string } | null {
	const body = line.split('\t')[0];
	// `\/` is a literal slash in the word; the first unescaped slash starts the flags.
	let slash = -1;
	for (let i = 0; i < body.length; i++) {
		if (body[i] === '\\') {
			i++;
			continue;
		}
		if (body[i] === '/') {
			slash = i;
			break;
		}
	}
	const word = (slash < 0 ? body : body.slice(0, slash)).replace(/\\\//g, '/');
	if (word === '') return null;
	return { word, flags: slash < 0 ? '' : body.slice(slash + 1) };
}

function expandEntry(word: string, flags: string, affix: AffixTable): string[] {
	const out = [word];
	if (flags === '') return out;
	const suffixed: { form: string; cross: boolean }[] = [];
	for (const flag of flags) {
		for (const rule of affix.suffixes.get(flag) ?? []) {
			const form = applySuffix(word, rule);
			if (form !== null) {
				out.push(form);
				suffixed.push({ form, cross: rule.cross });
			}
		}
	}
	for (const flag of flags) {
		for (const rule of affix.prefixes.get(flag) ?? []) {
			const form = applyPrefix(word, rule);
			if (form !== null) out.push(form);
			if (!rule.cross) continue;
			// A prefix that crosses applies to each suffixed form that crosses too (`un` + `done`).
			for (const entry of suffixed) {
				if (!entry.cross) continue;
				const crossed = applyPrefix(entry.form, rule);
				if (crossed !== null) out.push(crossed);
			}
		}
	}
	return out;
}

function applySuffix(word: string, rule: AffixRule): string | null {
	if (rule.condition && !rule.condition.test(word)) return null;
	if (rule.strip !== '' && !word.endsWith(rule.strip)) return null;
	return word.slice(0, word.length - rule.strip.length) + rule.add;
}

function applyPrefix(word: string, rule: AffixRule): string | null {
	if (rule.condition && !rule.condition.test(word)) return null;
	if (rule.strip !== '' && !word.startsWith(rule.strip)) return null;
	return rule.add + word.slice(rule.strip.length);
}
