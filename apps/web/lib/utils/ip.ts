import { createHash } from 'crypto'

/** Hash an IP address for storage. Never store raw IPs. */
export function getIpHash(ip: string): string {
  if (!ip) return ''
  return createHash('sha256').update(ip.trim().split(',')[0]).digest('hex').slice(0, 32)
}
