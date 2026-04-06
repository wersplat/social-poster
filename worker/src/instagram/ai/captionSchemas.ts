import { z } from "zod";

export const CaptionSchema = z.object({
  caption: z.string().max(2200),
  hashtags: z
    .array(z.string().trim().min(1))
    .min(5)
    .max(12)
    .refine((tags) => tags.every((t) => t.startsWith("#")), {
      message: "All hashtags must start with '#'",
    }),
  alt_text: z.string().max(1000),
  cta: z.string().max(160).nullable(),
  tone: z.enum(["pro", "hype", "minimal"]),
  emoji_level: z.enum(["none", "light", "heavy"]),
  variants: z
    .object({
      minimal: z.string(),
      hype: z.string(),
      sponsor_safe: z.string(),
    })
    .nullable()
    .optional(),
});

export type CaptionResult = z.infer<typeof CaptionSchema>;

export function buildCaptionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      caption: { type: "string", maxLength: 2200 },
      hashtags: {
        type: "array",
        minItems: 5,
        maxItems: 12,
        items: {
          type: "string",
          pattern: "^#\\S+$",
        },
      },
      alt_text: { type: "string", maxLength: 1000 },
      cta: { type: ["string", "null"], maxLength: 160 },
      tone: { type: "string", enum: ["pro", "hype", "minimal"] },
      emoji_level: { type: "string", enum: ["none", "light", "heavy"] },
      variants: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              minimal: { type: "string" },
              hype: { type: "string" },
              sponsor_safe: { type: "string" },
            },
            required: ["minimal", "hype", "sponsor_safe"],
          },
        ],
      },
    },
    required: ["caption", "hashtags", "alt_text", "cta", "tone", "emoji_level", "variants"],
  } as const;
}

/**
 * Schema for Gemini API only. REST API rejects additionalProperties and type arrays;
 * use anyOf for nullable and omit additionalProperties.
 */
export function buildCaptionJsonSchemaForGemini(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      caption: { type: "string", maxLength: 2200 },
      hashtags: {
        type: "array",
        minItems: 5,
        maxItems: 12,
        items: { type: "string", pattern: "^#\\S+$" },
      },
      alt_text: { type: "string", maxLength: 1000 },
      cta: {
        anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }],
      },
      tone: { type: "string", enum: ["pro", "hype", "minimal"] },
      emoji_level: { type: "string", enum: ["none", "light", "heavy"] },
      variants: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            properties: {
              minimal: { type: "string" },
              hype: { type: "string" },
              sponsor_safe: { type: "string" },
            },
            required: ["minimal", "hype", "sponsor_safe"],
          },
        ],
      },
    },
    required: ["caption", "hashtags", "alt_text", "cta", "tone", "emoji_level", "variants"],
  };
}
