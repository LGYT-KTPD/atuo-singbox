// iPhone / Mac sing-box 1.14.0-alpha.36：机场多分组多节点 no-home
// RealIP DNS-v2 alpha36 长期版：DoT + DNS Hijack + Sniff + Apple Direct 扩大 + endpoint_independent_nat

console.log('🚀 开始生成多分组 no-home 配置（RealIP DNS-v2 alpha36 长期版）')

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

function removeDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return rule

  delete rule.strategy

  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(removeDnsRuleStrategy)
  }

  return rule
}

function getTags(proxies, regex) {
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
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

function dedupe(arr) {
  return [...new Set((arr || []).filter(Boolean))]
}

function setSelectorDefault(tag, preferred) {
  const o = config.outbounds.find(x => x?.tag === tag && x?.type === 'selector')
  if (!o) return

  if (!Array.isArray(o.outbounds)) o.outbounds = []
  o.outbounds = dedupe(o.outbounds)

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


function isPublicIPv4Cidr32(cidr) {
  if (typeof cidr !== 'string') return false

  const match = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/32$/)
  if (!match) return false

  const parts = match[1].split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false

  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  if (a >= 224) return false

  return true
}

function removePublicDirect32Rules() {
  if (!config.route) config.route = {}
  if (!Array.isArray(config.route.rules)) config.route.rules = []

  config.route.rules = config.route.rules
    .map(rule => {
      if (rule?.outbound !== 'direct') return rule

      const ipCidr = rule?.ip_cidr

      if (typeof ipCidr === 'string') {
        return isPublicIPv4Cidr32(ipCidr) ? null : rule
      }

      if (Array.isArray(ipCidr)) {
        const kept = ipCidr.filter(item => !isPublicIPv4Cidr32(item))
        if (kept.length === 0) return null
        if (kept.length !== ipCidr.length) return { ...rule, ip_cidr: kept }
      }

      return rule
    })
    .filter(Boolean)
}

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

if (!config.experimental) config.experimental = {}
if (!config.experimental.cache_file) config.experimental.cache_file = {}

if (!config.dns) config.dns = {}
if (!config.route) config.route = {}

if (!Array.isArray(config.dns.servers)) config.dns.servers = []
if (!Array.isArray(config.dns.rules)) config.dns.rules = []
if (!Array.isArray(config.outbounds)) config.outbounds = []
if (!Array.isArray(config.http_clients)) config.http_clients = []

// cache_file
config.experimental.cache_file.enabled = true
config.experimental.cache_file.store_dns = true
delete config.experimental.cache_file.store_fakeip

// DNS 全局增强
config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 65536
config.dns.reverse_mapping = true
config.dns.optimistic = {
  enabled: true,
  timeout: '1h0m0s'
}
config.dns.final = 'proxy-dns'

// 1.14 启动下载解耦
config.http_clients = config.http_clients.filter(c => c?.tag !== 'direct')
config.http_clients.unshift({
  tag: 'direct',
  version: 2
})

config.route.default_http_client = 'direct'
// route 解析器仍走 local-dns：用于启动期、rule-set 下载、直连域名解析；不作为 DNS final
config.route.default_domain_resolver = 'local-dns'

// DNS servers 重建
config.dns.servers = config.dns.servers.filter(s =>
  ![
    'google',
    'public',
    'hosts-fix',
    'local',
    'mdns-server',
    'local-dns',
    'proxy-dns',
    'fakeip',
    'home-dns'
  ].includes(s?.tag)
)

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
    tag: 'proxy-dns',
    type: 'tls',
    server: 'dns.google',
    server_port: 853,
    domain_resolver: 'hosts-fix',
    detour: 'Proxy'
  }
)

// tun-in DNS hijack，并删除 platform.http_proxy，避免 TUN + 系统 HTTP 代理叠加
if (Array.isArray(config.inbounds)) {
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
}

// DNS rules 清理
config.dns.rules = config.dns.rules
  .map(removeDnsRuleStrategy)
  .filter(r => {
    if (r?.ip_cidr && !r?.match_response) return false
    if (r?.server === 'fakeip') return false
    if (r?.server === 'home-dns') return false
    return true
  })
  .map(r => {
    if (r?.server === 'local') return { ...r, server: 'local-dns' }
    if (r?.server === 'google') return { ...r, server: 'proxy-dns' }
    return r
  })

// 删除旧 query_type reject，下面统一重建
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

