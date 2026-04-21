import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBgPrompt } from '../src/ai/bgPrompts.js'
import { announcementBackgroundRules, buildAnnouncementAiScene } from '../src/announcements/templates.js'

test('announcement registration bg prompt avoids plate/corkboard scaffolding', () => {
  const prompt = buildBgPrompt({
    postType: 'announcement_registration',
    stylePack: 'regular',
    payload: { vibe: 'esports_2k' },
  })
  const lower = prompt.toLowerCase()
  assert.ok(!lower.includes('background plate'), 'should not use "background plate" wording')
  assert.ok(!lower.includes('corkboard'), 'should not reference corkboard')
  assert.ok(lower.startsWith('wide cinematic indoor basketball arena'), 'expected lead-in')
  assert.ok(prompt.includes('Never paint words'), 'anti-garbage-text clause present')
  assert.ok(prompt.includes('HEADLINE'), 'explicit HEADLINE ban present')
})

test('announcementBackgroundRules forbids placeholder UI words', () => {
  const rules = announcementBackgroundRules()
  assert.match(rules, /MOCKUP|TEMPLATE/)
  assert.match(rules, /HEADLINE/)
})

test('registration scene is arena-first (no corkboard poster)', () => {
  const scene = buildAnnouncementAiScene('registration', 'esports_2k')
  assert.ok(!scene.toLowerCase().includes('corkboard'))
  assert.ok(!scene.toLowerCase().includes('cork board'))
  assert.ok(scene.toLowerCase().includes('arena'))
})
