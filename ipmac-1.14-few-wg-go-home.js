// iPhone / Mac sing-box 1.14-alpha：WireGuard endpoint 回家
// 2026-06-25 RealIP 稳定版
// 无 FakeIP + DNS Hijack + Sniff + Apple Direct + 微信 Direct
// 保留 UDP/QUIC，不屏蔽 UDP 443
// 吸收 alpha.33/34：route-options + udp_connect + resolve + endpoint_independent_nat
// WG 回家：保留 home-dns / wg-home / 192.168.1.0/24 回家路由

console.log('🚀 开始生成 WireGuard 回家配置（2026-06-25 RealIP 稳定版）')

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

function dedupe(arr) {
  return [...new Set((arr || []).filter(Boolean))]
}

function normalizeDomainSuffix(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return [value]
  return []
}

function isSameQueryReject(rule) {
  return (
    Array.isArray(rule?.query_type) &&
    rule.query_type.includes('SVCB') &&
    rule.query_type.includes('HTTPS') &&
    rule.query_type.includes('PTR') &&
    rule.action === 'reject'
  )
}

function isStunRejectRule(rule) {
  if (!rule || typeof rule !== 'object') return false

  if (
    Array.isArray(rule.protocol) &&
    rule.protocol.includes('stun') &&
    rule.protocol.includes('dtls') &&
    rule.action === 'reject'
  ) {
    return true
  }

  if (
    rule.type === 'logical' &&
    rule.action === 'reject' &&
    Array.isArray(rule.rules) &&
    JSON.stringify(rule).includes('stun') &&
    JSON.stringify(rule).includes('turn')
  ) {
    return true
  }

  return false
}

function isRouteOptionsRule(rule) {
  return rule?.action === 'route-options'
}

function isResolveRule(rule) {
  return rule?.action === 'resolve'
}

function enhanceProxyOutbound(outbound) {
  if (!outbound || typeof outbound !== 'object') return outbound

  const proxyTypes = [
    'vless',
    'vmess',
    'trojan',
    'shadowsocks',
    'hysteria2',
    'tuic'
  ]

  if (!proxyTypes.includes(outbound.type)) return outbound

  const next = { ...outbound }

  if (next.type === 'vless') {
    next.connect_timeout = next.connect_timeout || '5s'
    next.tcp_fast_open = true
    next.tcp_keep_alive = next.tcp_keep_alive || '30s'
    next.tcp_keep_alive_interval = next.tcp_keep_alive_interval || '5s'
    next.udp_fragment = true

    if (!next.packet_encoding) {
      next.packet_encoding = 'xudp'
    }
  }

  return next
}

requireEnv([
  'WG_PRIVATE_KEY',
  'WG_PEER_ADDRESS',
  'WG_PEER_PORT',
  'WG_PEER_PUBLIC_KEY'
])


function isIPv4(value) {
  return typeof value === 'string' &&
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)
}

function ensureProxyServerDirectRules(proxies) {
  if (!config.route) config.route = {}
  if (!Array.isArray(config.route.rules)) config.route.rules = []

  const serverDirectRules = []

  for (const proxy of proxies || []) {
    const server = proxy?.server

    if (!isIPv4(server)) {
      continue
    }

    serverDirectRules.push({
      ip_cidr: `${server}/32`,
      outbound: 'direct'
    })
  }

  if (!serverDirectRules.length) {
    return
  }

  const managedCidrs = serverDirectRules.map(rule => rule.ip_cidr)

  config.route.rules = config.route.rules.filter(rule => {
    if (rule?.outbound !== 'direct') {
      return true
    }

    const ipCidr = rule?.ip_cidr

    if (typeof ipCidr === 'string') {
      return !managedCidrs.includes(ipCidr)
    }

    if (Array.isArray(ipCidr)) {
      return !ipCidr.some(item => managedCidrs.includes(item))
    }

    return true
  })

  config.route.rules.unshift(...serverDirectRules)
}

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

if (!config.experimental) config.experimental = {}
if (!config.experimental.cache_file) config.experimental.cache_file = {}
if (!config.experimental.clash_api) {
  config.experimental.clash_api = {
    external_controller: '127.0.0.1:9090',
    external_ui: 'ui',
    secret: '',
    default_mode: 'rule'
  }
}

