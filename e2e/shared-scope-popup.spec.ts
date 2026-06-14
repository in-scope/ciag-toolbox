import { test } from "@playwright/test";

import { multiBandTiff } from "./fixtures/fixture-manifest";
import { closeToolboxApp, launchToolboxApp } from "./support/launch-app";
import type { LaunchedApp } from "./support/launch-app";
import {
  applyOperationInPlace,
  cancelOperation,
  expectHistoryToRecordOperation,
  loadFixtureAsStack,
  openOperation,
} from "./support/page-objects";
import {
  expectScopeControlOffersExactlyTheSharedTwoOptions,
  selectBandWiseScopeForBands,
  selectFullStackScope,
} from "./support/cube-scope-control";

// CT-135 / manual section 2 (CT-076): the shared "Full stack vs Band-wise" scope popup.
// Normalize and Standardize embed the SAME scope control: exactly two options with identical
// wording, and applying with each scope records the chosen scope (and the band selection for
// band-wise) in History. Asserted against the multi-band fixture so band-wise has > 1 band.
//
// STALE-MANUAL (no E2E-BUG): manual 2.1 lists "Full cube" / "Band-wise (selected bands)", but
// the Stage-3 app's locked wording is "Full stack" / "Band-wise (enter bands)" (parameter-form-
// section.tsx; registered-actions.test.ts documents the History label "band-wise: bands N"). Per
// testFailureProtocol step 1 the spec asserts the real wording.

const NORMALIZE = "Normalize";
const STANDARDIZE = "Standardize";
const BAND_WISE_RANGE = "1,3";
const BAND_WISE_HISTORY_DETAIL = "band-wise: bands 1,3";
const FULL_STACK_HISTORY_DETAIL = "full stack";

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchToolboxApp();
  await loadFixtureAsStack(launched.window, multiBandTiff.fileName);
});

test.afterEach(async () => {
  await closeToolboxApp(launched);
});

test("Normalize and Standardize offer the same two scope options with identical wording", async () => {
  await openOperation(launched.window, NORMALIZE);
  await expectScopeControlOffersExactlyTheSharedTwoOptions(launched.window, NORMALIZE);
  await cancelOperation(launched.window, NORMALIZE);

  await openOperation(launched.window, STANDARDIZE);
  await expectScopeControlOffersExactlyTheSharedTwoOptions(launched.window, STANDARDIZE);
  await cancelOperation(launched.window, STANDARDIZE);
});

test("Normalize records the chosen scope (full stack, then band-wise with its bands)", async () => {
  await applyNormalizeWithFullStackScope();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: NORMALIZE,
    detailSubstrings: [FULL_STACK_HISTORY_DETAIL],
  });

  await applyNormalizeWithBandWiseScope();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: NORMALIZE,
    detailSubstrings: [BAND_WISE_HISTORY_DETAIL],
  });
});

test("Standardize records the chosen scope (full stack, then band-wise with its bands)", async () => {
  await applyStandardizeWithFullStackScope();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: STANDARDIZE,
    detailSubstrings: [FULL_STACK_HISTORY_DETAIL],
  });

  await applyStandardizeWithBandWiseScope();
  await expectHistoryToRecordOperation(launched.window, {
    actionLabel: STANDARDIZE,
    detailSubstrings: [BAND_WISE_HISTORY_DETAIL],
  });
});

async function applyNormalizeWithFullStackScope(): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await selectFullStackScope(launched.window, NORMALIZE);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function applyNormalizeWithBandWiseScope(): Promise<void> {
  await openOperation(launched.window, NORMALIZE);
  await selectBandWiseScopeForBands(launched.window, NORMALIZE, BAND_WISE_RANGE);
  await applyOperationInPlace(launched.window, NORMALIZE);
}

async function applyStandardizeWithFullStackScope(): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectFullStackScope(launched.window, STANDARDIZE);
  await applyOperationInPlace(launched.window, STANDARDIZE);
}

async function applyStandardizeWithBandWiseScope(): Promise<void> {
  await openOperation(launched.window, STANDARDIZE);
  await selectBandWiseScopeForBands(launched.window, STANDARDIZE, BAND_WISE_RANGE);
  await applyOperationInPlace(launched.window, STANDARDIZE);
}
