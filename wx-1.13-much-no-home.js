// Windows 1.13.11 专用：机场多分组 no-home
// 不使用 http_clients / default_http_client
// 保留 download_detour: direct

log(`🚀 开始`)

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments
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

const outbounds = outbound
  .split('🕳')
  .filter(i => i)
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
    }
  })
})

const compatibleOutbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let hasCompatible = config.outbounds.some(o => o?.tag === 'COMPATIBLE')

config.outbounds.forEach(o => {
  outbounds.forEach(([outboundRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) {
        o.outbounds = []
      }

      if (o.outbounds.length === 0) {
        if (!hasCompatible) {
          config.outbounds.push(compatibleOutbound)
          hasCompatible = true
        }

        o.outbounds.push('COMPATIBLE')
      }
    }
  })
})

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy')
if (!proxyGroup || !Array.isArray(proxyGroup.outbounds)) {
  throw new Error('最终配置中 Proxy 组不存在或格式错误')
}

if (proxyGroup.outbounds.includes('home')) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home')
}

$content = JSON.stringify(config, null, 2)

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

function log(v) {
  console.log(`[📦 Windows 1.13 no-home 多分组脚本] ${v}`)
}

log(`✅ 完成`)
