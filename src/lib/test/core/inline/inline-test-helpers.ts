import { parseInline } from '../../../core/inline';

export function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}
