/****
 * Fixture-driven validation for supported and fallback parser PoC cases.
 ****/
import assert from "node:assert/strict";
import test from "node:test";

import {
    buildRecoveryRegionProofs,
    parseMarkdownProofOfConcept,
    serializeProofOfConceptDocument,
} from "../core/index.js";
import {
    PARSER_VALIDATION_CASE_GROUPS,
    PRESERVE_ONLY_AND_FALLBACK_CASES,
    type ParserValidationCase,
} from "./fixtures/parser-validation-fixtures.js";

for (const group of PARSER_VALIDATION_CASE_GROUPS) {
    for (const fixture of group.cases) {
        test(`Parser validation: ${group.label} case ${fixture.name}`, () => {
            assertParserFixture(fixture);
        });
    }
}

for (const fixture of PRESERVE_ONLY_AND_FALLBACK_CASES.filter((candidate) => candidate.expectedRecoveryReasons)) {
    test(`Parser validation: recovery proofs for ${fixture.name}`, () => {
        assertParserFixture(fixture);
    });
}

function assertParserFixture(fixture: ParserValidationCase): void {
    const document = parseMarkdownProofOfConcept(fixture.source);

    assert.equal(
        serializeProofOfConceptDocument(document),
        fixture.source,
        `Expected exact round-trip for fixture ${fixture.name}.`
    );
    assert.deepEqual(
        document.blocks.map((block) => block.kind),
        fixture.expectedBlockKinds,
        `Unexpected block kinds for fixture ${fixture.name}.`
    );

    if (fixture.expectedInlineTokens) {
        for (const expectation of fixture.expectedInlineTokens) {
            assert.deepEqual(
                document.blocks[expectation.blockIndex]?.inlineTokens.map((token) => token.kind) ?? [],
                expectation.kinds,
                `Unexpected inline token kinds for fixture ${fixture.name} block ${expectation.blockIndex}.`
            );
        }
    }

    if (fixture.expectedBlockMetadata) {
        for (const expectation of fixture.expectedBlockMetadata) {
            const actualMetadata = document.blocks[expectation.blockIndex]?.metadata;

            assert.equal(actualMetadata !== undefined, true, `Missing block metadata for fixture ${fixture.name} block ${expectation.blockIndex}.`);

            // Metadata assertions intentionally check only the declared keys so fixtures can stay focused.
            for (const [key, value] of Object.entries(expectation.metadata)) {
                assert.equal(
                    actualMetadata?.[key as keyof typeof expectation.metadata],
                    value,
                    `Unexpected metadata key ${key} for fixture ${fixture.name} block ${expectation.blockIndex}.`
                );
            }
        }
    }

    if (fixture.expectedFenceClosed !== undefined) {
        const fencedBlock = document.blocks.find((block) => block.kind === "fencedCode");
        assert.equal(
            fencedBlock?.metadata.closed,
            fixture.expectedFenceClosed,
            `Unexpected fence closure state for fixture ${fixture.name}.`
        );
    }

    if (fixture.expectedRecoveryReasons) {
        assert.deepEqual(
            buildRecoveryRegionProofs(fixture.source).map((proof) => proof.reason),
            fixture.expectedRecoveryReasons,
            `Unexpected recovery reasons for fixture ${fixture.name}.`
        );
    }
}