if (!config.route) config.route = {}
if (!config.dns) config.dns = {}

if (!Array.isArray(config.dns.servers)) config.dns.servers = []
if (!Array.isArray(config.dns.rules)) config.dns.rules = []
if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.inbounds)) config.inbounds = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []
if (!Array.isArray(config.route.rules)) config.route.rules = []

// cache_file：RealIP 版，只保留 DNS 缓存，不再保存 FakeIP
config.experimental.cache_file.enabled = true
config.experimental.cache_file.store_dns = true
delete config.experimental.cache_file.store_fakeip

// DNS 全局优化
config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 65536
config.dns.reverse_mapping = true
config.dns.optimistic = {
  enabled: true,
  timeout: '1h0m0s'
}

// 关键：RealIP 稳定版 DNS final 走 local-dns，避免启动期 proxy-dns 自循环
config.dns.final = 'local-dns'

// http client v2：区分 direct / proxy
config.http_clients = config.http_clients.filter(c =>
  c?.tag !== 'direct' &&
  c?.tag !== 'proxy'
)

config.http_clients.unshift(
  {
    tag: 'direct',
    version: 2
  },
  {
    tag: 'proxy',
    version: 2,
    detour: 'Proxy'
  }
)

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'
config.route.auto_detect_interface = true
config.route.final = 'Proxy'

// DNS servers：RealIP，不使用 FakeIP
config.dns.servers = config.dns.servers.filter(s =>
  ![
    'google',
    'public',
    'hosts-fix',
    'hosts_fix',
    'local',
    'mdns-server',
    'local-dns',
    'home-dns',
    'proxy-dns',
    'fakeip'
  ].includes(s?.tag)
)

config.dns.servers.unshift(
  {
    type: 'hosts',
    tag: 'hosts-fix',
    predefined: {
      'dns.google': ['8.8.8.8', '8.8.4.4'],
      'dns.alidns.com': ['223.5.5.5', '223.6.6.6'],
      'cloudflare-dns.com': ['104.16.248.249', '104.16.249.249'],
      'dns.cloudflare.com': ['104.16.248.249', '104.16.249.249'],
      'raw.githubusercontent.com': [
        '185.199.108.133',
        '185.199.109.133',
        '185.199.110.133',
        '185.199.111.133'
      ],
      'cdn.jsdelivr.net': [
        '104.16.89.20',
        '104.16.90.20'
      ]
    }
  },
  {
    type: 'local',
    tag: 'local',
    neighbor_domain: [
      '.local',
      '.lan'
    ]
  },
  {
    type: 'mdns',
    tag: 'mdns-server'
  },
  {
    tag: 'local-dns',
    type: 'udp',
    server: '223.5.5.5'
  },
  {
    tag: 'home-dns',
    type: 'udp',
    server: env('WG_HOME_DNS', '192.168.1.118'),
    detour: 'wg-home'
  },
  {
    tag: 'proxy-dns',
    type: 'tls',
    server: 'dns.google',
    server_port: 853,
    domain_resolver: 'hosts-fix',
    detour: 'Proxy'
  }
)

// tun-in：TUN + DNS hijack + endpoint_independent_nat
config.inbounds = config.inbounds.map(i => {
  if (i?.type === 'tun' && i?.tag === 'tun-in') {
    const tun = {
      ...i,
      stack: 'system',
      auto_route: true,
      strict_route: true,
      dns_mode: 'hijack',
      dns_address: '172.19.0.2',
      endpoint_independent_nat: true
    }

    if (tun.platform?.http_proxy) {
      delete tun.platform.http_proxy
    }

    if (tun.platform && Object.keys(tun.platform).length === 0) {
      delete tun.platform
    }

    return tun
  }

  return i
})

// DNS rules 清理
config.dns.rules = config.dns.rules
  .map(removeDnsRuleStrategy)
  .filter(r => {
    if (r?.ip_cidr && !r?.match_response) return false
    if (r?.server === 'fakeip') return false
    if (isSameQueryReject(r)) return false
    return true
  })
  .map(r => {
    if (r?.server === 'local') return { ...r, server: 'local-dns' }
    if (r?.server === 'google') return { ...r, server: 'proxy-dns' }
    return r
  })

