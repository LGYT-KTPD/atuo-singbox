// iPhone / Mac sing-box 1.14-alpha.21：WireGuard endpoint 回家 + 机场多分组节点注入（增强稳定版）

console.log('🚀 开始生成 WG 多分组回家配置')

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments
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

function createTagRegExp(tagPattern) {
  return new RegExp(
    tagPattern.replace('ℹ️', ''),
    tagPattern.includes('ℹ️') ? 'i' : undefined
  )
}

function createOutboundRegExp(outboundPattern) {
  return new RegExp(
    outboundPattern.replace('ℹ️', ''),
    outboundPattern.includes('ℹ️') ? 'i' : undefined
  )
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

if (!config.dns) config.dns = {}
if (!config.route) config.route = {}
if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []

// alpha.21 基础增强
config.dns.timeout = '3s'
config.dns.strategy = 'ipv4_only'

config.http_clients = config.http_clients.filter(c => c?.tag !== 'direct')
config.http_clients.unshift({ tag: 'direct' })

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'

// tun-in 使用 alpha.21 dns_mode / dns_address
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
if (Array.isArray(config.dns.servers)) {
  config.dns.servers = config.dns.servers.map(s => {
    if (s?.tag === 'local') {
      return { ...s, tag: 'local-dns' }
    }

    if (s?.tag === 'google' || s?.tag === 'proxy-dns') {
      return { ...s, detour: 'Proxy' }
    }

    if (s?.tag === 'home-dns') {
      return { ...s, detour: 'wg-home' }
    }

    if (s?.tag === 'public' && s?.domain_resolver === 'local') {
      return { ...s, domain_resolver: 'local-dns' }
    }

    return s
  })
}

// DNS rules 修正
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

// 删除 DNS rules 里废弃的单条 strategy
config.dns.rules = config.dns.rules.map(r => {
  if (r?.strategy) {
    const { strategy, ...rest } = r
    return rest
  }
  return r
})

// 新版 1.14：dns.rules 里的 ip_cidr 是响应匹配字段，没有 match_response=true 会报错
config.dns.rules = config.dns.rules.filter(r => {
  if (r?.ip_cidr && !r?.match_response) return false
  return true
})

// server: local 统一改 local-dns
config.dns.rules = config.dns.rules.map(r => {
  if (r?.server === 'local') {
    return { ...r, server: 'local-dns' }
  }
  return r
})

// 内网域名走 home-dns
const hasHomeDomainRule = config.dns.rules.some(r =>
  Array.isArray(r?.domain_suffix) &&
  r.domain_suffix.includes('ktpd.fun') &&
  r.server === 'home-dns'
)

if (!hasHomeDomainRule) {
  config.dns.rules.unshift({
    domain_suffix: [
      'ktpd.fun',
      'xwcac68u.top'
    ],
    action: 'route',
    server: 'home-dns'
  })
}

// 减少 iOS/macOS HTTPS/SVCB/PTR 查询噪音
const hasRejectQtypeRule = config.dns.rules.some(r =>
  Array.isArray(r?.query_type) &&
  r.query_type.includes('SVCB') &&
  r.query_type.includes('HTTPS') &&
  r.query_type.includes('PTR') &&
  r.action === 'reject'
)

if (!hasRejectQtypeRule) {
  config.dns.rules.splice(1, 0, {
    query_type: [
      'SVCB',
      'HTTPS',
      'PTR'
    ],
    action: 'reject'
  })
}

// 获取代理节点
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

// 注入 WG endpoint
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

// 多分组注入
const outboundRules = (outbound || '')
  .split('🕳')
  .filter(Boolean)
  .map(i => {
    let [outboundPattern, tagPattern = '.*'] = i.split('🏷')
    return [
      createOutboundRegExp(outboundPattern),
      createTagRegExp(tagPattern)
    ]
  })

config.outbounds.forEach(o => {
  outboundRules.forEach(([outboundRegex, tagRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) o.outbounds = []
      const tags = proxies.filter(p => tagRegex.test(p.tag)).map(p => p.tag)
      o.outbounds.push(...tags)
    }
  })
})

// Proxy 组：只放机场节点 + direct，不放 wg-home
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

proxyGroup.outbounds = [
  ...proxyTags,
  'direct'
]

if (!proxyGroup.default || !proxyGroup.outbounds.includes(proxyGroup.default)) {
  proxyGroup.default = proxyTags[0]
}

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({ type: 'direct', tag: 'direct' })
}

// 空组兜底
const compatibleOutbound = { tag: 'COMPATIBLE', type: 'direct' }
let hasCompatible = config.outbounds.some(o => o?.tag === 'COMPATIBLE')

config.outbounds.forEach(o => {
  outboundRules.forEach(([outboundRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) o.outbounds = []
      if (o.outbounds.length === 0) {
        if (!hasCompatible) {
          config.outbounds.push(compatibleOutbound)
          hasCompatible = true
        }
        o.outbounds.push('COMPATIBLE')
      }
    }
  })
})

// WG 回家路由
if (!Array.isArray(config.route.rules)) config.route.rules = []

const homeCIDRs = envList('WG_HOME_CIDRS', '192.168.1.0/24')

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

// rule-set 修正
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/',
          'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/'
        )
        .replace(
          'https://testingcf.jsdelivr.net/gh/Toperlock/sing-box-geosite@main/',
          'https://ghfast.top/raw.githubusercontent.com/Toperlock/sing-box-geosite/main/'
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

// 基础校验
if (!config.endpoints.some(e => e?.tag === 'wg-home' && e?.type === 'wireguard')) {
  throw new Error('最终配置缺少 wireguard endpoint: wg-home')
}

if (proxyGroup.outbounds.includes('wg-home')) {
  throw new Error('Proxy 组不应包含 wg-home')
}

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'google' || s?.tag === 'proxy-dns')
if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error(`DNS 服务器 ${proxyDns.tag} 必须 detour 到 Proxy`)
}

const homeDns = config.dns?.servers?.find(s => s?.tag === 'home-dns')
if (homeDns && homeDns.detour !== 'wg-home') {
  throw new Error('home-dns 必须 detour 到 wg-home')
}

const localDns = config.dns?.servers?.find(s => s?.tag === 'local-dns')
if (!localDns) {
  throw new Error('缺少 local-dns，route.default_domain_resolver 会失效')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WG 多分组回家配置生成（alpha.21 增强稳定版）')
