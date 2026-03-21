export interface ParsedLine {
	raw: string;
	text: string;
	lineEnding: string;
	start: number;
	end: number;
}

export function splitLines(source: string): ParsedLine[] {
	const lines: ParsedLine[] = [];
	let start = 0;

	for (let i = 0; i < source.length; i++) {
		if (source[i] === '\n') {
			const raw = source.slice(start, i + 1);
			const lineEnding = source[i - 1] === '\r' ? '\r\n' : '\n';
			const text = raw.slice(0, raw.length - lineEnding.length);
			lines.push({ raw, text, lineEnding, start, end: i + 1 });
			start = i + 1;
		}
	}

	// Remaining content after last newline (or entire string if no newlines)
	if (start < source.length) {
		const raw = source.slice(start);
		lines.push({ raw, text: raw, lineEnding: '', start, end: source.length });
	}

	return lines;
}
