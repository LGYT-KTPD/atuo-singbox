// iPhone / Mac sing-box 1.14-alpha：机场多分组多节点 no-home
// 融合 alpha.24 优点 + 局部 FakeIP + 每个 selector 默认选项

console.log('🚀 开始生成多分组 no-home 配置（Partial FakeIP 增强版）')

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
config.experimental.cache_file.store_fakeip = true

// DNS 全局增强
config.dns.timeout = '3s'
config.dns.strategy = 'prefer_ipv4'
config.dns.cache_capacity = 32768
config.dns.reverse_mapping = true
config.dns.optimistic = true
config.dns.final = 'proxy-dns'

// 1.14 启动下载解耦
config.http_clients = config.http_clients.filter(c => c?.tag !== 'direct')
config.http_clients.unshift({
  tag: 'direct'
})

config.route.default_http_client = 'direct'
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
  },
  {
    type: 'fakeip',
    tag: 'fakeip',
    inet4_range: '198.18.0.0/15'
  }
)

// tun-in DNS hijack
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

// 局部 FakeIP：Google / YouTube / GV
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
  server: 'fakeip'
})

// 局部 FakeIP：Telegram
config.dns.rules.splice(1, 0, {
  domain_suffix: [
    'telegram.org',
    't.me',
    'tdesktop.com',
    'telegra.ph'
  ],
  action: 'route',
  server: 'fakeip'
})

// 局部 FakeIP：GitHub
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
  server: 'fakeip'
})

// 局部 FakeIP：OpenAI / ChatGPT
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
  server: 'fakeip'
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

// 删除旧 fakeip 路由，下面重建
config.route.rules = config.route.rules.filter(r => {
  if (
    Array.isArray(r?.ip_cidr) &&
    r.ip_cidr.includes('198.18.0.0/15')
  ) {
    return false
  }
  return true
})

// FakeIP 必须走 Proxy
config.route.rules.splice(1, 0, {
  ip_cidr: [
    '198.18.0.0/15'
  ],
  outbound: 'Proxy'
})

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

const fakeipDns = config.dns?.servers?.find(s => s?.tag === 'fakeip')
if (!fakeipDns) {
  throw new Error('缺少 fakeip DNS server')
}

const fakeipRoute = config.route.rules.find(r =>
  Array.isArray(r?.ip_cidr) &&
  r.ip_cidr.includes('198.18.0.0/15') &&
  r.outbound === 'Proxy'
)

if (!fakeipRoute) {
  throw new Error('缺少 FakeIP 路由：198.18.0.0/15 -> Proxy')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成多分组 no-home 配置生成（Partial FakeIP 增强版）')
