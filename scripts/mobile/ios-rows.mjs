// The iOS Simulator rows, keyed by the scenario each one runs in
// `src/lib/e2e/requirements/mobile/ios.md`; the probes are reported and judge nothing. Taps are
// native (`nativeWebTap`), keys are taps on the on-screen keyboard's `XCUIElementTypeKey`s.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { distinguishable, shape } from './judge.mjs';

const WORD = 'hello';
const SHORT = 'alpha beta\n\ngamma delta\n\nepsilon zeta\n';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Rows ──────────────────────────

export const rows = {
	'types a word through the on-screen keyboard': async (ctx) => {
		await ctx.fresh(ctx.url, SHORT);
		const real = await record(ctx, 'keyboard', (typed) => tapKeys(ctx, 0, typed));
		const control = await record(ctx, 'send-keys', (typed) => sendKeys(ctx, 1, typed));
		const reasons = [];
		if (real.error) reasons.push(real.error.split('\n')[0]);
		else if (real.actual !== real.expected)
			reasons.push(`expected ${JSON.stringify(real.expected)}, got ${JSON.stringify(real.actual)}`);
		if (shape(real.recording).untrusted > 0)
			reasons.push('untrusted events in the keyboard typing');
		if (!distinguishable(real.recording, control.recording))
			reasons.push('the keyboard and sendKeys recordings cannot be told apart');
		return { reasons, evidence: { real: summary(real), control: summary(control) } };
	}
};

// ── Probes ──────────────────────────

export const probes = {
	// Whether the first tap misses because of something the drag handles do on hover: the same
	// first tap with the handles off, for comparison with the row's.
	'first tap with the drag handles off': async (ctx) => {
		await ctx.fresh(`${ctx.url}?dragHandles=false`, SHORT);
		const log = await logEvents(ctx, async () => ctx.click(await ctx.editable(0)));
		return {
			keyboard: await keyboardShown(ctx),
			selection: await ctx.run('return window.__test.getSelection()'),
			pageEvents: log
		};
	}
};

// ── Steps ──────────────────────────

async function keyboardShown(ctx) {
	await ctx.native();
	let shown = false;
	for (let i = 0; i < 40 && !shown; i++) {
		shown = !!(await ctx.tryFind('-ios class chain', '**/XCUIElementTypeKeyboard'));
		if (!shown) await sleep(250);
	}
	await ctx.web();
	return shown;
}

// The editable's centre sits past the end of its short line, so the tap leaves the caret at its
// end. A tap that brings up no keyboard is tried up to three times; the first one's page events
// are kept, since the first tap is the one that misses.
async function tapKeys(ctx, index, typed) {
	typed.tapAttempts = 0;
	let shown = false;
	while (!shown && typed.tapAttempts < 3) {
		typed.tapAttempts++;
		const tap = async () => ctx.click(await ctx.editable(index));
		if (typed.tapAttempts === 1) typed.firstTapEvents = await logEvents(ctx, tap);
		else await tap();
		shown = await keyboardShown(ctx);
	}
	if (!shown) throw new Error('the soft keyboard never showed after three taps');
	await expectAtCaret(ctx, index, typed);
	await ctx.native();
	const keyFor = (ch) =>
		ctx.tryFind(
			'-ios predicate string',
			`type == 'XCUIElementTypeKey' AND name == '${ch === ' ' ? 'space' : ch}'`
		);
	for (const ch of ` ${WORD} `) {
		const key = await keyFor(ch);
		if (!key) throw new Error(`no XCUIElementTypeKey named ${JSON.stringify(ch)}`);
		await ctx.click(key);
		await sleep(300);
	}
	await ctx.web();
}

async function sendKeys(ctx, index, typed) {
	await ctx.call('POST', ctx.s(`/element/${await ctx.editable(index)}/value`), {
		text: ` ${WORD} `
	});
	await sleep(1000);
	typed.expected = null;
}

async function expectAtCaret(ctx, index, typed) {
	const selection = await ctx.run('return window.__test.getSelection()');
	const before = await ctx.source();
	if (selection?.focus.path[0] !== index)
		throw new Error(`the tap meant for block ${index} landed at ${JSON.stringify(selection)}`);
	const at = before.indexOf(before.split('\n\n')[index]) + selection.focus.offset;
	typed.caret = selection;
	typed.expected = `${before.slice(0, at)} ${WORD} ${before.slice(at)}`;
}

async function record(ctx, name, type) {
	const typed = { name };
	try {
		await ctx.run('window.__test.startInputRecording({ includeText: true }); return true');
		await type(typed);
		for (let i = 0; i < 40 && typed.expected && (await ctx.source()) !== typed.expected; i++)
			await sleep(250);
		typed.actual = await ctx.source();
	} catch (error) {
		typed.error = String(error?.stack ?? error);
	}
	await ctx.screenshot(name).catch(() => {});
	await ctx.web().catch(() => {});
	typed.recording = await ctx.run('return window.__test.stopInputRecording()').catch(() => null);
	writeFileSync(path.join(ctx.out, `${name}.recording.json`), JSON.stringify(typed.recording));
	return typed;
}

// The page's own log of a tap: the mouse events iOS synthesizes after a touch are the question.
async function logEvents(ctx, gesture) {
	await ctx.run(`(() => {
		const log = (window.__eventLog = []);
		const types = ['pointerover', 'pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click', 'focusin', 'selectionchange'];
		for (const type of types)
			document.addEventListener(type, (e) => {
				if (window.__eventLog !== log) return;
				const t = e.target;
				log.push({ type, t: Math.round(e.timeStamp), on: t?.nodeType === 1 ? t.tagName + (t.className ? '.' + String(t.className).split(' ')[0] : '') : '#text' });
			}, true);
		return true;
	})()`);
	await gesture();
	await sleep(1500);
	await ctx.web();
	return ctx.run('return window.__eventLog.slice(0, 60)');
}

function summary(typed) {
	const { recording, ...rest } = typed;
	return { ...rest, shape: shape(recording) };
}
