// @vitest-environment jsdom
// A container closed by a line of its own (a callout, a `:::` box, a `<details>`) pasted from a
// plain clipboard into a container of its own kind nests there: the outer fence grows, the rest of
// the caret's container stays in it, a pasted title stays, at a body's end, mid-text and on an
// empty body line, two deep, in a quote and an item. With its own entry a cut out of one comes back.
// Miss-analysis: the taken-in rows pinned the bytes before the caret, and none read the caret's
// closing line or a pasted title, so a callout closed early and a lost title passed every row.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	clipboardGesture,
	mountCase,
	pasteGesture,
	placeOwnedRange,
	placeRange
} from '../range-laws/gestures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** `‸` marks the caret; `after` is the source the paste leaves, `typed` it once `Z` is typed. */
const ROWS: [name: string, marked: string, clip: string, after: string, typed: string][] = [
	[
		'note mid, closed',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::',
		'::::note\na\n\n:::note\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, closed+more',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'::::note\na\n\n:::note\nX\n:::\n\nmoreb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nX\n:::\n\nmoreZb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, other',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::tip\nX\n:::',
		'::::note\na\n\n:::tip\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::tip\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, block after',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n# ',
		'::::note\na\n\n:::note\nX\n:::\n\n# b\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nX\n:::\n\n# Zb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note end, closed',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nX\n:::',
		'::::note\nab\n\n:::note\nX\n:::\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nXZ\n:::\n::::\n\nAfter\n'
	],
	[
		'note end, closed+more',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'::::note\nab\n\n:::note\nX\n:::\n\nmore\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nX\n:::\n\nmoreZ\n::::\n\nAfter\n'
	],
	[
		'note end, other',
		':::note\nab‸\n:::\n\nAfter\n',
		':::tip\nX\n:::',
		'::::note\nab\n\n:::tip\nX\n:::\n::::\n\nAfter\n',
		'::::note\nab\n\n:::tip\nXZ\n:::\n::::\n\nAfter\n'
	],
	[
		'note end, block after',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n# ',
		'::::note\nab\n\n:::note\nX\n:::\n\n# \n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nX\n:::\n\n# Z\n::::\n\nAfter\n'
	],
	[
		'note empty, closed',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nX\n:::',
		'::::note\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::note\nXZ\n:::\n\n::::\n\nAfter\n'
	],
	[
		'note empty, closed+more',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'::::note\n:::note\nX\n:::\n\nmore\n\n::::\n\nAfter\n',
		'::::note\n:::note\nX\n:::\n\nmoreZ\n\n::::\n\nAfter\n'
	],
	[
		'note empty, other',
		':::note\n‸\n:::\n\nAfter\n',
		':::tip\nX\n:::',
		'::::note\n:::tip\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::tip\nXZ\n:::\n\n::::\n\nAfter\n'
	],
	[
		'note empty, block after',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n# ',
		'::::note\n:::note\nX\n:::\n\n# \n\n::::\n\nAfter\n',
		'::::note\n:::note\nX\n:::\n\n# Z\n\n::::\n\nAfter\n'
	],
	[
		'note empty row, closed',
		':::note\na\n\n‸\nb\n:::\n',
		':::note\nX\n:::',
		'::::note\na\n\n:::note\nX\n:::\n\nb\n::::\n',
		'::::note\na\n\n:::note\nXZ\n:::\n\nb\n::::\n'
	],
	[
		'note empty row, closed+more',
		':::note\na\n\n‸\nb\n:::\n',
		':::note\nX\n:::\n\nmore',
		'::::note\na\n\n:::note\nX\n:::\n\nmore\n\nb\n::::\n',
		'::::note\na\n\n:::note\nX\n:::\n\nmoreZ\n\nb\n::::\n'
	],
	[
		'note start, closed',
		':::note\n‸alpha\n:::\n',
		':::note\nX\n:::',
		'::::note\n:::note\nX\n:::\nalpha\n::::\n',
		'::::note\n:::note\nXZ\n:::\nalpha\n::::\n'
	],
	[
		'note start, closed+more',
		':::note\n‸alpha\n:::\n',
		':::note\nX\n:::\n\nmore',
		'::::note\n:::note\nX\n:::\n\nmorealpha\n::::\n',
		'::::note\n:::note\nX\n:::\n\nmoreZalpha\n::::\n'
	],
	[
		'note last end, closed',
		':::note\nab\n\nrest‸\n:::\n\nAfter\n',
		':::note\nX\n:::',
		'::::note\nab\n\nrest\n\n:::note\nX\n:::\n::::\n\nAfter\n',
		'::::note\nab\n\nrest\n\n:::note\nXZ\n:::\n::::\n\nAfter\n'
	],
	[
		'note last end, closed+more',
		':::note\nab\n\nrest‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'::::note\nab\n\nrest\n\n:::note\nX\n:::\n\nmore\n::::\n\nAfter\n',
		'::::note\nab\n\nrest\n\n:::note\nX\n:::\n\nmoreZ\n::::\n\nAfter\n'
	],
	[
		'note last doc, closed',
		':::note\nab‸\n:::\n',
		':::note\nX\n:::',
		'::::note\nab\n\n:::note\nX\n:::\n::::\n',
		'::::note\nab\n\n:::note\nXZ\n:::\n::::\n'
	],
	[
		'note last doc, closed+more',
		':::note\nab‸\n:::\n',
		':::note\nX\n:::\n\nmore',
		'::::note\nab\n\n:::note\nX\n:::\n\nmore\n::::\n',
		'::::note\nab\n\n:::note\nX\n:::\n\nmoreZ\n::::\n'
	],
	[
		'titled mid, closed',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::',
		'::::note Mine\na\n\n:::note\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, closed+more',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nmoreb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nmoreZb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, other',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::tip\nX\n:::',
		'::::note Mine\na\n\n:::tip\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::tip\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, block after',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n# ',
		'::::note Mine\na\n\n:::note\nX\n:::\n\n# b\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\n# Zb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'two deep, closed',
		'::::note\nout\n\n:::note\nin‸ner\n:::\n::::\n\nAfter\n',
		':::note\nX\n:::',
		':::::note\nout\n\n::::note\nin\n\n:::note\nX\n:::\nner\n::::\n:::::\n\nAfter\n',
		':::::note\nout\n\n::::note\nin\n\n:::note\nXZ\n:::\nner\n::::\n:::::\n\nAfter\n'
	],
	[
		'two deep, closed+more',
		'::::note\nout\n\n:::note\nin‸ner\n:::\n::::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		':::::note\nout\n\n::::note\nin\n\n:::note\nX\n:::\n\nmorener\n::::\n:::::\n\nAfter\n',
		':::::note\nout\n\n::::note\nin\n\n:::note\nX\n:::\n\nmoreZner\n::::\n:::::\n\nAfter\n'
	],
	[
		'in quote, closed',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		':::note\nX\n:::',
		'> ::::note\n> a\n>\n> :::note\n> X\n> :::\n> b\n> ::::\n\nAfter\n',
		'> ::::note\n> a\n>\n> :::note\n> XZ\n> :::\n> b\n> ::::\n\nAfter\n'
	],
	[
		'in quote, closed+more',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		':::note\nX\n:::\n\nmore',
		'> ::::note\n> a\n>\n> :::note\n> X\n> :::\n>\n> moreb\n> ::::\n\nAfter\n',
		'> ::::note\n> a\n>\n> :::note\n> X\n> :::\n>\n> moreZb\n> ::::\n\nAfter\n'
	],
	[
		'in item, closed',
		'- :::note\n  a‸b\n  :::\n- after\n',
		':::note\nX\n:::',
		'- ::::note\n  a\n\n  :::note\n  X\n  :::\n  b\n  ::::\n- after\n',
		'- ::::note\n  a\n\n  :::note\n  XZ\n  :::\n  b\n  ::::\n- after\n'
	],
	[
		'in item, closed+more',
		'- :::note\n  a‸b\n  :::\n- after\n',
		':::note\nX\n:::\n\nmore',
		'- ::::note\n  a\n\n  :::note\n  X\n  :::\n\n  moreb\n  ::::\n- after\n',
		'- ::::note\n  a\n\n  :::note\n  X\n  :::\n\n  moreZb\n  ::::\n- after\n'
	],
	[
		'in last item, closed',
		'- :::note\n  ab‸\n  :::\n',
		':::note\nX\n:::',
		'- ::::note\n  ab\n\n  :::note\n  X\n  :::\n  ::::\n',
		'- ::::note\n  ab\n\n  :::note\n  XZ\n  :::\n  ::::\n'
	],
	[
		'in last item, closed+more',
		'- :::note\n  ab‸\n  :::\n',
		':::note\nX\n:::\n\nmore',
		'- ::::note\n  ab\n\n  :::note\n  X\n  :::\n\n  more\n  ::::\n',
		'- ::::note\n  ab\n\n  :::note\n  X\n  :::\n\n  moreZ\n  ::::\n'
	],
	[
		'crlf, closed',
		':::note\r\na‸b\r\n\r\nrest\r\n:::\r\n\r\nAfter\r\n',
		':::note\nX\n:::',
		'::::note\r\na\r\n\r\n:::note\r\nX\r\n:::\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n',
		'::::note\r\na\r\n\r\n:::note\r\nXZ\r\n:::\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n'
	],
	[
		'crlf, closed+more',
		':::note\r\na‸b\r\n\r\nrest\r\n:::\r\n\r\nAfter\r\n',
		':::note\nX\n:::\n\nmore',
		'::::note\r\na\r\n\r\n:::note\r\nX\r\n:::\r\n\r\nmoreb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n',
		'::::note\r\na\r\n\r\n:::note\r\nX\r\n:::\r\n\r\nmoreZb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n'
	],
	[
		'box mid, box',
		':::box\na‸b\n\nrest\n:::\n\nAfter\n',
		':::box\nX\n:::',
		'::::box\na\n\n:::box\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::box\na\n\n:::box\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'details mid, details',
		'<details open>\n<summary>s</summary>\n\na‸b\n\nrest\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\nb\n\nrest\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>tZ</summary>\n\nX\n\n</details>\nb\n\nrest\n\n</details>\n\nAfter\n'
	],
	[
		'details mid, details+more',
		'<details open>\n<summary>s</summary>\n\na‸b\n\nrest\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmore',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmoreb\n\nrest\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmoreZb\n\nrest\n\n</details>\n\nAfter\n'
	],
	[
		'details end, details+e',
		'<details open>\n<summary>s</summary>\n\nab‸\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>\n',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nZ\n\n</details>\n\nAfter\n'
	],
	[
		'quoted callout mid, closed',
		'> :::note\n> al‸pha\n> :::\n',
		':::note\nX\n:::',
		'> ::::note\n> al\n>\n> :::note\n> X\n> :::\n> pha\n> ::::\n',
		'> ::::note\n> al\n>\n> :::note\n> XZ\n> :::\n> pha\n> ::::\n'
	],
	[
		'note mid, closed+e',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n',
		'::::note\na\n\n:::note\nX\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nX\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, titled',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'::::note\na\n\n:::note Theirs\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note Theirs\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, fenced body+e',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nb\n```\ncode\n```\n:::\n',
		'::::note\na\n\n:::note\nb\n```\ncode\n```\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nb\n```\ncode\n```\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note mid, closed+2e',
		':::note\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n',
		'::::note\na\n\n:::note\nX\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note\na\n\n:::note\nX\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'note end, closed+e',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n',
		'::::note\nab\n\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nX\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note end, titled',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'::::note\nab\n\n:::note Theirs\nX\n:::\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note Theirs\nXZ\n:::\n::::\n\nAfter\n'
	],
	[
		'note end, fenced body+e',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nb\n```\ncode\n```\n:::\n',
		'::::note\nab\n\n:::note\nb\n```\ncode\n```\n:::\n\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nb\n```\ncode\n```\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note end, closed+2e',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n',
		'::::note\nab\n\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nX\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note empty, closed+e',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n',
		'::::note\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::note\nX\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note empty, titled',
		':::note\n‸\n:::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'::::note\n:::note Theirs\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::note Theirs\nXZ\n:::\n\n::::\n\nAfter\n'
	],
	[
		'note empty, fenced body+e',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nb\n```\ncode\n```\n:::\n',
		'::::note\n:::note\nb\n```\ncode\n```\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::note\nb\n```\ncode\n```\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note empty, closed+2e',
		':::note\n‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n',
		'::::note\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\n:::note\nX\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note empty row, closed+e',
		':::note\na\n\n‸\nb\n:::\n',
		':::note\nX\n:::\n',
		'::::note\na\n\n:::note\nX\n:::\n\nb\n::::\n',
		'::::note\na\n\n:::note\nX\n:::\n\nZ\n\nb\n::::\n'
	],
	[
		'note empty row, titled',
		':::note\na\n\n‸\nb\n:::\n',
		':::note Theirs\nX\n:::',
		'::::note\na\n\n:::note Theirs\nX\n:::\n\nb\n::::\n',
		'::::note\na\n\n:::note Theirs\nXZ\n:::\n\nb\n::::\n'
	],
	[
		'note start, closed+e',
		':::note\n‸alpha\n:::\n',
		':::note\nX\n:::\n',
		'::::note\n:::note\nX\n:::\n\nalpha\n::::\n',
		'::::note\n:::note\nX\n:::\n\nZ\n\nalpha\n::::\n'
	],
	[
		'note start, titled',
		':::note\n‸alpha\n:::\n',
		':::note Theirs\nX\n:::',
		'::::note\n:::note Theirs\nX\n:::\nalpha\n::::\n',
		'::::note\n:::note Theirs\nXZ\n:::\nalpha\n::::\n'
	],
	[
		'note last end, closed+e',
		':::note\nab\n\nrest‸\n:::\n\nAfter\n',
		':::note\nX\n:::\n',
		'::::note\nab\n\nrest\n\n:::note\nX\n:::\n\n::::\n\nAfter\n',
		'::::note\nab\n\nrest\n\n:::note\nX\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'note last end, titled',
		':::note\nab\n\nrest‸\n:::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'::::note\nab\n\nrest\n\n:::note Theirs\nX\n:::\n::::\n\nAfter\n',
		'::::note\nab\n\nrest\n\n:::note Theirs\nXZ\n:::\n::::\n\nAfter\n'
	],
	[
		'note last doc, closed+e',
		':::note\nab‸\n:::\n',
		':::note\nX\n:::\n',
		'::::note\nab\n\n:::note\nX\n:::\n\n::::\n',
		'::::note\nab\n\n:::note\nX\n:::\n\nZ\n::::\n'
	],
	[
		'note last doc, titled',
		':::note\nab‸\n:::\n',
		':::note Theirs\nX\n:::',
		'::::note\nab\n\n:::note Theirs\nX\n:::\n::::\n',
		'::::note\nab\n\n:::note Theirs\nXZ\n:::\n::::\n'
	],
	[
		'titled mid, closed+e',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, titled',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'::::note Mine\na\n\n:::note Theirs\nX\n:::\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note Theirs\nXZ\n:::\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, fenced body+e',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nb\n```\ncode\n```\n:::\n',
		'::::note Mine\na\n\n:::note\nb\n```\ncode\n```\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nb\n```\ncode\n```\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'titled mid, closed+2e',
		':::note Mine\na‸b\n\nrest\n:::\n\nAfter\n',
		':::note\nX\n:::\n\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::note Mine\na\n\n:::note\nX\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'two deep, closed+e',
		'::::note\nout\n\n:::note\nin‸ner\n:::\n::::\n\nAfter\n',
		':::note\nX\n:::\n',
		':::::note\nout\n\n::::note\nin\n\n:::note\nX\n:::\n\nner\n::::\n:::::\n\nAfter\n',
		':::::note\nout\n\n::::note\nin\n\n:::note\nX\n:::\n\nZ\n\nner\n::::\n:::::\n\nAfter\n'
	],
	[
		'two deep, titled',
		'::::note\nout\n\n:::note\nin‸ner\n:::\n::::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		':::::note\nout\n\n::::note\nin\n\n:::note Theirs\nX\n:::\nner\n::::\n:::::\n\nAfter\n',
		':::::note\nout\n\n::::note\nin\n\n:::note Theirs\nXZ\n:::\nner\n::::\n:::::\n\nAfter\n'
	],
	[
		'in quote, closed+e',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		':::note\nX\n:::\n',
		'> ::::note\n> a\n>\n> :::note\n> X\n> :::\n>\n> b\n> ::::\n\nAfter\n',
		'> ::::note\n> a\n>\n> :::note\n> X\n> :::\n>\n> Z\n>\n> b\n> ::::\n\nAfter\n'
	],
	[
		'in quote, titled',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		':::note Theirs\nX\n:::',
		'> ::::note\n> a\n>\n> :::note Theirs\n> X\n> :::\n> b\n> ::::\n\nAfter\n',
		'> ::::note\n> a\n>\n> :::note Theirs\n> XZ\n> :::\n> b\n> ::::\n\nAfter\n'
	],
	[
		'in item, closed+e',
		'- :::note\n  a‸b\n  :::\n- after\n',
		':::note\nX\n:::\n',
		'- ::::note\n  a\n\n  :::note\n  X\n  :::\n\n  b\n  ::::\n- after\n',
		'- ::::note\n  a\n\n  :::note\n  X\n  :::\n\n  Z\n\n  b\n  ::::\n- after\n'
	],
	[
		'in item, titled',
		'- :::note\n  a‸b\n  :::\n- after\n',
		':::note Theirs\nX\n:::',
		'- ::::note\n  a\n\n  :::note Theirs\n  X\n  :::\n  b\n  ::::\n- after\n',
		'- ::::note\n  a\n\n  :::note Theirs\n  XZ\n  :::\n  b\n  ::::\n- after\n'
	],
	[
		'in last item, closed+e',
		'- :::note\n  ab‸\n  :::\n',
		':::note\nX\n:::\n',
		'- ::::note\n  ab\n\n  :::note\n  X\n  :::\n\n  ::::\n',
		'- ::::note\n  ab\n\n  :::note\n  X\n  :::\n\n  Z\n  ::::\n'
	],
	[
		'in last item, titled',
		'- :::note\n  ab‸\n  :::\n',
		':::note Theirs\nX\n:::',
		'- ::::note\n  ab\n\n  :::note Theirs\n  X\n  :::\n  ::::\n',
		'- ::::note\n  ab\n\n  :::note Theirs\n  XZ\n  :::\n  ::::\n'
	],
	[
		'crlf, closed+e',
		':::note\r\na‸b\r\n\r\nrest\r\n:::\r\n\r\nAfter\r\n',
		':::note\nX\n:::\n',
		'::::note\r\na\r\n\r\n:::note\r\nX\r\n:::\r\n\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n',
		'::::note\r\na\r\n\r\n:::note\r\nX\r\n:::\r\n\r\nZ\r\n\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n'
	],
	[
		'crlf, titled',
		':::note\r\na‸b\r\n\r\nrest\r\n:::\r\n\r\nAfter\r\n',
		':::note Theirs\nX\n:::',
		'::::note\r\na\r\n\r\n:::note Theirs\r\nX\r\n:::\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n',
		'::::note\r\na\r\n\r\n:::note Theirs\r\nXZ\r\n:::\r\nb\r\n\r\nrest\r\n::::\r\n\r\nAfter\r\n'
	],
	[
		'box mid, box+e',
		':::box\na‸b\n\nrest\n:::\n\nAfter\n',
		':::box\nX\n:::\n',
		'::::box\na\n\n:::box\nX\n:::\n\nb\n\nrest\n::::\n\nAfter\n',
		'::::box\na\n\n:::box\nX\n:::\n\nZ\n\nb\n\nrest\n::::\n\nAfter\n'
	],
	[
		'details mid, details+e',
		'<details open>\n<summary>s</summary>\n\na‸b\n\nrest\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>\n',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nb\n\nrest\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\na\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nZ\n\nb\n\nrest\n\n</details>\n\nAfter\n'
	],
	[
		'details end, details',
		'<details open>\n<summary>s</summary>\n\nab‸\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>tZ</summary>\n\nX\n\n</details>\n\n</details>\n\nAfter\n'
	],
	[
		'details end, details+more',
		'<details open>\n<summary>s</summary>\n\nab‸\n\n</details>\n\nAfter\n',
		'<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmore',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmore\n\n</details>\n\nAfter\n',
		'<details open>\n<summary>s</summary>\n\nab\n\n<details>\n<summary>t</summary>\n\nX\n\n</details>\n\nmoreZ\n\n</details>\n\nAfter\n'
	],
	[
		'a block after it, at the text start',
		':::note\n‸head\n:::\n',
		':::note\nbody\n:::\n\n# ',
		'::::note\n:::note\nbody\n:::\n\n# head\n::::\n',
		'::::note\n:::note\nbody\n:::\n\n# Zhead\n::::\n'
	],
	[
		'note end, a body ending on a table, with its ending',
		':::note\nab‸\n:::\n\nAfter\n',
		':::note\nb\n\n| t |\n| - |\n| c |\n:::\n',
		'::::note\nab\n\n:::note\nb\n\n| t |\n| - |\n| c |\n:::\n\n::::\n\nAfter\n',
		'::::note\nab\n\n:::note\nb\n\n| t |\n| - |\n| c |\n:::\n\nZ\n::::\n\nAfter\n'
	],
	[
		'in quote, a body ending on a table, with its ending',
		'> :::note\n> a‸b\n> :::\n\nAfter\n',
		':::note\nb\n\n| t |\n| - |\n| c |\n:::\n',
		'> ::::note\n> a\n>\n> :::note\n> b\n>\n> | t |\n> | - |\n> | c |\n> :::\n>\n> b\n> ::::\n\nAfter\n',
		'> ::::note\n> a\n>\n> :::note\n> b\n>\n> | t |\n> | - |\n> | c |\n> :::\n>\n> Z\n>\n> b\n> ::::\n\nAfter\n'
	],
	[
		'in last item, a body ending on a table, with its ending',
		'- :::note\n  ab‸\n  :::\n',
		':::note\nb\n\n| t |\n| - |\n| c |\n:::\n',
		'- ::::note\n  ab\n\n  :::note\n  b\n\n  | t |\n  | - |\n  | c |\n  :::\n\n  ::::\n',
		'- ::::note\n  ab\n\n  :::note\n  b\n\n  | t |\n  | - |\n  | c |\n  :::\n\n  Z\n  ::::\n'
	]
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked, clip, after, typed] of ROWS)
		it(`${mode}: ${name}`, async () => {
			const editor = mountCase(marked.replace('‸', ''), mode);
			await editor.settle();
			const point = pointAtByte(
				measured(editor.instance.__test.getDocument()),
				marked.indexOf('‸')
			)!;
			expect(await placeRange(editor, { anchor: point, focus: point })).toBe(true);
			await pasteGesture(editor, { 'text/plain': clip }, 'key');
			const pasted = editor.source();
			await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
			await editor.settle();
			expect([pasted, editor.source()]).toEqual([after, typed]);
			expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		});

