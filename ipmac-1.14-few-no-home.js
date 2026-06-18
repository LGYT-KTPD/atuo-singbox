// iPhone / Mac sing-box 1.14-alpha：自建少节点 no-home
// 融合 alpha.24 优点 + 局部 FakeIP 增强版

console.log('🚀 开始生成 no-home 配置（Partial FakeIP 增强版）')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config = parser.parse($content ?? $files[0])

function removeDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return rule

  delete rule.strategy

  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(removeDnsRuleStrategy)
  }

  return rule
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

function dedupe(arr) {
  return [...new Set((arr || []).filter(Boolean))]
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

// DNS servers
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
        stack: 'system',
        strict_route: true,
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
  o?.tag !== 'wg-home' &&
  o?.tag !== '__HOME_PLACEHOLDER__'
)

if (Array.isArray(config.route.rules)) {
  config.route.rules = config.route.rules.filter(r =>
    r?.outbound !== 'home' &&
    r?.outbound !== 'wg-home'
  )
}

if (!Array.isArray(config.route.rules)) config.route.rules = []

config.route.rules = config.route.rules.filter(r => {
  if (
    Array.isArray(r?.ip_cidr) &&
    r.ip_cidr.includes('198.18.0.0/15')
  ) {
    return false
  }
  return true
})

config.route.rules.splice(1, 0, {
  ip_cidr: [
    '198.18.0.0/15'
  ],
  outbound: 'Proxy'
})

// Apple 服务直连
const appleDirectDomains = [
  'apple.com',
  'icloud.com',
  'apple-dns.net',
  'push.apple.com',
  'itunes.apple.com',
  'mzstatic.com',
  'apps.apple.com',
  'appstore.com'
]

config.route.rules = config.route.rules.filter(r => {
  const ds = Array.isArray(r?.domain_suffix)
    ? r.domain_suffix
    : (typeof r?.domain_suffix === 'string' ? [r.domain_suffix] : [])

  return !(r?.outbound === 'direct' && ds.some(d => appleDirectDomains.includes(d)))
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
let proxies = url
  ? await produceArtifact({
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
  : await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: {
        'include-unsupported-proxy': includeUnsupportedProxy,
      },
    })

const proxyTags = proxies.map(p => p.tag)

if (proxyTags.length === 0) {
  throw new Error('没有获取到代理节点，无法生成 Proxy 组')
}

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

let proxyGroup = config.outbounds.find(o =>
  o?.tag === 'Proxy' &&
  o?.type === 'selector'
)

if (!proxyGroup) {
  proxyGroup = {
    tag: 'Proxy',
    type: 'selector',
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

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

// 校验
if (proxyGroup.outbounds.includes('home') || proxyGroup.outbounds.includes('wg-home')) {
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

console.log('✅ 完成 no-home 配置生成（Partial FakeIP 增强版）')
