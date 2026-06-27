// iPhone / Mac sing-box 1.14-alpha：WireGuard endpoint 回家 + 机场多分组节点注入
// 无 FakeIP 稳定版：DoT + DNS Hijack + Sniff + Apple Direct 扩大 + endpoint_independent_nat

console.log('🚀 开始生成 WG 多分组回家配置（No FakeIP 稳定版）')

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
  return env(name, fallback)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
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

function removeByTags(arr, tags) {
  return arr.filter(item => !tags.includes(item?.tag))
}

function normalizeOutboundName(name) {
  if (name === 'home') return 'wg-home'
  if (name === '__HOME_PLACEHOLDER__') return 'wg-home'
  return name
}

function normalizeRouteRule(rule) {
  if (!rule || typeof rule !== 'object') return rule

  if (rule.outbound) {
    rule.outbound = normalizeOutboundName(rule.outbound)
  }

  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(normalizeRouteRule)
  }

  return rule
}

function setSelectorDefault(tag, preferred) {
  const o = config.outbounds.find(x => x?.tag === tag && x?.type === 'selector')
  if (!o) return

  if (!Array.isArray(o.outbounds)) o.outbounds = []

  o.outbounds = dedupe(o.outbounds.map(normalizeOutboundName))

  if (preferred && o.outbounds.includes(preferred)) {
    o.default = preferred
    return
  }

  if (o.default && o.outbounds.includes(o.default)) {
    return
  }

  if (o.outbounds.length > 0) {
    o.default = o.outbounds[0]
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

if (!config.experimental) config.experimental = {}
if (!config.experimental.cache_file) config.experimental.cache_file = {}

if (!config.dns) config.dns = {}
if (!config.route) config.route = {}

if (!Array.isArray(config.dns.servers)) config.dns.servers = []
if (!Array.isArray(config.dns.rules)) config.dns.rules = []
if (!Array.isArray(config.inbounds)) config.inbounds = []
if (!Array.isArray(config.endpoints)) config.endpoints = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []

config.experimental.cache_file.enabled = true
config.experimental.cache_file.store_dns = true
delete config.experimental.cache_file.store_fakeip

config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 65536
config.dns.reverse_mapping = true
config.dns.optimistic = {
  enabled: true,
  timeout: '1h0m0s'
}
config.dns.final = 'proxy-dns'

config.http_clients = config.http_clients.filter(c => c?.tag !== 'direct')
config.http_clients.unshift({
  tag: 'direct',
  version: 2
})

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local-dns'

config.dns.servers = removeByTags(config.dns.servers, [
  'google',
  'local',
  'public',
  'hosts-fix',
  'mdns-server',
  'local-dns',
  'home-dns',
  'proxy-dns',
  'fakeip'
])

config.dns.servers.unshift(
  {
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
    server: '192.168.1.118',
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

config.dns.rules = config.dns.rules
  .map(removeDnsRuleStrategy)
  .filter(r => {
    if (r?.ip_cidr && !r?.match_response) return false
    if (r?.server === 'fakeip') return false
    return true
  })
  .map(r => {
    if (r?.server === 'local') return { ...r, server: 'local-dns' }
    if (r?.server === 'google') return { ...r, server: 'proxy-dns' }
    return r
  })

config.dns.rules = config.dns.rules.filter(r => {
  if (
    Array.isArray(r?.domain_suffix) &&
    r.domain_suffix.includes('ktpd.fun') &&
    r.server === 'home-dns'
  ) {
    return false
  }

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

config.dns.rules.unshift({
  domain_suffix: [
    'ktpd.fun',
    'xwcac68u.top'
  ],
  action: 'route',
  server: 'home-dns'
})

config.dns.rules.splice(1, 0, {
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
})

config.dns.rules.splice(2, 0, {
  domain_suffix: [
    'telegram.org',
    't.me',
    'tdesktop.com',
    'telegra.ph'
  ],
  action: 'route',
  server: 'proxy-dns'
})

config.dns.rules.splice(3, 0, {
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
})

config.dns.rules.splice(4, 0, {
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
})

config.dns.rules.splice(5, 0, {
  query_type: [
    'SVCB',
    'HTTPS',
    'PTR'
  ],
  action: 'reject'
})

let proxies = url
  ? await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: {
        'include-unsupported-proxy': includeUnsupportedProxy
      },
      subscription: {
        name,
        url,
        source: 'remote'
      },
    })
  : await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: {
        'include-unsupported-proxy': includeUnsupportedProxy
      },
    })

const proxyTags = proxies.map(p => p.tag)

if (proxyTags.length === 0) {
  throw new Error('没有获取到代理节点')
}

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

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === '__HOME_PLACEHOLDER__') return false
  if (o.tag === 'home') return false
  return true
})

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  if (o.tag === 'COMPATIBLE') return true

  const groupTags = [
    'OpenAI',
    'Google',
    'Telegram',
    'Twitter',
    'Facebook',
    'BiliBili',
    'Bahamut',
    'Spotify',
    'TikTok',
    'Netflix',
    'Disney+',
    'Apple',
    'Microsoft',
    'Games',
    'Streaming',
    'Global',
    'China',
    'HongKong',
    'TaiWan',
    'Singapore',
    'Japan',
    'America',
    'Others',
    'auto'
  ]

  if (groupTags.includes(o.tag)) return true

  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

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

      const tags = proxies
        .filter(p => tagRegex.test(p.tag))
        .map(p => p.tag)

      o.outbounds.push(...tags)
      o.outbounds = dedupe(o.outbounds)
    }
  })
})

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

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
  'auto',
  ...proxyTags,
  'direct'
])