// The cut's text pasted back nests (law 3 declares the shape); its own entry puts the bytes back.
const CUTS: [name: string, marked: string][] = [
	['a note into the paragraph after it', ':::note\nal⟦pha\n:::\n\nbe⟧ta\n'],
	['a titled note', ':::note Mine\nal⟦pha\n\nrest\n:::\n\nAfter⟧ x\n'],
	['a note from its text start', ':::note\n⟦alpha\n:::\n\nbe⟧ta\n'],
	['a note in a quote', '> :::note\n> al⟦pha\n> :::\n>\n> be⟧ta\n'],
	['a note in an item', '- :::note\n  al⟦pha\n  :::\n- be⟧ta\n'],
	['a note two deep', '::::note\nout\n\n:::note\nin⟦ner\n:::\n::::\n\nbe⟧ta\n'],
	['a CRLF note', ':::note\r\nal⟦pha\r\n:::\r\n\r\nbe⟧ta\r\n'],
	['a details block', '<details open>\n<summary>s</summary>\n\nal⟦pha\n\n</details>\n\nbe⟧ta\n']
];

for (const mode of ['source', 'live'] as const)
	for (const [name, marked] of CUTS)
		it(`${mode}: a cut out of ${name}, pasted back with its own entry, is exact`, async () => {
			const source = marked.replace(/[⟦⟧]/g, '');
			const editor = mountCase(source, mode);
			await editor.settle();
			const m = measured(editor.instance.__test.getDocument());
			const anchor = pointAtByte(m, marked.indexOf('⟦'))!;
			const focus = pointAtByte(m, marked.indexOf('⟧') - 1)!;
			expect(await placeOwnedRange(editor, { anchor, focus })).toBe(true);
			const payload = await clipboardGesture(editor, 'cut', 'key');
			expect(editor.source()).not.toBe(source);
			await pasteGesture(editor, payload, 'key');
			expect(editor.source()).toBe(source);
			expect(takeDevWarns().map((w) => w.tag)).toEqual([]);
		});
