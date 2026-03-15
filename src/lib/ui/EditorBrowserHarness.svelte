<script lang="ts">
    /**
     * Browser-backed projection harness for the narrow editor proof of concept.
     */
    import { onMount, tick } from "svelte";

    import {
        buildInputHarnessProofOfConcept,
        createCollapsedInputHarnessTextSelection,
        createInputHarnessNodeSelection,
        findFirstInputHarnessBlockByRole,
        projectInputHarnessDocument,
        reconcileInputHarnessDomSelection,
        type InputHarnessSelection,
        type ViewProjectionInlineRun,
    } from "$lib/editor";
    import {
        applyInputHarnessSelectionToBrowser,
        describeInputHarnessSelection,
        readInputHarnessDomSelectionFromBrowser,
    } from "./dom-mapping.js";
    import { EDITOR_BROWSER_HARNESS_FIXTURE } from "./demo-fixture.js";

    let {
        source = EDITOR_BROWSER_HARNESS_FIXTURE,
    }: {
        source?: string;
    } = $props();

    let rootElement = $state<HTMLElement | null>(null);
    let logicalSelection = $state<InputHarnessSelection | null>(null);
    let browserSelectionStatus = $state("Use the preset buttons or drag-select inside the harness.");
    let activePreset = $state("none");

    const harnessState = $derived.by(() => {
        const inputDocument = buildInputHarnessProofOfConcept(source);

        return {
            inputDocument,
            projection: projectInputHarnessDocument(inputDocument),
        };
    });

    /**
     * Applies one of the narrow harness presets to the live browser selection.
     */
    async function applyPreset(preset: string): Promise<void> {
        activePreset = preset;
        const nextSelection = buildSelectionPreset(preset);
        if (!nextSelection) {
            browserSelectionStatus = `Preset ${preset} is unavailable for the current fixture.`;
            return;
        }

        logicalSelection = nextSelection;
        await tick();

        if (!rootElement) {
            browserSelectionStatus = "The browser harness surface is not mounted yet.";
            return;
        }

        const applied = applyInputHarnessSelectionToBrowser(
            rootElement,
            harnessState.projection,
            harnessState.inputDocument,
            nextSelection
        );

        browserSelectionStatus = applied
            ? `Applied preset ${preset}.`
            : `Failed to apply preset ${preset} to the browser DOM.`;
    }

    /**
     * Pulls the browser selection back into the headless logical selection model.
     */
    function syncSelectionFromBrowser(): void {
        if (!rootElement) {
            return;
        }

        const domSelection = readInputHarnessDomSelectionFromBrowser(rootElement, harnessState.projection);
        if (!domSelection) {
            return;
        }

        logicalSelection = reconcileInputHarnessDomSelection(harnessState.inputDocument, domSelection);
        browserSelectionStatus = `Mapped browser selection. ${describeInputHarnessSelection(logicalSelection)}`;
    }

    /**
     * Creates focused test selections for the browser-backed harness cases.
     */
    function buildSelectionPreset(preset: string): InputHarnessSelection | null {
        const document = harnessState.inputDocument;

        switch (preset) {
            case "paragraph": {
                const block = findFirstInputHarnessBlockByRole(document, "paragraph");
                return block ? createCollapsedInputHarnessTextSelection(document, block.key, 12) : null;
            }
            case "heading": {
                const block = findFirstInputHarnessBlockByRole(document, "heading");
                return block ? createCollapsedInputHarnessTextSelection(document, block.key, 7) : null;
            }
            case "listItem": {
                const block = findFirstInputHarnessBlockByRole(document, "listItem");
                return block ? createCollapsedInputHarnessTextSelection(document, block.key, 5) : null;
            }
            case "fencedCode": {
                const block = findFirstInputHarnessBlockByRole(document, "fencedCode");
                return block ? createCollapsedInputHarnessTextSelection(document, block.key, Math.max(0, block.textLength - 1)) : null;
            }
            case "image": {
                const imagePart = harnessState.inputDocument.blocks
                    .flatMap((block) => block.parts)
                    .find((part) => part.kind === "atom");
                return imagePart ? createInputHarnessNodeSelection(document, imagePart.key) : null;
            }
            default:
                return null;
        }
    }

    function chromeForBlock(block: (typeof harnessState.projection.blocks)[number]): string {
        switch (block.role) {
            case "heading":
                return `${"#".repeat(block.metadata.headingLevel ?? 1)} `;
            case "listItem":
                if (block.metadata.taskItem) {
                    return `${block.metadata.listMarker ?? "-"} [${block.metadata.taskChecked ? "x" : " "}] `;
                }
                return `${block.metadata.listMarker ?? "-"} `;
            case "blockquote":
                return "> ";
            default:
                return "";
        }
    }

    function runClass(run: ViewProjectionInlineRun): string {
        return [
            run.atomic ? "editor-browser-harness__run--atom" : "",
            run.marks.includes("strong") ? "editor-browser-harness__run--strong" : "",
            run.marks.includes("emphasis") ? "editor-browser-harness__run--emphasis" : "",
            run.marks.includes("strikethrough") ? "editor-browser-harness__run--strike" : "",
            run.marks.includes("inlineCode") ? "editor-browser-harness__run--code" : "",
            run.marks.includes("link") || run.marks.includes("autolink") ? "editor-browser-harness__run--link" : "",
        ]
            .filter(Boolean)
            .join(" ");
    }

    onMount(() => {
        const handleSelectionChange = (): void => {
            syncSelectionFromBrowser();
        };

        globalThis.document.addEventListener("selectionchange", handleSelectionChange);

        return () => {
            globalThis.document.removeEventListener("selectionchange", handleSelectionChange);
        };
    });
