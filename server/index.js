import { createApp } from './app.js'
import { config } from './config.js'
import { seed } from './db.js'

if (config.seedDemoData) seed()

const app = createApp()

app.listen(config.port, () => {
  console.log(`UniExpert API listening on http://localhost:${config.port}`)
})
