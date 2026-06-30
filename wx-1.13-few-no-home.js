// Windows sing-box 1.13.14 稳定版：自建节点少节点 no-home
// 1.13.14 不使用 http_clients / route.default_http_client
// 规则下载使用 download_detour: direct

log('🚀 开始')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config


function isIPv4(value) {
  return typeof value === 'string' &&
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)
}

function ensureSelfBuiltServerDirectRule(proxies) {
  if (!config.route) config.route = {}
  if (!Array.isArray(config.route.rules)) config.route.rules = []

  const serverDirectRules = []

  for (const proxy of proxies || []) {
    const server = proxy?.server
    if (!isIPv4(server)) continue

    serverDirectRules.push({
      ip_cidr: `${server}/32`,
      outbound: 'direct'
    })
  }

  if (!serverDirectRules.length) return

  const managedCidrs = serverDirectRules.map(rule => rule.ip_cidr)

  config.route.rules = config.route.rules.filter(rule => {
    if (rule?.outbound !== 'direct') return true

    const ipCidr = rule?.ip_cidr
    if (typeof ipCidr === 'string') return !managedCidrs.includes(ipCidr)
    if (Array.isArray(ipCidr)) return !ipCidr.some(item => managedCidrs.includes(item))

    return true
  })

  config.route.rules.unshift(...serverDirectRules)
}

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

delete config.http_clients

if (!config.route) config.route = {}
config.route.default_domain_resolver = 'local'
delete config.route.default_http_client

if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

if (Array.isArray(config.dns.servers)) {
  config.dns.servers = config.dns.servers.map(s => {
    if (s?.tag === 'google' || s?.tag === 'proxy-dns') {
      return {
        ...s,
        detour: 'Proxy'
      }
    }

    if (s?.tag === 'public') {
      return {
        ...s,
        domain_resolver: 'local'
      }
    }

    return s
  })
}

if (Array.isArray(config.outbounds)) {
  config.outbounds = config.outbounds.filter(o =>
    o?.tag !== 'home' &&
    o?.tag !== '__HOME_PLACEHOLDER__' &&
    o?.tag !== 'wg-home'
  )
}

if (Array.isArray(config.route.rules)) {
  config.route.rules = config.route.rules.filter(r =>
    r?.outbound !== 'home' &&
    r?.outbound !== 'wg-home'
  )
}

const downloadDomains = [
  'ghfast.top',
  'raw.githubusercontent.com',
  'github.com',
  'gh-proxy.com',
  'ghproxy.net',
  'testingcf.jsdelivr.net',
  'cdn.jsdelivr.net'
]

let downloadDnsRule = config.dns.rules.find(r =>
  r?.server === 'local' &&
  Array.isArray(r?.domain_suffix) &&
  (
    r.domain_suffix.includes('ghfast.top') ||
    r.domain_suffix.includes('testingcf.jsdelivr.net') ||
    r.domain_suffix.includes('raw.githubusercontent.com')
  )
)

if (!downloadDnsRule) {
  downloadDnsRule = {
    domain_suffix: [],
    action: 'route',
    server: 'local',
    strategy: 'ipv4_only'
  }

  config.dns.rules.splice(
    Math.min(2, config.dns.rules.length),
    0,
    downloadDnsRule
  )
}

downloadDomains.forEach(d => {
  if (!downloadDnsRule.domain_suffix.includes(d)) {
    downloadDnsRule.domain_suffix.push(d)
  }
})

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

    delete rs.http_client

    if (rs?.type === 'remote') {
      rs.download_detour = 'direct'
    }

    return rs
  })
}

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

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'direct') return true
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

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

// 关键修复：Windows 自建节点 no-home 默认必须走第一个代理节点，不能默认 direct
proxyGroup.default = proxyTags[0] || 'direct'

config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

const proxyGroupCheck = config.outbounds.find(o => o?.tag === 'Proxy')

if (!proxyGroupCheck || !Array.isArray(proxyGroupCheck.outbounds)) {
  throw new Error('最终配置中缺少有效的 Proxy selector')
}

if (proxyGroupCheck.outbounds.length === 0) {
  throw new Error('最终配置中 Proxy 组为空')
}

if (proxyGroupCheck.outbounds.includes('auto')) {
  throw new Error('最终配置中 Proxy 组不应包含 auto')
}

if (
  proxyGroupCheck.outbounds.includes('home') ||
  proxyGroupCheck.outbounds.includes('wg-home')
) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home / wg-home')
}

const proxyDns = config.dns?.servers?.find(s =>
  s?.tag === 'google' ||
  s?.tag === 'proxy-dns'
)

if (proxyDns && proxyDns.detour !== 'Proxy') {
  throw new Error(`DNS 服务器 ${proxyDns.tag} 必须 detour 到 Proxy`)
}

const localDns = config.dns?.servers?.find(s => s?.tag === 'local')
if (!localDns) {
  throw new Error('缺少 local DNS，route.default_domain_resolver 会失效')
}

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Windows 1.13.14 stable 自建节点 no-home 脚本] ${v}`)
}

log('✅ 完成')
