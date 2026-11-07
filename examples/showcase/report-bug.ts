/**
 * The bar's "report a bug" action: asks first, records the visitor's input with text, then on
 * Stop opens GitHub's prefilled bug form in a new tab. It never files anything; the visitor reads
 * the form and submits it themselves.
 */
import { el, icon, setAttrs } from './bar-dom';
import { bugReport, describeWhere, type BugRecording } from './bug-report';
import { closeOnEscape } from './popover';

/** The editor's input recorder, typed by shape so every host's editor handle fits. */
export interface RecordingEditor {
	getDiagnostics(): {
		recordInput(options: { includeText: boolean }): { stop(): BugRecording };
	};
}

export interface ReportBugOptions {
	editor: () => RecordingEditor | null | undefined;
	mode: () => string;
}

type Phase = 'idle' | 'asking' | 'recording' | 'sent';

export function mountReportBug(options: ReportBugOptions): {
	anchor: HTMLElement;
	destroy(): void;
} {
	let phase: Phase = 'idle';
	let handle: { stop(): BugRecording } | null = null;
	let attachment = '';
	let carrier: 'clipboard' | 'download' = 'clipboard';
	let copyFailed = false;

	const label = el('span', { class: 'showcase-action-label' });
	const glyph = el('span', { class: 'showcase-action-glyph' });
	const button = el(
		'button',
		{ type: 'button', class: 'showcase-action', 'data-testid': 'report-bug' },
		glyph,
		label
	);
	const anchor = el('div', { class: 'showcase-popover-anchor report-anchor' }, button);
	let card: HTMLElement | null = null;

	button.addEventListener('click', () => {
		if (phase === 'recording') stop();
		else show(phase === 'asking' ? 'idle' : 'asking');
	});

	// The card closes on Escape but not on a press outside: a stray click should not throw away
	// the privacy note before Start.
	let releaseEscape: (() => void) | null = null;

	function show(next: Phase, message?: () => HTMLElement) {
		phase = next;
		card?.remove();
		releaseEscape?.();
		releaseEscape = null;
		card = message ? message() : next === 'asking' ? askingCard() : null;
		if (card) {
			anchor.append(card);
			releaseEscape = closeOnEscape(anchor, () => show('idle'));
		}
		paintButton();
	}

	function paintButton() {
		const recording = phase === 'recording';
		glyph.replaceChildren(
			recording ? el('span', { class: 'showcase-rec-dot', 'aria-hidden': 'true' }) : icon('bug', 14)
		);
		label.textContent = recording ? 'stop and report' : 'report a bug';
		setAttrs(button, { 'aria-expanded': recording ? undefined : String(phase === 'asking') });
	}

	function start() {
		handle = options.editor()?.getDiagnostics().recordInput({ includeText: true }) ?? null;
		show(handle ? 'recording' : 'idle');
	}

	// The tab opens in the click's own turn: Safari drops a window.open made after an await.
	function stop() {
		const recording = handle?.stop();
		handle = null;
		if (!recording) return show('idle');
		const nav = navigator as Navigator & { userAgentData?: { platform: string } };
		const where = describeWhere(
			recording.editor.version,
			nav.userAgent,
			nav.userAgentData?.platform,
			options.mode()
		);
		const report = bugReport(recording, where);
		attachment = report.attachment;
		carrier = report.carrier;
		copyFailed = false;
		if (carrier === 'clipboard') copy();
		else download(recording, attachment);
		window.open(report.url, '_blank', 'noopener');
		show('sent', sentCard);
	}

	// A copy refused as the new tab took focus works from a click of its own on this page. Firefox
	// can finish the copy inside `window.open`, before the card is up, so its outcome is kept.
	function copy() {
		navigator.clipboard.writeText(attachment).then(
			() => copied(false),
			() => copied(true)
		);
	}

	function copied(failed: boolean) {
		copyFailed = failed;
		if (phase === 'sent') show('sent', sentCard);
	}

	function download(recording: BugRecording, json: string) {
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
		link.download = `aragonite-recording-${recording.steps.length}-steps.json`;
		link.click();
		URL.revokeObjectURL(link.href);
	}

	function actionButton(text: string, primary: boolean, onClick: () => void) {
		const node = el(
			'button',
			{ type: 'button', class: primary ? 'report-start' : 'report-cancel' },
			text
		);
		node.addEventListener('click', onClick);
		return node;
	}

	function askingCard() {
		return el(
			'div',
			{
				class: 'report-card',
				role: 'dialog',
				'aria-label': 'Report a bug',
				'data-testid': 'report-card'
			},
			el(
				'p',
				{},
				'Press start, do the thing that broke, then press stop. GitHub opens a new bug report in ' +
					'another tab, and a recording of what you did goes on your clipboard to paste into it.'
			),
			el(
				'p',
				{},
				el(
					'strong',
					{},
					"The recording includes everything you type and the whole document's text"
				),
				', and an issue you submit is public. Nothing reaches GitHub until you paste it and submit.'
			),
			el(
				'div',
				{ class: 'report-actions' },
				actionButton('Start recording', true, start),
				actionButton('Cancel', false, () => show('idle'))
			)
		);
	}

	function sentCard() {
		const text =
			carrier === 'download'
				? "GitHub opened in a new tab. The recording was too long for an issue, so it downloaded as a file: drag it into the form's Recording box."
				: copyFailed
					? "GitHub opened in a new tab, but the browser kept the recording off your clipboard. Copy it here, then paste it into the form's Recording box."
					: "GitHub opened in a new tab and the recording is on your clipboard: paste it into the form's Recording box, add what happened, and submit.";
		return el(
			'div',
			{ class: 'report-card', role: 'status', 'data-testid': 'report-card' },
			el('p', {}, text),
			el(
				'div',
				{ class: 'report-actions' },
				...(copyFailed ? [actionButton('Copy recording', true, copy)] : []),
				actionButton('Close', false, () => show('idle'))
			)
		);
	}

	paintButton();
	return {
		anchor,
		destroy() {
			releaseEscape?.();
			handle?.stop();
		}
	};
}
