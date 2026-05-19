// iPhone / Mac sing-box 1.14-alpha：WireGuard endpoint 回家 + 代理节点订阅注入（融合 alpha.24 优点增强版）

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

function upsertByTag(arr, item) {
  const index = arr.findIndex(x => x?.tag === item.tag)
  if (index >= 0) {
    arr[index] = {
      ...arr[index],
      ...item
    }
  } else {
    arr.push(item)
  }
}

function removeDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return rule

  delete rule.strategy

  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(removeDnsRuleStrategy)
  }

  return rule
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

if (!config.experimental) config.experimental = {}
if (!config.experimental.cache_file) config.experimental.cache_file = {}
if (!config.route) config.route = {}
if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.servers)) config.dns.servers = []
if (!Array.isArray(config.dns.rules)) config.dns.rules = []
if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []

// experimental.cache_file 增强
config.experimental.cache_file.enabled = true
config.experimental.cache_file.store_dns = true
config.experimental.cache_file.store_fakeip = false

// alpha.24 DNS 增强：稳定优先，不启用全局 FakeIP
config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 32768
config.dns.reverse_mapping = true
config.dns.optimistic = true

// 1.14 启动下载解耦
if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({
    tag: 'direct'
  })
}

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'

// DNS server：吸收 alpha.24 的 hosts_fix / local / mdns 思路
upsertByTag(config.dns.servers, {
  type: 'hosts',
  tag: 'hosts-fix',
  predefined: {
    'dns.google': [
      '8.8.8.8',
      '8.8.4.4'
    ],
    'dns.alidns.com': [
      '223.5.5.5',
      '223.6.6.6'
    ],
    'cloudflare-dns.com': [
      '104.16.248.249',
      '104.16.249.249'
    ]
  }
})

upsertByTag(config.dns.servers, {
  type: 'local',
  tag: 'local',
  neighbor_domain: [
    '.local',
    '.lan'
  ]
})

upsertByTag(config.dns.servers, {
  type: 'mdns',
  tag: 'mdns-server'
})

upsertByTag(config.dns.servers, {
  tag: 'local-dns',
  type: 'udp',
  server: '223.5.5.5'
})

upsertByTag(config.dns.servers, {
  tag: 'home-dns',
  type: 'udp',
  server: '192.168.1.118',
  detour: 'wg-home'
})

upsertByTag(config.dns.servers, {
  tag: 'proxy-dns',
  type: 'tls',
  server: 'dns.google',
  server_port: 853,
  domain_resolver: 'hosts-fix',
  detour: 'Proxy'
})

// tun-in 增强：完整 DNS hijack
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

// DNS rules 修正
config.dns.rules = config.dns.rules
  .map(removeDnsRuleStrategy)
  .filter(r => {
    // 删除新版 1.14 不允许的 DNS 请求侧 ip_cidr 规则
    // 内网 IP 走 route.rules，内网域名走 home-dns
    if (r?.ip_cidr && !r?.match_response) return false
    return true
  })

// 内网域名走 home-dns
config.dns.rules = config.dns.rules.filter(r => {
  if (
    Array.isArray(r?.domain_suffix) &&
    r.domain_suffix.includes('ktpd.fun') &&
    r.server === 'home-dns'
  ) {
    return false
  }
  return true
})

config.dns.rules.unshift({
  domain_suffix: [
    'ktpd.fun',
    'xwcac68u.top'
  ],
  action: 'route',
  server: 'home-dns'
})

// DNS rules 增强：减少 iOS/macOS 的 HTTPS/SVCB/PTR 噪音
config.dns.rules = config.dns.rules.filter(r => {
  if (
    Array.isArray(r?.query_type) &&
    r.query_type.includes('SVCB') &&
    r.query_type.includes('HTTPS') &&
    r.query_type.includes('PTR') &&
    r.action === 'reject'
  ) {
    return false
  }
  return true
})

config.dns.rules.splice(1, 0, {
  query_type: [
    'SVCB',
    'HTTPS',
    'PTR'
  ],
  action: 'reject'
})

// 获取代理节点
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

// 注入 WireGuard
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

// 修复 Proxy 组
let proxyGroup = config.outbounds.find(
  o => o?.tag === 'Proxy' && o?.type === 'selector'
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

// WG 路由
if (!Array.isArray(config.route.rules)) {
  config.route.rules = []
}

const homeCIDRs = envList('WG_HOME_CIDRS', '192.168.1.0/24')

const hasWgHomeRule = config.route.rules.some(
  r => r?.outbound === 'wg-home'
)

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
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
        )
    }

    delete rs.download_detour
    delete rs.http_client

    return rs
  })
}

// 校验
if (!config.endpoints.some(e => e?.tag === 'wg-home' && e?.type === 'wireguard')) {
  throw new Error('最终配置缺少 wireguard endpoint: wg-home')
}

if (proxyGroup.outbounds.includes('wg-home')) {
  throw new Error('Proxy 组不应包含 wg-home')
}

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'proxy-dns')
if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error('proxy-dns 必须 detour 到 Proxy')
}

const homeDns = config.dns?.servers?.find(s => s?.tag === 'home-dns')
if (homeDns && homeDns.detour !== 'wg-home') {
  throw new Error('home-dns 必须 detour 到 wg-home')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WireGuard 回家配置生成（融合 alpha.24 优点增强版）')