const compatibleOutbound = {
  tag: 'COMPATIBLE',
  type: 'direct'
}

let hasCompatible = config.outbounds.some(o => o?.tag === 'COMPATIBLE')

config.outbounds.forEach(o => {
  if (!['selector', 'urltest'].includes(o?.type)) return

  if (!Array.isArray(o.outbounds)) {
    o.outbounds = []
  }

  o.outbounds = dedupe(o.outbounds.map(normalizeOutboundName))

  if (o.outbounds.includes('wg-home')) {
    o.outbounds = o.outbounds.filter(x => x !== 'wg-home')
  }

  if (o.outbounds.length === 0) {
    if (!hasCompatible) {
      config.outbounds.push(compatibleOutbound)
      hasCompatible = true
    }
    o.outbounds.push('COMPATIBLE')
  }
})

const selectorDefaults = {
  Proxy: 'auto',
  OpenAI: 'America',
  Google: 'HongKong',
  Telegram: 'Singapore',
  Twitter: 'HongKong',
  Facebook: 'HongKong',
  BiliBili: 'direct',
  Bahamut: 'TaiWan',
  Spotify: 'America',
  TikTok: 'Japan',
  Netflix: 'HongKong',
  'Disney+': 'HongKong',
  Apple: 'direct',
  Microsoft: 'direct',
  Games: 'direct',
  Streaming: 'HongKong',
  Global: 'HongKong',
  China: 'direct'
}

Object.entries(selectorDefaults).forEach(([tag, preferred]) => {
  setSelectorDefault(tag, preferred)
})

config.outbounds.forEach(o => {
  if (o?.type !== 'selector') return
  if (!Array.isArray(o.outbounds)) o.outbounds = []

  o.outbounds = dedupe(o.outbounds.map(normalizeOutboundName))

  if (!o.default || !o.outbounds.includes(o.default)) {
    o.default = o.outbounds[0]
  }
})

if (!Array.isArray(config.route.rules)) config.route.rules = []

config.route.rules = config.route.rules.map(normalizeRouteRule)

config.route.rules = config.route.rules.filter(r => {
  if (
    Array.isArray(r?.ip_cidr) &&
    r.ip_cidr.includes('198.18.0.0/15')
  ) {
    return false
  }
  return true
})

const homeCIDRs = envList('WG_HOME_CIDRS', '192.168.1.0/24')

config.route.rules = config.route.rules.map(r => {
  if (r?.outbound === 'wg-home') {
    return {
      ...r,
      ip_cidr: homeCIDRs
    }
  }
  return r
})

if (!config.route.rules.some(r => r?.outbound === 'wg-home')) {
  config.route.rules.splice(3, 0, {
    ip_cidr: homeCIDRs,
    outbound: 'wg-home'
  })
}

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
  const ds = Array.isArray(r?.domain_suffix)
    ? r.domain_suffix
    : (typeof r?.domain_suffix === 'string' ? [r.domain_suffix] : [])

  return !(r?.outbound === 'direct' &&
    ds.some(d => appleDirectDomains.includes(d)))
})

const privateRuleIndex = config.route.rules.findIndex(r => r?.ip_is_private === true)

const appleDirectRule = {
  domain_suffix: appleDirectDomains,
  outbound: 'direct'
}

if (privateRuleIndex >= 0) {
  config.route.rules.splice(privateRuleIndex, 0, appleDirectRule)
} else {
  config.route.rules.push(appleDirectRule)
}

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

const localDns = config.dns?.servers?.find(s => s?.tag === 'local-dns')
if (!localDns) {
  throw new Error('缺少 local-dns，route.default_domain_resolver 会失效')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 WG 多分组回家配置生成（No FakeIP 稳定版）')