// Google / YouTube / GV：走 proxy-dns
config.dns.rules.unshift({
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

// Telegram：走 proxy-dns
config.dns.rules.splice(1, 0, {
  domain_suffix: [
    'telegram.org',
    't.me',
    'tdesktop.com',
    'telegra.ph'
  ],
  action: 'route',
  server: 'proxy-dns'
})

// GitHub：走 proxy-dns
config.dns.rules.splice(2, 0, {
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

// OpenAI / ChatGPT：走 proxy-dns
config.dns.rules.splice(3, 0, {
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

// DNS 噪音 reject
config.dns.rules.splice(4, 0, {
  query_type: [
    'SVCB',
    'HTTPS',
    'PTR'
  ],
  action: 'reject'
})

// no-home：删除 home / wg-home
config.outbounds = config.outbounds.filter(o =>
  o?.tag !== 'home' &&
  o?.tag !== '__HOME_PLACEHOLDER__' &&
  o?.tag !== 'wg-home'
)

if (Array.isArray(config.route.rules)) {
  config.route.rules = config.route.rules.filter(r =>
    r?.outbound !== 'home' &&
    r?.outbound !== 'wg-home'
  )
}

// route.rules
if (!Array.isArray(config.route.rules)) config.route.rules = []

// 删除旧 FakeIP 路由：198.18.0.0/15
config.route.rules = config.route.rules.filter(r => {
  if (
    Array.isArray(r?.ip_cidr) &&
    r.ip_cidr.includes('198.18.0.0/15')
  ) {
    return false
  }
  return true
})

// Apple 服务直连：放在 ip_is_private 之前
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

// rule-set 修正
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
        )
        .replace(
          'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/',
          'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/'
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

// 获取代理节点
let proxies

if (url) {
  proxies = await produceArtifact({
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
} else {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy
    },
  })
}

const proxyTags = proxies.map(p => p.tag)

if (proxyTags.length === 0) {
  throw new Error('没有获取到代理节点')
}

// 避免重复注入旧节点
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

// 多分组注入
const outbounds = (outbound || '')
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
  outbounds.forEach(([outboundRegex, tagRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) {
        o.outbounds = []
      }

      const tags = getTags(proxies, tagRegex)
      o.outbounds.push(...tags)
      o.outbounds = dedupe(o.outbounds)
    }
  })
})

// 空组兜底
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

  o.outbounds = dedupe(o.outbounds)

  if (o.outbounds.includes('home') || o.outbounds.includes('wg-home')) {
    o.outbounds = o.outbounds.filter(x => x !== 'home' && x !== 'wg-home')
  }

  if (o.outbounds.length === 0) {
    if (!hasCompatible) {
      config.outbounds.push(compatibleOutbound)
      hasCompatible = true
    }

    o.outbounds.push('COMPATIBLE')
  }
})

// 注入代理节点
config.outbounds.push(...proxies)

// 修复 Proxy 组
let proxyGroup = config.outbounds.find(o =>
  o?.tag === 'Proxy' &&
  o?.type === 'selector'
)

if (!proxyGroup) {
  proxyGroup = {
    tag: 'Proxy',
    type: 'selector',
    outbounds: [],
    default: 'auto'
  }
  config.outbounds.unshift(proxyGroup)
}

proxyGroup.outbounds = dedupe([
  'auto',
  ...proxyTags,
  'direct'
])

// 确保 direct 存在
if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// 每个 selector 设置默认值
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

// 其他 selector 自动设置第一个可用出站
config.outbounds.forEach(o => {
  if (o?.type !== 'selector') return

  if (!Array.isArray(o.outbounds)) o.outbounds = []
  o.outbounds = dedupe(o.outbounds)

  if (!o.default || !o.outbounds.includes(o.default)) {
    o.default = o.outbounds[0]
  }
})

// 校验
if (
  proxyGroup.outbounds.includes('home') ||
  proxyGroup.outbounds.includes('wg-home')
) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home / wg-home')
}

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'proxy-dns')
if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error('proxy-dns 必须 detour 到 Proxy')
}

const localDns = config.dns?.servers?.find(s => s?.tag === 'local-dns')
if (!localDns) {
  throw new Error('缺少 local-dns，route.default_domain_resolver 会失效')
}

removePublicDirect32Rules()

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成多分组 no-home 配置生成（RealIP DNS-v2 alpha36 长期版）')
