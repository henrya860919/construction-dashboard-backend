import os from 'node:os'

/**
 * 取得本機對外區域網 IPv4 位址（排除 loopback / internal）。
 * 用於啟動時顯示 Network 存取網址（例如 http://192.168.x.x:3003）。
 */
export function getNetworkIPs(): string[] {
  const interfaces = os.networkInterfaces()
  const ips: string[] = []
  for (const _name of Object.keys(interfaces)) {
    const addresses = interfaces[_name]
    if (addresses) {
      for (const address of addresses) {
        const family = address.family
        const isIPv4 = family === 'IPv4' || (typeof family === 'number' && family === 4)
        if (isIPv4 && !address.internal) {
          ips.push(address.address)
        }
      }
    }
  }
  return [...new Set(ips)]
}
