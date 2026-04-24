// Windows 1.13.11 专用：自建节点少节点 no-home
// 不使用 http_clients / default_http_client
// 保留 download_detour: direct

log(`🚀 开始`)

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

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

if (Array.isArray(config.outbounds)) {
  config.outbounds = config.outbounds.filter(o =>
    o?.tag !== 'home' && o?.tag !== '__HOME_PLACEHOLDER__'
  )
}

if (Array.isArray(config.route.rules)) {
  config.route.rules = config.route.rules.filter(r => r?.outbound !== 'home')
}

if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

const downloadDomains = [
  'ghfast.top',
  'raw.githubusercontent.com',
  'github.com',
  'gh-proxy.com',
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
  config.dns.rules.splice(Math.min(2, config.dns.rules.length), 0, downloadDnsRule)
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

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && Array.isArray(o?.outbounds))

if (!proxyGroup) {
  throw new Error('模板中未找到 tag=Proxy 的 selector')
}

proxyGroup.outbounds = [...proxyTags, 'direct']

if (!proxyGroup.outbounds.length) {
  proxyGroup.outbounds = ['direct']
}

if (!proxyGroup.default || !proxyTags.includes(proxyGroup.default)) {
  proxyGroup.default = proxyTags[0] || 'direct'
}

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

if (proxyGroupCheck.outbounds.includes('home')) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home')
}

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Windows 1.13 自建节点 no-home 脚本] ${v}`)
}

log(`✅ 完成`)
