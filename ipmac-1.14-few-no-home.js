// iPhone / Mac sing-box 1.14-alpha.21：自建少节点 no-home（增强稳定版）

console.log('🚀 开始生成 no-home 配置')

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

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

if (!config.dns) config.dns = {}
if (!config.route) config.route = {}
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

    if (s?.tag === 'public' && s?.domain_resolver === 'local') {
      return { ...s, domain_resolver: 'local-dns' }
    }

    return s
  })
}

// DNS rules 修正
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

// 递归删除 DNS rules 里废弃的 strategy
config.dns.rules = config.dns.rules.map(removeDnsRuleStrategy)

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

// 减少 iOS/macOS HTTPS/SVCB/PTR 查询噪音
const hasRejectQtypeRule = config.dns.rules.some(r =>
  Array.isArray(r?.query_type) &&
  r.query_type.includes('SVCB') &&
  r.query_type.includes('HTTPS') &&
  r.query_type.includes('PTR') &&
  r.action === 'reject'
)

if (!hasRejectQtypeRule) {
  config.dns.rules.unshift({
    query_type: [
      'SVCB',
      'HTTPS',
      'PTR'
    ],
    action: 'reject'
  })
}

// no-home：删除 home / __HOME_PLACEHOLDER__
config.outbounds = config.outbounds.filter(o =>
  o?.tag !== 'home' &&
  o?.tag !== '__HOME_PLACEHOLDER__'
)

if (Array.isArray(config.route.rules)) {
  config.route.rules = config.route.rules.filter(r =>
    r?.outbound !== 'home' &&
    r?.outbound !== 'wg-home'
  )
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

// 避免重复注入旧节点
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

// 修复 Proxy 组
const proxyGroup = config.outbounds.find(o =>
  o?.tag === 'Proxy' &&
  Array.isArray(o?.outbounds)
)

if (!proxyGroup) {
  throw new Error('模板中未找到 tag=Proxy 的 selector')
}

proxyGroup.outbounds = [
  ...proxyTags,
  'direct'
]

proxyGroup.default = proxyTags[0] || 'direct'

// 确保 direct 存在
if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// 删除 auto 旧组
config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

// 校验
if (proxyGroup.outbounds.includes('home') || proxyGroup.outbounds.includes('wg-home')) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home / wg-home')
}

const proxyDns = config.dns?.servers?.find(s =>
  s?.tag === 'google' ||
  s?.tag === 'proxy-dns'
)

if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error(`DNS 服务器 ${proxyDns.tag} 必须 detour 到 Proxy`)
}

const localDns = config.dns?.servers?.find(s => s?.tag === 'local-dns')
if (!localDns) {
  throw new Error('缺少 local-dns，route.default_domain_resolver 会失效')
}

$content = JSON.stringify(config, null, 2)

console.log('✅ 完成 no-home 配置生成（alpha.21 增强稳定版）')
