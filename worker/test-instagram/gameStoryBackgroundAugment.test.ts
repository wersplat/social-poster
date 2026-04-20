import test from "node:test";
import assert from "node:assert/strict";
import {
  augmentBackgroundPromptWithGameStory,
  computeGameStoryHashSuffix,
  isAugmentEnabled,
  isGameStoryPostType,
} from "../src/ai/gameStoryBackgroundAugment.js";
import { getBackgroundCacheKey } from "../src/instagram/ai/generateBackground.js";

const ORIGINAL_FETCH = globalThis.fetch;

function setEnv(vars: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function mockFetchOnce(response: { ok: boolean; status?: number; json: unknown }) {
  globalThis.fetch = (async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.json,
  })) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

function geminiResponse(body: { sentiment: string; keywords: string[]; visual_addendum: string }) {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(body) }] },
        finishReason: "STOP",
      },
    ],
  };
}

test("isGameStoryPostType only accepts final_score and player_of_game", () => {
  assert.equal(isGameStoryPostType("final_score"), true);
  assert.equal(isGameStoryPostType("player_of_game"), true);
  assert.equal(isGameStoryPostType("weekly_power_rankings"), false);
  assert.equal(isGameStoryPostType("announcement_registration"), false);
});

test("computeGameStoryHashSuffix is stable and changes with the story", () => {
  const a = computeGameStoryHashSuffix("The Legends held off the Knights in a tight overtime.");
  const b = computeGameStoryHashSuffix("The Legends held off the Knights in a tight overtime.");
  const c = computeGameStoryHashSuffix("The Knights blew out the Legends by 40.");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 12);
});

test("isAugmentEnabled honors GAME_STORY_BG_AUGMENT=false", () => {
  const restore = setEnv({
    GEMINI_API_KEY: "test-key",
    GAME_STORY_BG_AUGMENT: "false",
  });
  try {
    assert.equal(isAugmentEnabled(), false);
  } finally {
    restore();
  }
});

test("isAugmentEnabled is true when GEMINI_API_KEY is set and flag is default", () => {
  const restore = setEnv({
    GEMINI_API_KEY: "test-key",
    GAME_STORY_BG_AUGMENT: undefined,
  });
  try {
    assert.equal(isAugmentEnabled(), true);
  } finally {
    restore();
  }
});

test("augmentBackgroundPromptWithGameStory returns base prompt when augmentation is disabled", async () => {
  const restore = setEnv({
    GEMINI_API_KEY: undefined,
    GAME_STORY_BG_AUGMENT: "false",
  });
  try {
    const base = "Base scene prompt.";
    const result = await augmentBackgroundPromptWithGameStory({
      basePrompt: base,
      gameStory: "A thrilling comeback win.",
      postType: "final_score",
    });
    assert.equal(result.finalPrompt, base);
    assert.equal(result.meta, null);
    assert.equal(result.storyHashSuffix, null);
  } finally {
    restore();
  }
});

test("augmentBackgroundPromptWithGameStory appends addendum on Gemini success", async () => {
  const restore = setEnv({
    GEMINI_API_KEY: "test-key",
    GAME_STORY_BG_AUGMENT: "true",
  });
  mockFetchOnce({
    ok: true,
    json: geminiResponse({
      sentiment: "gritty comeback",
      keywords: ["storm clouds", "warm rim light", "tense stillness"],
      visual_addendum:
        "Heighten atmospheric tension with a slow, heavy haze and a single warm rim light grazing the far wall.",
    }),
  });
  try {
    const base = "Base scene prompt for the match.";
    const result = await augmentBackgroundPromptWithGameStory({
      basePrompt: base,
      gameStory:
        "Down 12 in the fourth, the Legends clawed back behind relentless defense and a buzzer-beating three.",
      postType: "final_score",
    });
    assert.ok(result.finalPrompt.startsWith(base));
    assert.ok(result.finalPrompt.includes("gritty comeback"));
    assert.ok(result.finalPrompt.includes("warm rim light"));
    assert.ok(result.meta);
    assert.equal(result.meta?.sentiment, "gritty comeback");
    assert.equal(result.meta?.keywords.length, 3);
    assert.ok(result.storyHashSuffix && result.storyHashSuffix.length === 12);
  } finally {
    restoreFetch();
    restore();
  }
});

test("augmentBackgroundPromptWithGameStory falls back to base prompt when Gemini errors", async () => {
  const restore = setEnv({
    GEMINI_API_KEY: "test-key",
    GAME_STORY_BG_AUGMENT: "true",
  });
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  try {
    const base = "Base scene prompt.";
    const result = await augmentBackgroundPromptWithGameStory({
      basePrompt: base,
      gameStory: "Back-and-forth thriller ending on a last-second block.",
      postType: "player_of_game",
    });
    assert.equal(result.finalPrompt, base);
    assert.equal(result.meta, null);
    assert.equal(result.storyHashSuffix, null);
  } finally {
    restoreFetch();
    restore();
  }
});

test("augmentBackgroundPromptWithGameStory returns base prompt when no story is provided", async () => {
  const restore = setEnv({
    GEMINI_API_KEY: "test-key",
    GAME_STORY_BG_AUGMENT: "true",
  });
  try {
    const base = "Base scene prompt.";
    const result = await augmentBackgroundPromptWithGameStory({
      basePrompt: base,
      gameStory: null,
      postType: "final_score",
    });
    assert.equal(result.finalPrompt, base);
    assert.equal(result.storyHashSuffix, null);
  } finally {
    restore();
  }
});

test("getBackgroundCacheKey produces a different key when story hash suffix is provided", () => {
  const payload = { match_id: "match-123" };
  const base = getBackgroundCacheKey("final_score", "regular", 1, payload);
  const withSuffix = getBackgroundCacheKey("final_score", "regular", 1, payload, "abc123def456");
  const withDifferentSuffix = getBackgroundCacheKey(
    "final_score",
    "regular",
    1,
    payload,
    "ffffffffffff"
  );
  assert.notEqual(base, withSuffix);
  assert.notEqual(withSuffix, withDifferentSuffix);
});

test("getBackgroundCacheKey separates superhero POG plates from regular POG backgrounds", () => {
  const payload = { match_id: "match-xyz" };
  const regularPog = getBackgroundCacheKey("player_of_game", "regular", 1, payload, null, null, false);
  const superheroPog = getBackgroundCacheKey("player_of_game", "regular", 1, payload, null, null, true);
  assert.notEqual(regularPog, superheroPog);
});
