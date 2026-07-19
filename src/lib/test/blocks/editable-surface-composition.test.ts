// @vitest-environment jsdom
//
// The IME composition window driven through the real surface skeleton, in the
// order the browser sends it: start → input(s) with the window open → end,
// which funnels to input and reads the DOM back. Pins the composing gate (no
// commit mid-window), the exactly-once end commit, the offset pair the commit
// receives, and G1.27 (an unpaired end fires; a paired cycle stays silent).
// The commit's downstream effects (undo anchor, no-op discard) are pinned
// against the real block-edit actions in editable-surface-composition-commit.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { makeSurface } from '../harness/editable-surface';

function compositionFires(): unknown[][] {
	return vi.mocked(devWarn).mock.calls.filter(([tag]) => tag === 'invariant:composition-window');
}

beforeEach(() => {
	vi.stubEnv('DEV', true);
	vi.mocked(devWarn).mockClear();
});
afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllEnvs();
});

describe('editable surface — the composing gate', () => {
	it('input events inside the window never commit; the end commits the DOM text once', () => {
		const { surface, commits, el } = makeSurface();
		el.textContent = 'hello';
		surface.onCompositionStart();

		el.textContent = 'helloか';
		surface.onInput();
		el.textContent = 'helloかん';
		surface.onInput();
		expect(commits).toHaveLength(0);

		surface.onCompositionEnd();
		expect(commits.map((c) => c.text)).toEqual(['helloかん']);
	});

	it('the offsets captured at start survive a caret the IME moved mid-window', () => {
		const { surface, commits, el, setCaret } = makeSurface();
		el.textContent = 'hello';
		setCaret(5);
		surface.onCompositionStart();

		// The IME advances the caret as it composes; keydowns that would refresh
		// preEditOffset are gated on the composing flag, so 5 must survive.
		setCaret(7);
		el.textContent = 'helloかん';
		surface.onCompositionEnd();

		expect(commits).toEqual([{ text: 'helloかん', preEdit: 5, saved: 7 }]);
	});

	it('input after the window closes commits normally again', () => {
		const { surface, commits, el } = makeSurface();
		el.textContent = 'hello';
		surface.onCompositionStart();
		surface.onCompositionEnd();

		el.textContent = 'hello!';
		surface.onInput();
		expect(commits.map((c) => c.text)).toEqual(['hello', 'hello!']);
	});
});

describe('editable surface — composition window (G1.27)', () => {
	it('compositionend with no open composition fires', () => {
		const { surface } = makeSurface();
		surface.onCompositionEnd();
		expect(compositionFires()).toHaveLength(1);
		expect(compositionFires()[0][2]).toBe('end-without-start');
	});

	it('a paired start → end cycle stays silent', () => {
		const { surface } = makeSurface();
		surface.onCompositionStart();
		surface.onCompositionEnd();
		expect(devWarn).not.toHaveBeenCalled();
	});
});
