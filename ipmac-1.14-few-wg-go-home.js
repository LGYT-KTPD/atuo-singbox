// iPhone / Mac sing-box 1.14：WireGuard endpoint 回家 + 代理节点订阅注入
// .env.wg 只负责 WG 信息，不负责 VLESS 节点

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
    throw new Error(`.env.wg 缺少变量：${missing.join(', ')}`)
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

if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!config.route) config.route = {}

// ① 获取代理节点：这里注入 “🇺🇸 US-VLESS-VPS”
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

const DEFAULT_PROXY = proxyTags[0]

// ② 注入 WireGuard endpoint
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

// ③ 注入代理节点到 outbounds
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

// ④ 修复 Proxy selector
let proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')

if (!proxyGroup) {
  proxyGroup = {
    type: 'selector',
    tag: 'Proxy',
    outbounds: [],
    default: DEFAULT_PROXY
  }
  config.outbounds.unshift(proxyGroup)
}

proxyGroup.outbounds = [...proxyTags, 'direct']
proxyGroup.default = DEFAULT_PROXY

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// ⑤ DNS proxy-dns detour 跟随默认代理节点
if (Array.isArray(config.dns?.servers)) {
  config.dns.servers = config.dns.servers.map(s => {
    if (s?.tag === 'proxy-dns') {
      return {
        ...s,
        detour: DEFAULT_PROXY
      }
    }
    return s
  })
}

// ⑥ 修复 WG 回家路由
if (!Array.isArray(config.route.rules)) config.route.rules = []

const homeCIDRs = envList('WG_HOME_CIDRS', '192.168.1.0/24')
const hasWgHomeRule = config.route.rules.some(r => r?.outbound === 'wg-home')

if (!hasWgHomeRule) {
  config.route.rules.splice(3, 0, {
    ip_cidr: homeCIDRs,
    outbound: 'wg-home'
  })
} else {
  config.route.rules = config.route.rules.map(r => {
    if (r?.outbound === 'wg-home') {
      return {
        ...r,
        ip_cidr: homeCIDRs
      }
    }
    return r
  })
}

// ⑦ 清理 rule-set 旧字段
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
    return rs
  })
}

// ⑧ 校验
if (!config.endpoints.some(e => e?.tag === 'wg-home' && e?.type === 'wireguard')) {
  throw new Error('最终配置缺少 wireguard endpoint: wg-home')
}

if (proxyGroup.outbounds.includes('wg-home')) {
  throw new Error('Proxy 组不应包含 wg-home')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WireGuard 回家配置生成')
