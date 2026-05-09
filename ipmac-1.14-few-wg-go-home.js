// iPhone / Mac sing-box 1.14-alpha.21：WireGuard endpoint 回家 + 代理节点订阅注入（增强稳定版）

console.log('🚀 开始生成 WireGuard 回家配置')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

function env(name, fallback = undefined) {
  const v = process?.env?.[name]
  if (v === undefined || v === null || String(v).trim() === '') return fallback
  return String(v).trim()
}

function envNumber(name, fallback = undefined) {
  const raw = env(name, fallback === undefined ? undefined : String(fallback))
  const n = Number(raw)

  if (!Number.isFinite(n)) {
    throw new Error(`${name} 必须是数字，当前值=${raw}`)
  }

  return n
}

function envList(name, fallback) {
  return env(name, fallback)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function requireEnv(names) {
  const missing = names.filter(n => !env(n))

  if (missing.length) {
    throw new Error(`.env 缺少变量：${missing.join(', ')}`)
  }
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

if (!config.route) config.route = {}
if (!config.dns) config.dns = {}

if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []

// =========================
// alpha.21 DNS 增强
// =========================

config.dns.timeout = '3s'
config.dns.strategy = 'ipv4_only'

if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({
    tag: 'direct'
  })
}

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'

// tun-in 增强
if (Array.isArray(config.inbounds)) {
  config.inbounds = config.inbounds.map(i => {
    if (i?.type === 'tun' && i?.tag === 'tun-in') {
      return {
        ...i,
        dns_mode: 'hijack',
        dns_address: '172.19.0.2'
      }
    }

    return i
  })
}

// DNS servers 修正
if (Array.isArray(config.dns?.servers)) {
  config.dns.servers = config.dns.servers.map(s => {

    // proxy-dns 永远走 Proxy 组
    if (s?.tag === 'proxy-dns') {
      return {
        ...s,
        detour: 'Proxy'
      }
    }

    // home-dns 永远走 wg-home
    if (s?.tag === 'home-dns') {
      return {
        ...s,
        detour: 'wg-home'
      }
    }

    return s
  })
}

// DNS rules 增强：减少 HTTPS/SVCB/PTR 噪音
if (Array.isArray(config.dns?.rules)) {

  const hasRejectRule = config.dns.rules.some(r =>
    JSON.stringify(r?.query_type || []) ===
    JSON.stringify(['SVCB', 'HTTPS', 'PTR'])
  )

  if (!hasRejectRule) {
    config.dns.rules.splice(1, 0, {
      query_type: [
        'SVCB',
        'HTTPS',
        'PTR'
      ],
      action: 'reject'
    })
  }
}

// =========================
// 获取代理节点
// =========================

let proxies

if (url) {

  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
    subscription: {
      name,
      url,
      source: 'remote',
    },
  })

} else {

  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })

}

const proxyTags = proxies.map(p => p.tag)

if (proxyTags.length === 0) {
  throw new Error('没有获取到代理节点，无法生成 Proxy 组')
}

// =========================
// 注入 WireGuard
// =========================

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

      allowed_ips: envList(
        'WG_ALLOWED_IPS',
        '192.168.1.0/24'
      ),

      persistent_keepalive_interval: envNumber(
        'WG_KEEPALIVE',
        25
      )
    }
  ]
}

let wgReplaced = false

config.endpoints = config.endpoints.map(e => {

  if (
    e?.tag === 'wg-home' ||
    e?.tag === '__WG_HOME_PLACEHOLDER__'
  ) {

    wgReplaced = true
    return wgEndpoint
  }

  return e
})

if (!wgReplaced) {
  config.endpoints.unshift(wgEndpoint)
}

// =========================
// 注入代理节点
// =========================

config.outbounds = config.outbounds.filter(o => {

  if (!o?.tag) return true

  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true

  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

// =========================
// 修复 Proxy 组
// =========================

let proxyGroup = config.outbounds.find(
  o =>
    o?.tag === 'Proxy' &&
    o?.type === 'selector'
)

if (!proxyGroup) {

  proxyGroup = {
    type: 'selector',
    tag: 'Proxy',
    outbounds: [],
    default: proxyTags[0]
  }

  config.outbounds.unshift(proxyGroup)
}

proxyGroup.outbounds = [
  ...proxyTags,
  'direct'
]

proxyGroup.default = proxyTags[0]

// 确保 direct 存在
if (!config.outbounds.some(o => o?.tag === 'direct')) {

  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// =========================
// WG 路由
// =========================

if (!Array.isArray(config.route.rules)) {
  config.route.rules = []
}

const homeCIDRs = envList(
  'WG_HOME_CIDRS',
  '192.168.1.0/24'
)

const has
