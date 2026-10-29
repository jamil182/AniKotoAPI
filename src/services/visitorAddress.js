import { BlockList, isIP } from 'node:net';

// Source: https://www.cloudflare.com/ips-v4 and /ips-v6 (2026-10-30).
const cloudflare = new BlockList();
for (const cidr of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32',
  '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [address, prefix] = cidr.split('/');
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
const privateNetworks = new BlockList();
for (const cidr of ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '192.0.0.0/24',
  '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/3', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32']) {
  const [address, prefix] = cidr.split('/');
  privateNetworks.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/** @param {unknown} value @returns {string | null} */
export function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  const address = value.toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
  return isIP(address) ? address : null;
}

/** @param {string} ip */
export function isPublicIp(ip) {
  const family = isIP(ip);
  return Boolean(family) && !privateNetworks.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/** Only trust Cloudflare headers when Express has verified the upstream hop.
 * @param {import('express').Request} req
 */
export function visitorAddress(req) {
  const upstream = normalizeIp(req.ip);
  if (!upstream) return null;
  const trusted = cloudflare.check(upstream, isIP(upstream) === 6 ? 'ipv6' : 'ipv4');
  return trusted ? normalizeIp(req.get('cf-connecting-ip')) || upstream : upstream;
}
