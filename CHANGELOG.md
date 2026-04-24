# Changelog

All notable changes to [social-poster](https://github.com/wersplat/social-poster) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as reflected in [`worker/package.json`](./worker/package.json).

---

## [Unreleased]

Nothing unreleased yet.

---

## [1.0.0] — 2026-04-23

Cumulative notes from repository inception through the latest documented worker release (`social-publisher` **1.0.0**). Individual commits are listed in **Git history (non-merge)** below for traceability.

### Added

- **Social publisher worker** — polling Supabase `scheduled_posts`, optimistic claiming, platform routing, caption building from matches / player stats, optional **game card** images (Satori + Resvg), optional **AI backgrounds** (OpenAI Images / Google Imagen) for supported post kinds, R2 upload, X (Twitter) posting, and status retries (`Add social publisher worker with platform routing`).
- **League announcements** — announcement flows, templates, and related AI image generation paths (`Implement league announcement features…`, `Enhance announcement features and UI for playoffs, champion, awards, and schedule`).
- **Game story background augmentation** — story-driven AI backgrounds with Gemini, improved response handling, higher default max output tokens (2048), and optional thinking configuration (`Enhance AI background generation with game story augmentation`, follow-up commits on 2026-04-17).
- **Superhero-themed `player_of_game` graphics** — themed art, prompts, caption integration, cache keys, and rendering templates (series of commits 2026-04-18 — 2026-04-20).
- **Registration captions** — registration caption generation, richer scene descriptions, and anti-ribbon rules for announcement imagery (`Implement registration caption generation…`, `Enhance registration scene descriptions…`).
- **Static Instagram templates** — static template support, poller-side generation logic, and related rendering (`Enhance static template support and rendering logic for Instagram posts`, `Enhance static template generation logic in poller`).

### Changed

- **Project docs and configuration** — README and environment variable documentation expanded; project configuration updates (`Update project configuration and improve environment variable documentation`, `Enhance README and update environment variable documentation`, `Refactor Instagram pipeline and enhance README documentation`).
- **Session / stats metadata** — `statistics.json` `last_updated` timestamps aligned (`Update last_updated timestamps in statistics.json for consistency`); session statistics and README refreshed multiple times through March–April 2026.
- **Admin and AI UX** — AI image generation behavior and admin UI improvements (`Enhance functionality and documentation for AI image generation and admin UI`).
- **Instagram pipeline** — refactor of the Instagram pipeline; additional post types and behavior (`Refactor Instagram pipeline…`, `Enhance Instagram post types and update related functionality`).
- **Power rankings** — session statistics and power rankings query enhancements (`Update session statistics and enhance power rankings queries`).
- **Card layout** — card generation styles refactored for layout consistency (`Refactor card generation styles for improved layout consistency`).
- **Imagen / augmentation defaults** — Gemini and Imagen model versions and parameters updated; default aspect ratio unified in `imagenClient` (`Update Gemini model version…`, `Update AI model versions and parameters in gameStoryBackgroundAugment and imagenClient`, `Update default aspect ratio in imagenClient for consistency across implementations`).
- **Announcement overlays and Instagram processing** — announcement overlay styles, graphics, and Instagram-specific processing (`Update test scripts and enhance announcement overlay styles`, `Enhance announcement graphics and processing for Instagram posts`).
- **Scheduled post fetching** — post-fetching helpers updated to filter Instagram scheduled rows (`Refactor post fetching functions to filter Instagram scheduled rows`).
- **Fonts in card generator** — font loading logic improved (`Enhance font loading logic in card generator`).
- **OpenAI** — model version bumps in configuration and client code (`Update OpenAI model version in configuration and client files`).

### Fixed

- **Game story augmentation** — more defensive JSON parsing and schema handling for edge-case model output (`Enhance JSON parsing in gameStoryBackgroundAugment.ts to handle edge cases`, `Remove additionalProperties constraint from AUGMENT_SCHEMA…`).

### Git history (non-merge, chronological)

| Date (committer) | Subject |
|------------------|---------|
| 2026-03-20 | init |
| 2026-03-20 | Add social publisher worker with platform routing |
| 2026-03-20 | Update project configuration and improve environment variable documentation |
| 2026-03-20 | Enhance README and update environment variable documentation |
| 2026-03-20 | Update last_updated timestamps in statistics.json for consistency |
| 2026-03-20 | Enhance functionality and documentation for AI image generation and admin UI |
| 2026-03-21 | Implement league announcement features and enhance AI image generation |
| 2026-03-21 | Update session statistics and refine README documentation |
| 2026-03-21 | Enhance announcement features and UI for playoffs, champion, awards, and schedule |
| 2026-04-06 | Refactor Instagram pipeline and enhance README documentation |
| 2026-04-09 | Enhance Instagram post types and update related functionality |
| 2026-04-15 | Update session statistics and enhance power rankings queries |
| 2026-04-17 | Enhance AI background generation with game story augmentation |
| 2026-04-17 | Refactor card generation styles for improved layout consistency |
| 2026-04-17 | Remove additionalProperties constraint from AUGMENT_SCHEMA in gameStoryBackgroundAugment.ts for improved schema flexibility |
| 2026-04-17 | Update Gemini model version and enhance response handling in background augmentation |
| 2026-04-17 | Enhance JSON parsing in gameStoryBackgroundAugment.ts to handle edge cases |
| 2026-04-17 | Increase default maximum output tokens in gameStoryBackgroundAugment.ts from 512 to 2048 for enhanced response capacity. Added a thinking configuration to the augmentation call to optimize processing |
| 2026-04-18 | Add superhero-themed graphics for player_of_game posts |
| 2026-04-19 | Refactor superhero graphics implementation for player_of_game posts |
| 2026-04-20 | Refine superhero art prompt and update cache key for player_of_game posts |
| 2026-04-20 | Enhance superhero graphics for player_of_game posts with caption integration |
| 2026-04-20 | Update test scripts and enhance caption processing for player_of_game posts |
| 2026-04-20 | Enhance superhero graphics and caption integration for player_of_game posts |
| 2026-04-20 | Refine superhero prompt and rendering templates for player_of_game posts |
| 2026-04-20 | Update AI model versions and parameters in gameStoryBackgroundAugment and imagenClient |
| 2026-04-20 | Update default aspect ratio in imagenClient for consistency across implementations |
| 2026-04-21 | Update test scripts and enhance announcement overlay styles |
| 2026-04-21 | Enhance announcement graphics and processing for Instagram posts |
| 2026-04-21 | Implement registration caption generation and enhance announcement templates |
| 2026-04-21 | Enhance registration scene descriptions and add anti-ribbon rules |
| 2026-04-21 | Enhance static template support and rendering logic for Instagram posts |
| 2026-04-21 | Refactor post fetching functions to filter Instagram scheduled rows |
| 2026-04-21 | Enhance font loading logic in card generator |
| 2026-04-21 | Enhance static template generation logic in poller |
| 2026-04-23 | Update OpenAI model version in configuration and client files |

**Merge commit (excluded above):** `Add social media publisher worker for scheduled posts` — integration merge for the social publisher worker branch.

---

[Unreleased]: https://github.com/wersplat/social-poster/compare/6dea9be2d3557ad6bd5bf79257d08d6663966a1a...HEAD
[1.0.0]: https://github.com/wersplat/social-poster/compare/593e87de23f37c844c37010c321dde58fe033218...6dea9be2d3557ad6bd5bf79257d08d6663966a1a
