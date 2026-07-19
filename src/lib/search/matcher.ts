export interface MatcherOptions {
	caseSensitive: boolean;
	wholeWord: boolean;
	regex: boolean;
}
export interface RawRange {
	start: number;
	end: number;
	groups?: string[];
}
export interface CompiledMatcher {
	findAll(text: string): RawRange[];
}
export type CompileResult = { ok: true; matcher: CompiledMatcher } | { ok: false; error: string };

const isWordChar = (ch: string | undefined) => !!ch && /\w/.test(ch);

export function compileMatcher(query: string, opts: MatcherOptions): CompileResult {
	if (query === '') return { ok: true, matcher: { findAll: () => [] } };

	if (opts.regex) {
		const pattern = opts.wholeWord ? `\\b(?:${query})\\b` : query;
		let re: RegExp;
		try {
			re = new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi'); // no 's'/'m': . excludes newline, ^/$ stay per-block
		} catch (e) {
			return { ok: false, error: e instanceof Error ? e.message : 'invalid pattern' };
		}
		return {
			ok: true,
			matcher: {
				findAll(text) {
					const out: RawRange[] = [];
					re.lastIndex = 0;
					let m: RegExpExecArray | null;
					while ((m = re.exec(text)) !== null) {
						out.push({ start: m.index, end: m.index + m[0].length, groups: [...m] });
						if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
					}
					return out;
				}
			}
		};
	}

	const needle = opts.caseSensitive ? query : query.toLowerCase();
	return {
		ok: true,
		matcher: {
			findAll(text) {
				const hay = opts.caseSensitive ? text : text.toLowerCase();
				// Case folding is not length-preserving ('İ' → 2 code units), so a
				// folded haystack's indices can drift off the original string. Match
				// with a case-insensitive regex over the original instead.
				if (hay.length !== text.length) return foldSafeFindAll(text, query, opts.wholeWord);
				const out: RawRange[] = [];
				let from = 0;
				let at: number;
				while ((at = hay.indexOf(needle, from)) !== -1) {
					const end = at + needle.length;
					if (!opts.wholeWord || (!isWordChar(text[at - 1]) && !isWordChar(text[end]))) {
						out.push({ start: at, end });
					}
					from = end;
				}
				return out;
			}
		}
	};
}

function foldSafeFindAll(text: string, query: string, wholeWord: boolean): RawRange[] {
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(wholeWord ? `\\b(?:${escaped})\\b` : escaped, 'gi');
	const out: RawRange[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		out.push({ start: m.index, end: m.index + m[0].length });
	}
	return out;
}