// 内网域名
const homeDomains = envList(
  'WG_HOME_DOMAINS',
  'ktpd.fun,xwcac68u.top'
)

config.dns.rules = config.dns.rules.filter(r => {
  const ds = normalizeDomainSuffix(r?.domain_suffix)
  return !ds.some(d => homeDomains.includes(d))
})

// 去重核心 DNS 域名规则
const managedDnsDomains = [
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
  'telegram.org',
  't.me',
  'github.com',
  'githubusercontent.com',
  'githubassets.com',
  'github.io',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'openai.com',
  'chatgpt.com',
  'oaistatic.com',
  'oaiusercontent.com'
]

config.dns.rules = config.dns.rules.filter(r => {
  const ds = normalizeDomainSuffix(r?.domain_suffix)
  return !ds.some(d => managedDnsDomains.includes(d))
})

// DNS 核心规则：RealIP，不使用 FakeIP
config.dns.rules.unshift(
  {
    domain_suffix: homeDomains,
    action: 'route',
    server: 'home-dns'
  },
  {
    query_type: [
      'SVCB',
      'HTTPS',
      'PTR'
    ],
    action: 'reject'
  },
  {
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
    server: 'proxy-dns'
  },
  {
    domain_suffix: [
      'telegram.org',
      't.me',
      'tdesktop.com',
      'telegra.ph'
    ],
    action: 'route',
    server: 'proxy-dns'
  },
  {
    domain_suffix: [
      'github.com',
      'githubusercontent.com',
      'githubassets.com',
      'github.io',
      'raw.githubusercontent.com',
      'objects.githubusercontent.com'
    ],
    action: 'route',
    server: 'proxy-dns'
  },
  {
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
    server: 'proxy-dns'
  },
  {
    clash_mode: 'direct',
    action: 'route',
    server: 'local-dns'
  },
  {
    clash_mode: 'global',
    action: 'route',
    server: 'proxy-dns'
  },
  {
    rule_set: 'geosite-cn',
    action: 'route',
    server: 'local-dns'
  },
  {
    rule_set: 'geosite-geolocation-!cn',
    action: 'route',
    server: 'proxy-dns'
  }
)

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

proxies = proxies.map(enhanceProxyOutbound)

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

proxyGroup.outbounds = dedupe([
  ...proxyTags,
  'direct'
])

proxyGroup.default = proxyTags[0] || 'direct'

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

// 删除旧 wg-home 规则，重建
config.route.rules = config.route.rules.filter(r => r?.outbound !== 'wg-home')

// 删除旧 FakeIP 路由
config.route.rules = config.route.rules.filter(r => {
  if (Array.isArray(r?.ip_cidr) && r.ip_cidr.includes('198.18.0.0/15')) return false
  if (typeof r?.ip_cidr === 'string' && r.ip_cidr === '198.18.0.0/15') return false
  return true
})

// 删除旧 STUN / route-options / resolve，后面统一重建
config.route.rules = config.route.rules.filter(r =>
  !isStunRejectRule(r) &&
  !isRouteOptionsRule(r) &&
  !isResolveRule(r)
)

// 微信 Direct
const wechatDomains = [
  'weixin.qq.com',
  'wx.qq.com',
  'qpic.cn',
  'gtimg.com',
  'qlogo.cn',
  'tenpay.com',
  'wechat.com',
  'weixinbridge.com',
  'mmbiz.qpic.cn',
  'mmbiz.qlogo.cn'
]

config.route.rules = config.route.rules.filter(r => {
  const ds = normalizeDomainSuffix(r?.domain_suffix)
  return !(r?.outbound === 'direct' && ds.some(d => wechatDomains.includes(d)))
})

// Apple Direct 扩大
const appleDirectDomains = [
  'apple.com',
  'icloud.com',
  'apple-dns.net',
  'push.apple.com',
  'itunes.apple.com',
  'mzstatic.com',
  'apps.apple.com',
  'appstore.com',
  'aaplimg.com',
  'cdn-apple.com',
  'me.com',
  'mac.com'
]

