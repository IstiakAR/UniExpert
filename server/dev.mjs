import { spawn } from 'node:child_process'

// Runs the API and the Vite dev server together so `npm run dev:all` boots both.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const children = [
  spawn('node', ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'dev'], { stdio: 'inherit' }),
]

let closing = false
function shutdown(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown())
process.on('SIGTERM', () => shutdown())
for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 0))
}
