import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionJsonSchema } from "../src/instagram/ai/captionSchemas.js";

test("buildCaptionJsonSchema returns a schema usable by Gemini (type object, properties, required)", () => {
  const schema = buildCaptionJsonSchema();
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(Array.isArray(schema.required));
  const required = schema.required as string[];
  assert.ok(required.includes("caption"));
  assert.ok(required.includes("hashtags"));
  assert.ok(required.includes("alt_text"));
  assert.ok(required.includes("cta"));
  assert.ok(required.includes("tone"));
  assert.ok(required.includes("emoji_level"));
  assert.ok(required.includes("variants"));
  assert.ok(schema.properties && typeof schema.properties === "object");
  const props = schema.properties as Record<string, unknown>;
  assert.ok("caption" in props);
  assert.ok("hashtags" in props);
  assert.ok("tone" in props);
  assert.ok("emoji_level" in props);
});
