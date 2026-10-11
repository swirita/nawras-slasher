import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import config from '../vite.config.js'
import { REQUIRED_ASSETS } from '../src/catalog.js'

test('Vite uses the repository subpath for build and preview, and root for development', () => {
  const previous = process.env.VITE_BASE_PATH
  delete process.env.VITE_BASE_PATH
  try {
    assert.equal(config({ command: 'build' }).base, '/nawras-slasher/')
    assert.equal(config({ command: 'serve', isPreview: true }).base, '/nawras-slasher/')
    assert.equal(config({ command: 'serve', isPreview: false }).base, '/')
    process.env.VITE_BASE_PATH = '/another-repository/'
    assert.equal(config({ command: 'build' }).base, '/another-repository/')
  } finally {
    if (previous === undefined) delete process.env.VITE_BASE_PATH
    else process.env.VITE_BASE_PATH = previous
  }
})
test('all catalog assets and hand model exist and resolve under root and repository bases', () => {
  const paths = [...REQUIRED_ASSETS.map(({ asset }) => asset), 'models/hand_landmarker.task']
  for (const base of ['/', '/nawras-slasher/']) for (const path of paths) {
    assert.equal(path.startsWith('/'), false)
    assert.equal((base + path).includes('//'), false)
    assert.equal(new URL(base + path, 'https://example.github.io').pathname, base + path)
    assert.ok(existsSync(new URL(`../public/${path}`, import.meta.url)), path)
  }
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(main, /const MODEL_URL = `\$\{import\.meta\.env\.BASE_URL\}models\/hand_landmarker\.task`/)
  assert.match(main, /preloadImage\(`\$\{import\.meta\.env\.BASE_URL\}\$\{asset\}`\)/)
  assert.match(main, /WASM_ROOT = 'https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@1\.0\.1\/wasm'/)
})

test('Pages workflow validates PRs without deploying and publishes only main with the repository base', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8')
  assert.match(workflow, /pull_request:\s*branches: \[main\]/)
  assert.match(workflow, /VITE_BASE_PATH: \/nawras-slasher\//)
  assert.match(workflow, /run: npm ci/)
  assert.match(workflow, /run: npm test/)
  assert.match(workflow, /run: npm run build/)
  assert.match(workflow, /actions\/upload-pages-artifact@v4[\s\S]*?path: dist/)
  assert.match(workflow, /deploy:\s*if: github.event_name != 'pull_request' && github.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /needs: build/)
  assert.match(workflow, /pages: write/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /name: github-pages/)
  const inference = readFileSync(new URL('../src/inference.js', import.meta.url), 'utf8')
  assert.match(inference, /new Worker\(new URL\('\.\/inference-worker\.js', import.meta.url\), \{ type: 'module' \}\)/)
})