config.route.rules = config.route.rules.filter(r => {
  const ds = normalizeDomainSuffix(r?.domain_suffix)
  return !(r?.outbound === 'direct' && ds.some(d => appleDirectDomains.includes(d)))
})

// 确保基础规则存在
const hasSniff = config.route.rules.some(r => r?.action === 'sniff')
const hasHijack = config.route.rules.some(r => r?.action === 'hijack-dns')

const baseRules = []

if (!hasSniff) {
  baseRules.push({
    inbound: [
      'tun-in',
      'mixed-in'
    ],
    action: 'sniff'
  })
}

if (!hasHijack) {
  baseRules.push({
    type: 'logical',
    mode: 'or',
    rules: [
      {
        port: 53
      },
      {
        protocol: 'dns'
      }
    ],
    action: 'hijack-dns'
  })
}

config.route.rules = [
  {
    ip_version: 6,
    action: 'reject'
  },
  ...baseRules,
  ...config.route.rules.filter(r => !(r?.ip_version === 6 && r?.action === 'reject'))
]

// 插入 WG 回家路由
config.route.rules.splice(3, 0, {
  ip_cidr: homeCIDRs,
  outbound: 'wg-home'
})

// 插入微信 / Apple Direct
const privateRuleIndex = config.route.rules.findIndex(r => r?.ip_is_private === true)

const directRules = [
  {
    domain_suffix: wechatDomains,
    outbound: 'direct'
  },
  {
    domain_suffix: appleDirectDomains,
    outbound: 'direct'
  }
]

if (privateRuleIndex >= 0) {
  config.route.rules.splice(privateRuleIndex, 0, ...directRules)
} else {
  config.route.rules.push(...directRules)
}

// 保留 UDP/QUIC：只拦 STUN / TURN / DTLS，不拦 UDP 443
config.route.rules.push(
  {
    protocol: [
      'stun',
      'dtls'
    ],
    action: 'reject'
  },
  {
    type: 'logical',
    mode: 'or',
    rules: [
      {
        network: 'udp',
        port: [
          3478,
          5349,
          5350,
          19302,
          10000
        ]
      },
      {
        domain_regex: '^stun\\..+'
      },
      {
        domain_keyword: [
          'stun',
          'turn',
          'httpdns'
        ]
      }
    ],
    action: 'reject'
  },
  {
    action: 'route-options',
    udp_disable_domain_unmapping: true,
    udp_connect: true
  },
  {
    action: 'resolve'
  }
)

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
        .replace(
          'https://testingcf.jsdelivr.net/gh/Toperlock/sing-box-geosite@main/',
          'https://ghfast.top/raw.githubusercontent.com/Toperlock/sing-box-geosite/main/'
        )
    }

    delete rs.download_detour
    delete rs.http_client

    return rs
  })
}

// 校验
if (proxyGroup.outbounds.includes('home')) {
  throw new Error('WG 回家配置中不应包含旧 home outbound')
}

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'proxy-dns')
if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error('proxy-dns 必须 detour 到 Proxy')
}

const homeDns = config.dns?.servers?.find(s => s?.tag === 'home-dns')
if (!homeDns || homeDns.detour !== 'wg-home') {
  throw new Error('home-dns 必须存在并 detour 到 wg-home')
}

const fakeipDns = config.dns?.servers?.find(s => s?.tag === 'fakeip')
if (fakeipDns) {
  throw new Error('WG RealIP 配置不应包含 fakeip DNS server')
}

const wgRoute = config.route.rules.find(r =>
  Array.isArray(r?.ip_cidr) &&
  homeCIDRs.every(cidr => r.ip_cidr.includes(cidr)) &&
  r.outbound === 'wg-home'
)

if (!wgRoute) {
  throw new Error(`缺少 WG 回家路由：${homeCIDRs.join(',')} -> wg-home`)
}

ensureProxyServerDirectRules(proxies)

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WireGuard 回家配置（2026-06-25 RealIP 稳定版）')
