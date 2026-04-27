// iPhone / Mac sing-box 1.14：WireGuard 回家 + 防 DNS 泄露稳定版 v3

console.log('🚀 开始生成 WG 防泄露配置 v3')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config = parser.parse($content ?? $files[0])

function env(name, fallback = undefined) {
  const v = process?.env?.[name]
  if (v === undefined || v === null || String(v).trim() === '') return fallback
  return String(v).trim()
}

function envNumber(name, fallback = undefined) {
  const raw = env(name, fallback === undefined ? undefined : String(fallback))
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是数字，当前值=${raw}`)
  return n
}

function envList(name, fallback) {
  return env(name, fallback).split(',').map(s => s.trim()).filter(Boolean)
}

function requireEnv(names) {
  const missing = names.filter(n => !env(n))
  if (missing.length) throw new Error(`.env 缺少变量：${missing.join(', ')}`)
}

function isDomain(v) {
  if (!v) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return false
  if (v.includes(':')) return false
  return true
}

requireEnv([
  'WG_PRIVATE_KEY',
  'WG_PEER_ADDRESS',
  'WG_PEER_PORT',
  'WG_PEER_PUBLIC_KEY'
])

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!config.route) config.route = {}

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local'

if (!Array.isArray(config.http_clients)) config.http_clients = []
if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({ tag: 'direct' })
}

let proxies = url
  ? await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
      subscription: { name, url, source: 'remote' },
    })
  : await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
    })

const proxyTags = proxies.map(p => p.tag)
if (proxyTags.length === 0) throw new Error('没有获取到代理节点')

// 关键：代理节点本身的 server 域名用 local 解析，避免 proxy-dns -> Proxy -> 还要 DNS 的死循环
const proxyServerDomains = []

proxies = proxies.map(p => {
  if (isDomain(p.server)) {
    proxyServerDomains.push(p.server)
    return {
      ...p,
      domain_resolver: p.domain_resolver || 'local'
    }
  }
  return p
})

// 注入 WireGuard endpoint
const homeCIDRs = envList('WG_HOME_CIDRS', '192.168.1.0/24')

const wgEndpoint = {
  type: 'wireguard',
  tag: 'wg-home',
  system: false,
  address: envList('WG_ADDRESS', '10.14.0.6/32'),
  private_key: env('WG_PRIVATE_KEY'),
  mtu: envNumber('WG_MTU', 1420),
  peers: [
    {
      address: env('WG_PEER_ADDRESS'),
      port: envNumber('WG_PEER_PORT'),
      public_key: env('WG_PEER_PUBLIC_KEY'),
      allowed_ips: envList('WG_ALLOWED_IPS', '192.168.1.0/24'),
      persistent_keepalive_interval: envNumber('WG_KEEPALIVE', 25)
    }
  ]
}

let wgReplaced = false

config.endpoints = config.endpoints.map(e => {
  if (e?.tag === 'wg-home' || e?.tag === '__WG_HOME_PLACEHOLDER__') {
    wgReplaced = true
    return wgEndpoint
  }
  return e
})

if (!wgReplaced) {
  config.endpoints.unshift(wgEndpoint)
}

// 注入代理节点
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

// Proxy 组
let proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')

if (!proxyGroup) {
  proxyGroup = {
    type: 'selector',
    tag: 'Proxy',
    outbounds: [],
    default: proxyTags[0]
  }
  config.outbounds.unshift(proxyGroup)
}

proxyGroup.outbounds = [...proxyTags, 'direct']
proxyGroup.default = proxyTags[0]

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({ type: 'direct', tag: 'direct' })
}

// DNS：稳定防泄露策略
if (!config.dns) config.dns = {}

config.dns.servers = [
  {
    tag: 'local',
    type: 'udp',
    server: '223.5.5.5'
  },
  {
    tag: 'home-dns',
    type: 'udp',
    server: '192.168.1.118',
    detour: 'wg-home'
  },
  {
    tag: 'proxy-dns',
    type: 'tls',
    server: '8.8.8.8',
    detour: 'Proxy'
  }
]

config.dns.rules = []

// 代理服务器域名必须先用 local 解开，否则 proxy-dns 会死循环
if (proxyServerDomains.length > 0) {
  config.dns.rules.push({
    domain: [...new Set(proxyServerDomains)],
    action: 'route',
    server: 'local',
    strategy: 'ipv4_only'
  })
}

// 启动下载相关域名走 local
config.dns.rules.push({
  domain_suffix: [
    'ghfast.top',
    'raw.githubusercontent.com',
    'github.com',
    'gh-proxy.com',
    'ghproxy.net',
    'testingcf.jsdelivr.net',
    'cdn.jsdelivr.net'
  ],
  action: 'route',
  server: 'local',
  strategy: 'ipv4_only'
})

// 家里内网走 home-dns
config.dns.rules.push({
  ip_cidr: homeCIDRs,
  action: 'route',
  server: 'home-dns'
})

config.dns.final = 'proxy-dns'
config.dns.strategy = 'ipv4_only'
delete config.dns.reverse_mapping

// WG 回家路由
if (!Array.isArray(config.route.rules)) config.route.rules = []

config.route.rules = config.route.rules.map(r => {
  if (r?.outbound === 'wg-home') {
    return { ...r, ip_cidr: homeCIDRs }
  }
  return r
})

if (!config.route.rules.some(r => r?.outbound === 'wg-home')) {
  config.route.rules.splice(3, 0, {
    ip_cidr: homeCIDRs,
    outbound: 'wg-home'
  })
}

// 清理 rule-set
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/',
          'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/'
        )
        .replace(
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
        )
    }

    delete rs.download_detour
    delete rs.http_client
    return rs
  })
}

if (!config.endpoints.some(e => e?.tag === 'wg-home' && e?.type === 'wireguard')) {
  throw new Error('最终配置缺少 wireguard endpoint: wg-home')
}

if (proxyGroup.outbounds.includes('wg-home')) {
  throw new Error('Proxy 组不应包含 wg-home')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WG 防泄露配置生成 v3')
