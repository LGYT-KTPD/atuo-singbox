// iPhone / Mac sing-box 1.14：WireGuard endpoint 回家 + 机场多分组节点注入

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

const DEFAULT_PROXY = proxyTags[0]

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
if (!wgReplaced) config.endpoints.unshift(wgEndpoint)

// 注入代理节点
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})
config.outbounds.push(...proxies)

// 多分组注入
const outboundRules = outbound
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

// Proxy 组
let proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')
if (!proxyGroup) {
  proxyGroup = { type: 'selector', tag: 'Proxy', outbounds: [], default: DEFAULT_PROXY }
  config.outbounds.unshift(proxyGroup)
}
proxyGroup.outbounds = [...proxyTags, 'direct']
proxyGroup.default = DEFAULT_PROXY

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

// DNS detour 修复
if (Array.isArray(config.dns?.servers)) {
  config.dns.servers = config.dns.servers.map(s => {
    if (s?.tag === 'proxy-dns') return { ...s, detour: DEFAULT_PROXY }
    return s
  })
}

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

// 清理 rule-set
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    delete rs.download_detour
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

function createTagRegExp(tagPattern) {
  return new RegExp(tagPattern.replace('ℹ️', ''), tagPattern.includes('ℹ️') ? 'i' : undefined)
}

function createOutboundRegExp(outboundPattern) {
  return new RegExp(outboundPattern.replace('ℹ️', ''), outboundPattern.includes('ℹ️') ? 'i' : undefined)
}

console.log('✅ 完成 WG 多分组回家配置生成')
