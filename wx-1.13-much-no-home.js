// Windows sing-box 1.13.11 专用：机场多分组 no-home
// 不使用 http_clients / route.default_http_client
// 规则下载使用 download_detour: direct
// 关键：Proxy.default 必须默认第一个真实代理节点，不能是 direct / auto

log('🚀 开始')

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
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

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))]
}

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

// Windows 1.13.11 不使用 http_clients / default_http_client
delete config.http_clients

if (!config.route) config.route = {}
config.route.default_domain_resolver = 'local'
delete config.route.default_http_client

if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

// DNS servers 修正
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

// no-home：删除 home / wg-home
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

// 规则下载域名走 local，避免 rule-set 下载依赖 Proxy
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

// rule-set：1.13.11 使用 download_detour，不使用 http_client
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

// 删除旧注入节点、占位符、auto
config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'direct') return true
  if (o.tag === 'Proxy') return true
  if (o.tag === 'COMPATIBLE') return false
  if (o.tag === 'auto') return false
  if (o.tag === '__PROXY_PLACEHOLDER__') return false
  return !proxyTags.includes(o.tag)
})

// 多分组规则
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

// 清理各分组里的 auto / 占位符 / 旧重复项
config.outbounds.forEach(o => {
  if (Array.isArray(o.outbounds)) {
    o.outbounds = o.outbounds.filter(x =>
      x !== 'auto' &&
      x !== '__PROXY_PLACEHOLDER__' &&
      x !== 'home' &&
      x !== 'wg-home'
    )
  }
})

// 注入分组节点
config.outbounds.forEach(o => {
  outboundRules.forEach(([outboundRegex, tagRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) {
        o.outbounds = []
      }

      const tags = getTags(proxies, tagRegex)
      o.outbounds = uniq([
        ...o.outbounds,
        ...tags
      ])
    }
  })
})

// 空组兜底
const compatibleOutbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let hasCompatible = config.outbounds.some(o => o?.tag === 'COMPATIBLE')

config.outbounds.forEach(o => {
  outboundRules.forEach(([outboundRegex]) => {
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

// 注入代理节点
config.outbounds.push(...proxies)

// 修复 Proxy 主组
const proxyGroup = config.outbounds.find(o =>
  o?.tag === 'Proxy' &&
  Array.isArray(o?.outbounds)
)

if (!proxyGroup) {
  throw new Error('最终配置中 Proxy 组不存在或格式错误')
}

proxyGroup.outbounds = uniq([
  ...proxyTags,
  'direct'
])

// 关键修复：Proxy 默认必须是第一个真实代理节点，不能是 direct / auto
proxyGroup.default = proxyTags[0] || 'direct'

// 确保 direct 存在
if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// 修复其他 selector/urltest 的 default
config.outbounds.forEach(o => {
  if (
    (o?.type === 'selector' || o?.type === 'urltest') &&
    Array.isArray(o.outbounds)
  ) {
    o.outbounds = uniq(o.outbounds.filter(x =>
      x !== 'auto' &&
      x !== '__PROXY_PLACEHOLDER__' &&
      x !== 'home' &&
      x !== 'wg-home'
    ))

    if (o.tag !== 'Proxy') {
      if (!o.default || !o.outbounds.includes(o.default)) {
        o.default = o.outbounds[0]
      }
    }
  }
})

// 校验
if (
  proxyGroup.outbounds.includes('home') ||
  proxyGroup.outbounds.includes('wg-home') ||
  proxyGroup.outbounds.includes('auto') ||
  proxyGroup.outbounds.includes('__PROXY_PLACEHOLDER__')
) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home / wg-home / auto / placeholder')
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
  console.log(`[📦 Windows 1.13.11 no-home 多分组脚本] ${v}`)
}

log('✅ 完成')
