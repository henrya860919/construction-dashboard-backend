import 'dotenv/config'
import { app } from './app.js'
import { getNetworkIPs } from './utils/network.js'

const PORT = process.env.PORT ?? 3003
const HOST = process.env.HOST ?? '0.0.0.0'

app.listen(Number(PORT), HOST, () => {
  const networkIPs = getNetworkIPs()
  console.log('\n🚀 Server is running!')
  console.log('📍 Access URLs:')
  console.log(`   Local:    http://localhost:${PORT}`)
  console.log(`   Local:    http://127.0.0.1:${PORT}`)
  for (const ip of networkIPs) {
    console.log(`   Network:  http://${ip}:${PORT}`)
  }
  console.log('')
})
