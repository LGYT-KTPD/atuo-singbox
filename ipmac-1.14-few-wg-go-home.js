// iPhone / Mac sing-box 1.14-alpha：WireGuard endpoint 回家 + 局部 FakeIP 增强版
// RealIP 主线 + Google/Telegram/GitHub/OpenAI 局部 FakeIP

console.log('🚀 开始生成 WireGuard + Partial FakeIP 配置')

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
  if (v === undefined || v === null || String(v).trim() === '') {
    return fallback
  }
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

// cache_file
config.experimental.cache_file.enabled = true
config.experimental.cache_file.store_dns = true
config.experimental.cache_file.store_fakeip = true

// DNS 全局优化
config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 32768
config.dns.reverse_mapping = true
config.dns.optimistic = true

// 启动下载解耦
if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({
    tag: 'direct'
  })
}

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'

// DNS servers

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

// ⭐ 新增 fakeip server
upsertByTag(config.dns.servers, {
  type: 'fakeip',
  tag: 'fakeip',
  inet4_range: '198.18.0.0/15'
})

// tun hijack
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

// DNS rules 清理
config.dns.rules = config.dns.rules
  .map(removeDnsRuleStrategy)
  .filter(r => {
    if (r?.ip_cidr && !r?.match_response) return false
    return true
  })

// 删除旧 fakeip 规则
config.dns.rules = config.dns.rules.filter(r => {
  return !(r?.server === 'fakeip')
})

// 内网域名
config.dns.rules.unshift({
  domain_suffix: [
    'ktpd.fun',
    'xwcac68u.top'
  ],
  action: 'route',
  server: 'home-dns'
})

// Google / YouTube / GV
config.dns.rules.push({
  domain_suffix: [
    'google.com',
    'google.com.hk',
    'googleapis.com',
    'gstatic.com',
    'ggpht.com',
    'googleusercontent.com',
    'youtube.com',
    'ytimg.com',
    'googlevideo.com',
    'voice.google.com',
    'googlevoice.com',
    'clients4.google.com',
    'clients6.google.com',
    'hangouts.google.com'
  ],
  action: 'route',
  server: 'fakeip'
})

// Telegram
config.dns.rules.push({
  domain_suffix: [
    'telegram.org',
    't.me',
    'tdesktop.com',
    'telegra.ph'
  ],
  action: 'route',
  server: 'fakeip'
})

// GitHub
config.dns.rules.push({
  domain_suffix: [
    'github.com',
    'githubusercontent.com',
    'githubassets.com',
    'github.io',
    'raw.githubusercontent.com',
    'objects.githubusercontent.com'
  ],
  action: 'route',
  server: 'fakeip'
})

// OpenAI / ChatGPT
config.dns.rules.push({
  domain_suffix: [
    'openai.com',
    'chatgpt.com',
    'oaistatic.com',
    'oaiusercontent.com',
    'auth0.openai.com',
    'cdn.openai.com',
    'api.openai.com'
  ],
  action: 'route',
  server: 'fakeip'
})

// DNS 噪音 reject
config.dns.rules.push({
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
  throw new Error('没有获取到代理节点')
}

// WG endpoint
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

// 注入代理节点
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true

  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true

  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

// Proxy selector
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

// route.rules
if (!Array.isArray(config.route.rules)) {
  config.route.rules = []
}

const homeCIDRs = envList(
  'WG_HOME_CIDRS',
  '192.168.1.0/24'
)

// WG 内网
const hasWgHomeRule = config.route.rules.some(
  r => r?.outbound === 'wg-home'
)

if (!hasWgHomeRule) {
  config.route.rules.splice(3, 0, {
    ip_cidr: homeCIDRs,
    outbound: 'wg-home'
  })
}

// ⭐ FakeIP 必须走 Proxy
const hasFakeIpRoute = config.route.rules.some(r =>
  Array.isArray(r?.ip_cidr) &&
  r.ip_cidr.includes('198.18.0.0/15')
)

if (!hasFakeIpRoute) {
  config.route.rules.splice(5, 0, {
    ip_cidr: [
      '198.18.0.0/15'
    ],
    outbound: 'Proxy'
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

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WireGuard + Partial FakeIP 配置')
