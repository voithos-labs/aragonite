/**
 * Smoke tests for the read-only view projection proof of concept.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    buildViewProjectionProofOfConcept,
    findFirstViewProjectionBlockByRole,
    type ViewProjectionBlockDescriptor,
    type ViewProjectionInlineRun,
} from "../core/index.js";
import { MIXED_GFM_FIXTURE } from "./fixtures/mixed-gfm-fixture.js";

test("View projection PoC produces the expected flat block stream", () => {
    const projection = buildViewProjectionProofOfConcept(MIXED_GFM_FIXTURE);

    assert.deepEqual(
        projection.blocks.map((block) => block.role),
        ["heading", "paragraph", "listItem", "listItem", "blockquote", "fencedCode", "thematicBreak"]
    );
});

test("View projection PoC carries container context and block metadata for structural blocks", () => {
    const projection = buildViewProjectionProofOfConcept(MIXED_GFM_FIXTURE);
    const heading = findFirstViewProjectionBlockByRole(projection, "heading");
    const taskListItem = projection.blocks.find(
        (block: ViewProjectionBlockDescriptor) => block.role === "listItem" && block.metadata.taskItem === true
    );
    const blockquote = findFirstViewProjectionBlockByRole(projection, "blockquote");

    assert.equal(heading?.metadata.headingLevel, 1);
    assert.equal(taskListItem?.containerContext.listDepth, 1);
    assert.equal(taskListItem?.containerContext.listKind, "unordered");
    assert.equal(taskListItem?.containerContext.taskChecked, false);
    assert.equal(blockquote?.containerContext.quoteDepth, 1);
});

test("View projection PoC flattens inline marks and preserves image atoms", () => {
    const projection = buildViewProjectionProofOfConcept(MIXED_GFM_FIXTURE);
    const paragraph = findFirstViewProjectionBlockByRole(projection, "paragraph");
    const imageListItem = projection.blocks.find((block: ViewProjectionBlockDescriptor) =>
        block.role === "listItem" && block.runs.some((run: ViewProjectionInlineRun) => run.atomic?.kind === "image")
    );

    assert.equal(paragraph !== undefined, true);
    assert.equal(paragraph?.runs.some((run: ViewProjectionInlineRun) => run.marks.includes("strong")), true);
    assert.equal(paragraph?.runs.some((run: ViewProjectionInlineRun) => run.marks.includes("strikethrough")), true);
    assert.equal(paragraph?.runs.some((run: ViewProjectionInlineRun) => run.marks.includes("inlineCode")), true);
    assert.equal(paragraph?.runs.some((run: ViewProjectionInlineRun) => run.marks.includes("autolink")), true);

    const imageRun = imageListItem?.runs.find((run: ViewProjectionInlineRun) => run.atomic?.kind === "image");
    assert.equal(imageRun?.editable, false);
    assert.equal(imageRun?.source, "![alt](image.png)");
});

test("View projection PoC leaves void blocks raw and fenced code plain-text editable", () => {
    const projection = buildViewProjectionProofOfConcept(MIXED_GFM_FIXTURE);
    const codeBlock = findFirstViewProjectionBlockByRole(projection, "fencedCode");
    const thematicBreak = findFirstViewProjectionBlockByRole(projection, "thematicBreak");

    assert.equal(codeBlock?.runs.some((run: ViewProjectionInlineRun) => run.text.includes('console.log("hello");')), true);
    assert.equal(codeBlock?.runs.some((run: ViewProjectionInlineRun) => run.marks.length > 0), false);
    assert.equal(thematicBreak?.runs.length, 0);
    assert.equal(thematicBreak?.rawSource, "---\n");
});
