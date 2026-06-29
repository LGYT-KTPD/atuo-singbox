// Windows sing-box 1.13.14 专用：机场多分组 no-home
// 不使用 http_clients / route.default_http_client
// 不使用 selector.default / urltest.default
// 规则下载使用 download_detour: direct
// 默认节点由 outbounds 数组第一个真实代理节点决定

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


function ensureTunDnsHijack() {
  if (!Array.isArray(config.inbounds)) return

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

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

// Windows 1.13.14 不支持这些
delete config.http_clients

if (!config.route) config.route = {}
config.route.default_domain_resolver = 'local'
delete config.route.default_http_client

if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

// DNS-v2：正常运行默认 DNS 走代理 DNS google，local 只用于启动、下载、CN、微信等例外
config.dns.final = 'google'
config.dns.strategy = 'prefer_ipv4'
config.dns.reverse_mapping = true
config.dns.timeout = '3s'
config.dns.cache_capacity = 65536

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

// 删除所有 1.13.11 不支持的 default 字段
if (Array.isArray(config.outbounds)) {
  config.outbounds = config.outbounds.map(o => {
    if (o && typeof o === 'object') {
      delete o.default
    }
    return o
  })
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

// rule-set：1.13.14 使用 download_detour，不使用 http_client
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

// 清理各分组里的 auto / 占位符 / home / wg-home / 旧 default
config.outbounds.forEach(o => {
  if (o && typeof o === 'object') {
    delete o.default
  }

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

// Windows 1.13.14 默认由 outbounds 第一个节点决定
proxyGroup.outbounds = uniq([
  ...proxyTags,
  'direct'
])

delete proxyGroup.default

// 确保 direct 存在
if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({
    type: 'direct',
    tag: 'direct'
  })
}

// 最后兜底：删除所有 selector/urltest 的 default
config.outbounds.forEach(o => {
  if (o && typeof o === 'object') {
    delete o.default
  }

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

if (proxyGroup.outbounds[0] === 'direct') {
  throw new Error('Proxy 组第一个不能是 direct，否则国外流量会直连')
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

ensureTunDnsHijack()
removePublicDirect32Rules()

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Windows 1.13.14 DNS-v2 no-home 多分组脚本] ${v}`)
}

log('✅ 完成')
