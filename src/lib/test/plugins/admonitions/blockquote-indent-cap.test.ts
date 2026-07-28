import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { admonitionsPlugin, convertGithubAlerts } from '$lib/plugins/admonitions';
import { stripQuoteMarker } from '$lib/plugins/admonitions/gh-alert';

// The plugin's quote grammar is capped at CommonMark's 0–3 space block indent,
// like the built-in blockquote's. Over-accepting made the plugin strip a `>` the
// built-in keeps literal, so an edit rewrote prose into a quote marker.
beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('stripQuoteMarker honors the 0–3 space indent cap', () => {
	it('strips a marker indented within the cap', () => {
		expect(stripQuoteMarker('   > body')).toBe('body');
	});

	it('leaves a 4-space-indented marker alone (indented code, not a quote)', () => {
		expect(stripQuoteMarker('    > body')).toBe('    > body');
	});

	it('leaves a tab-indented marker alone', () => {
		expect(stripQuoteMarker('\t> body')).toBe('\t> body');
	});
});

describe('githubAlert body keeps bytes the built-in blockquote keeps', () => {
	it('preserves a tab-indented quote line as body content', () => {
		const source = '> [!NOTE]\n\t> body\n';
		const alert = parse(source).children[0];
		expect(alert.kind).toBe('githubAlert');
		expect(alert.children?.map((c) => c.raw).join('')).toContain('\t> body');
		expect(serialize(parse(source))).toBe(source);
	});

	// B9-8: a lazy-continuation line's literal `> ` used to be eaten on parse and
	// re-emitted as a real quote marker on rebuild, silently changing what the line
	// means. The rebuild may canonicalize the prefix; it must not change the content.
	it('does not turn a lazy-continuation line into a quote marker on rebuild', () => {
		const alert = parse('> [!NOTE]\n> a\n    > b\n').children[0];
		const before = alert.children!.map((c) => c.raw).join('');
		expect(before).toContain('    > b');

		getBlockKindDescriptor(alert.kind).rebuildRaw!(alert);

		const after = parse(alert.raw).children[0];
		expect(after.kind).toBe('githubAlert');
		expect(after.children!.map((c) => c.raw).join('')).toBe(before);
	});
});

describe('the transform caps the gates the parser caps, and no others', () => {
	// The blockquote-start probe is capped: `    > x` is indented code, so the line
	// below it opens a quote of its own and its marker counts.
	it('converts an alert preceded by an indented-code line starting with >', () => {
		const { converted, changed } = convertGithubAlerts('    > x\n> [!NOTE]\n> body\n');
		expect(changed).toBe(true);
		expect(converted).toBe('    > x\n:::note\nbody\n:::\n');
	});

	// The body scan is NOT capped. A cap declines a strip but STOPS a scan, and
	// stopping ejected the rest of the alert — the parser absorbs the line as lazy
	// continuation, so the converted container has to keep it too, bytes untouched.
	it('keeps an over-indented body line inside the alert instead of ejecting it', () => {
		const { converted } = convertGithubAlerts('> [!NOTE]\n> in\n    > out\n');
		expect(converted).toBe(':::note\nin\n    > out\n:::\n');
	});
});
