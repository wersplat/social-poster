import test from "node:test";
import assert from "node:assert/strict";
import { parseBeatWriterMilestoneFlash, parsePayload } from "../src/instagram/util/validate.js";

/** Shape observed in production `scheduled_posts.payload_json` for beat_writer_milestone_flash. */
const prodLike = {
  headline: "**haythumb** sets a new season high with 42 points.",
  match_id: "c57e0c2c-126f-454d-887d-c8dd04eee098",
  article_type: "milestone_flash",
};

test("accepts production payload_json (headline + match_id + article_type, no writer)", () => {
  const p = parseBeatWriterMilestoneFlash(prodLike);
  assert.equal(p.writer_name, "");
  assert.equal(p.milestone_headline, "haythumb sets a new season high with 42 points.");
  assert.equal(p.match_id, prodLike.match_id);
});

test("parsePayload dispatches beat_writer_milestone_flash", () => {
  const data = parsePayload("beat_writer_milestone_flash", prodLike);
  assert.match((data as { milestone_headline: string }).milestone_headline, /haythumb/);
});

test("still accepts explicit writer + milestone aliases", () => {
  const p = parseBeatWriterMilestoneFlash({
    beat_writer_name: "Alex",
    milestone_headline: "Record night",
  });
  assert.equal(p.writer_name, "Alex");
  assert.equal(p.milestone_headline, "Record night");
});
