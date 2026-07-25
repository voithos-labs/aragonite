/** Expand `$1`..`$9`, `$&`/`$0` (full match), `$$` (literal $), and `\n`/`\t`/`\\`
 *  escapes against a regex match's groups. Literal mode passes `undefined` groups
 *  → verbatim (a single-line replace input can't carry a real newline, so escapes
 *  are the only way to inject one — regex mode only, matching VS Code). */
export function expandReplacement(template: string, groups: string[] | undefined): string {
	if (!groups) return template;
	return template.replace(/\\([nt\\])|\$(\$|&|\d+)/g, (_, esc: string, token: string) => {
		if (esc) return esc === 'n' ? '\n' : esc === 't' ? '\t' : '\\';
		if (token === '$') return '$';
		if (token === '&') return groups[0] ?? '';
		const n = Number(token);
		return n === 0 ? (groups[0] ?? '') : (groups[n] ?? '');
	});
}

export interface ReplaceRange {
	start: number;
	end: number;
	groups?: string[];
}

/**
 * Apply ranges to `text`, substituting right-to-left so earlier offsets stay valid.
 *
 * Deliberately has no per-replacement escape hook. A structural leaf's delimiters
 * have to be escaped over the WHOLE post-splice raw — a freeing backslash usually
 * comes from the surrounding text, not the inserted fragment — so that step is the
 * caller's `toLegalRaw` pass over the result, not a callback fired per fragment.
 */
export function applyRangesToText(text: string, ranges: ReplaceRange[], template: string): string {
	let out = text;
	const ordered = [...ranges].sort((a, b) => b.start - a.start);
	for (const r of ordered) {
		out = out.slice(0, r.start) + expandReplacement(template, r.groups) + out.slice(r.end);
	}
	return out;
}
