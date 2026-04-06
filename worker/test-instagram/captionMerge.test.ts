import test from "node:test";
import assert from "node:assert/strict";
import { mergeCaption } from "../src/instagram/util/captionMerge.js";

test("mergeCaption appends hashtags with spacing", () => {
  const result = mergeCaption("Final score update", ["#LBA", "#FinalScore"]);
  assert.ok(result.mergedCaption.includes("Final score update"));
  assert.ok(result.mergedCaption.includes("#LBA #FinalScore"));
});

test("mergeCaption enforces 2200 character cap", () => {
  const longCaption = "A".repeat(2195);
  const result = mergeCaption(longCaption, ["#LBA", "#FinalScore", "#Esports"]);
  assert.ok(result.mergedCaption.length <= 2200);
});

test("mergeCaption supports hashtags-only captions", () => {
  const result = mergeCaption("", ["#LBA", "#FinalScore", "#Esports"]);
  assert.equal(result.mergedCaption, "#LBA #FinalScore #Esports");
});
