import { generateImageImagen } from './imagenClient.js'

const IMAGE_PROVIDER_OPENAI = 'openai'
const IMAGE_PROVIDER_GEMINI = 'gemini'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-image-1'
const DEFAULT_SIZE = '1024x1536'
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2

interface ImagesGenerationsResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  error?: { message?: string }
}

function getImageProvider(): 'openai' | 'gemini' {
  const v = process.env.AI_IMAGE_PROVIDER?.toLowerCase().trim()
  if (v === IMAGE_PROVIDER_GEMINI) return 'gemini'
  return IMAGE_PROVIDER_OPENAI
}

/** Dispatch to OpenAI Images or Imagen (Gemini) per AI_IMAGE_PROVIDER. Returns PNG bytes. */
export async function generateImage(prompt: string): Promise<Buffer> {
  const provider = getImageProvider()
  if (provider === IMAGE_PROVIDER_GEMINI) {
    return generateImageImagen(prompt)
  }
  return generateImageOpenAI(prompt)
}

async function generateImageOpenAI(prompt: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY must be set for image generation')
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const model = process.env.OPENAI_IMAGE_MODEL ?? DEFAULT_MODEL
  const size = process.env.OPENAI_IMAGE_SIZE ?? DEFAULT_SIZE
  const quality = process.env.OPENAI_IMAGE_QUALITY

  const url = `${baseUrl}/images/generations`
  const body: Record<string, unknown> = {
    model,
    prompt,
    size,
    /** Without this, OpenAI often returns `url` only and we would fail on b64_json. */
    response_format: 'b64_json',
  }
  if (quality) body.quality = quality

  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const data = (await response.json()) as ImagesGenerationsResponse
      if (data.error?.message) {
        throw new Error(`OpenAI Images API: ${data.error.message}`)
      }
      if (!response.ok) {
        throw new Error(`OpenAI Images API ${response.status}: ${JSON.stringify(data)}`)
      }
      const first = data.data?.[0]
      const b64 = first?.b64_json
      if (b64) {
        return Buffer.from(b64, 'base64')
      }
      const imageUrl = first?.url
      if (imageUrl) {
        const imgRes = await fetch(imageUrl)
        if (!imgRes.ok) {
          throw new Error(
            `OpenAI returned image URL but download failed: HTTP ${imgRes.status}`
          )
        }
        return Buffer.from(await imgRes.arrayBuffer())
      }
      throw new Error(
        'OpenAI Images API: response had no b64_json or url in data[0]'
      )
    } catch (err) {
      lastErr = err
      if (attempt === MAX_RETRIES) break
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastErr
}