</script>

<section class="editor-browser-harness">
    <header class="editor-browser-harness__header">
        <div>
            <h3>editor browser harness</h3>
            <p class="editor-browser-harness__copy">
                Narrow browser-backed rendering for the projection proof of concept.
            </p>
        </div>
        <div class="editor-browser-harness__actions">
            <button class:active={activePreset === "paragraph"} onclick={() => applyPreset("paragraph")}>paragraph</button>
            <button class:active={activePreset === "heading"} onclick={() => applyPreset("heading")}>heading</button>
            <button class:active={activePreset === "listItem"} onclick={() => applyPreset("listItem")}>list item</button>
            <button class:active={activePreset === "fencedCode"} onclick={() => applyPreset("fencedCode")}>code fence</button>
            <button class:active={activePreset === "image"} onclick={() => applyPreset("image")}>image atom</button>
        </div>
    </header>

    <div class="editor-browser-harness__status">
        <p>{browserSelectionStatus}</p>
        <p>{describeInputHarnessSelection(logicalSelection)}</p>
    </div>

    <div class="editor-browser-harness__surface" bind:this={rootElement} contenteditable="true" spellcheck="false">
        {#each harnessState.projection.blocks as block (block.key)}
            <div
                class={`editor-browser-harness__block editor-browser-harness__block--${block.role}`}
                data-editor-block-key={block.blockKey}
                data-editor-projection-key={block.key}
            >
                {#if block.role === "fencedCode"}
                    <div class="editor-browser-harness__chrome" contenteditable="false">```</div>
                {/if}

                {#if chromeForBlock(block)}
                    <span class="editor-browser-harness__chrome" contenteditable="false">{chromeForBlock(block)}</span>
                {/if}

                {#if block.runs.length > 0}
                    {#each block.runs as run (run.key)}
                        <span
                            class={`editor-browser-harness__run ${runClass(run)}`}
                            data-editor-run-key={run.key}
                            data-editor-part-key={run.partKey}
                            data-editor-run-kind={run.atomic ? "atom" : "text"}
                            data-editor-block-key={block.blockKey}
                            contenteditable={run.atomic ? "false" : undefined}
                        >
                            {#if run.atomic}
                                <span class="editor-browser-harness__atom-label">image</span>
                            {:else}
                                {run.text}
                            {/if}
                        </span>
                    {/each}
                {:else if block.rawSource}
                    <span class="editor-browser-harness__raw" contenteditable="false">{block.rawSource}</span>
                {/if}

                {#if block.role === "fencedCode"}
                    <div class="editor-browser-harness__chrome" contenteditable="false">```</div>
                {/if}
            </div>
        {/each}
    </div>
</section>

<style>
    .editor-browser-harness {
        border: 1px solid var(--color-ui-muted);
        background: var(--color-surface);
        border-radius: 8px;
        padding: 1rem;
        display: grid;
        gap: 0.9rem;
    }

    .editor-browser-harness__header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: flex-start;
    }

    .editor-browser-harness__copy {
        color: var(--color-ui-dulled);
        font-size: 0.9rem;
        margin-top: 0.3rem;
    }

    .editor-browser-harness__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }

    .editor-browser-harness__actions button.active {
        background: var(--color-accent-primary);
        color: var(--color-text-primary);
    }

    .editor-browser-harness__status {
        display: grid;
        gap: 0.2rem;
        color: var(--color-ui-dulled);
        font-size: 0.85rem;
    }

    .editor-browser-harness__surface {
        border: 1px solid var(--color-ui-muted);
        border-radius: 6px;
        background: color-mix(in srgb, var(--color-surface) 78%, white 4%);
        min-height: 18rem;
        padding: 1rem;
        display: grid;
        gap: 0.6rem;
        white-space: pre-wrap;
        outline: none;
    }

    .editor-browser-harness__block--heading {
        font-size: 1.3rem;
        font-weight: 600;
    }

    .editor-browser-harness__block--blockquote {
        padding-left: 0.8rem;
        border-left: 3px solid var(--color-ui-muted);
    }

    .editor-browser-harness__block--fencedCode {
        font-family: monospace;
        background: color-mix(in srgb, var(--color-surface) 90%, black 10%);
        border-radius: 6px;
        padding: 0.6rem 0.8rem;
    }

    .editor-browser-harness__chrome {
        color: var(--color-ui-dulled);
        user-select: none;
    }

    .editor-browser-harness__run--strong {
        font-weight: 700;
    }

    .editor-browser-harness__run--emphasis {
        font-style: italic;
    }

    .editor-browser-harness__run--strike {
        text-decoration: line-through;
    }

    .editor-browser-harness__run--code {
        font-family: monospace;
        background: color-mix(in srgb, var(--color-surface) 75%, white 5%);
        border-radius: 4px;
        padding: 0 0.15rem;
    }

    .editor-browser-harness__run--link {
        color: #8ec5ff;
        text-decoration: underline;
    }

    .editor-browser-harness__run--atom {
        display: inline-flex;
        align-items: center;
        padding: 0.1rem 0.4rem;
        margin: 0 0.1rem;
        border-radius: 999px;
        border: 1px solid var(--color-ui-muted);
        background: color-mix(in srgb, var(--color-accent-primary) 25%, transparent);
        user-select: none;
    }

    .editor-browser-harness__atom-label {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }

    .editor-browser-harness__raw {
        color: var(--color-ui-dulled);
        font-family: monospace;
    }
</style>
