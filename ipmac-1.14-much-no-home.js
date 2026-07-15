// iPhone / Mac sing-box 1.14.0-alpha.44：机场多分组多节点 no-home
// RealIP + DNS Hijack + Resolve + Apple Direct + endpoint_independent_nat
// 保留 UDP/QUIC；仅拦截 STUN/TURN/DTLS

console.log('🚀 开始生成 iPhone / Mac much no-home 配置（alpha44）')

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

function dedupe(arr) {
  return [...new Set((arr || []).filter(Boolean))]
}

function removeDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return rule
  delete rule.strategy
  if (Array.isArray(rule.rules)) {
    rule.rules = rule.rules.map(removeDnsRuleStrategy)
  }
  return rule
}

function createTagRegExp(pattern) {
  return new RegExp(pattern.replace('ℹ️', ''), pattern.includes('ℹ️') ? 'i' : undefined)
}

function createOutboundRegExp(pattern) {
  return new RegExp(pattern.replace('ℹ️', ''), pattern.includes('ℹ️') ? 'i' : undefined)
}

function getTags(proxies, regex) {
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
}

function isPublicIPv4Cidr32(cidr) {
  if (typeof cidr !== 'string') return false
  const m = cidr.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/32$/)
  if (!m) return false
  const p = m[1].split('.').map(Number)
  if (p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  if (a >= 224) return false
  return true
}

function removePublicDirect32Rules() {
  config.route.rules = (config.route.rules || []).map(rule => {
    if (rule?.outbound !== 'direct') return rule
    const cidr = rule?.ip_cidr
    if (typeof cidr === 'string') {
      return isPublicIPv4Cidr32(cidr) ? null : rule
    }
    if (Array.isArray(cidr)) {
      const kept = cidr.filter(x => !isPublicIPv4Cidr32(x))
      if (!kept.length) return null
      if (kept.length !== cidr.length) return { ...rule, ip_cidr: kept }
    }
    return rule
  }).filter(Boolean)
}

function setSelectorDefault(tag, preferred) {
  const group = config.outbounds.find(o => o?.tag === tag && o?.type === 'selector')
  if (!group) return
  group.outbounds = dedupe(group.outbounds)
  if (preferred && group.outbounds.includes(preferred)) {
    group.default = preferred
  } else if (!group.default || !group.outbounds.includes(group.default)) {
    group.default = group.outbounds[0]
  }
}


function ensureMuchAutoAndRegionGroups(proxyTags) {
  const regionTags = ['HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others']

  const autoGroup = config.outbounds.find(o => o?.tag === 'auto' && o?.type === 'urltest')
  if (!autoGroup) throw new Error('模板缺少 auto 自动测速组')

  autoGroup.outbounds = dedupe(proxyTags)
  if (!autoGroup.outbounds.length) throw new Error('auto 自动测速组没有可用代理节点')

  for (const tag of regionTags) {
    const group = config.outbounds.find(o => o?.tag === tag && o?.type === 'urltest')
    if (!group) throw new Error(`模板缺少地区测速组：${tag}`)

    group.outbounds = dedupe(group.outbounds).filter(x => proxyTags.includes(x))
    if (!group.outbounds.length) group.outbounds = [...proxyTags]
  }
}

function enforceMuchProxySelector(proxyTags) {
  let proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')
  if (!proxyGroup) {
    proxyGroup = { tag: 'Proxy', type: 'selector', outbounds: [], default: 'auto' }
    config.outbounds.unshift(proxyGroup)
  }
  proxyGroup.outbounds = dedupe([
    'auto', 'HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others',
    ...proxyTags, 'direct'
  ])
  proxyGroup.default = 'auto'
  return proxyGroup
}

function validateMuchGroups() {
  const autoGroup = config.outbounds.find(o => o?.tag === 'auto' && o?.type === 'urltest')
  if (!autoGroup?.outbounds?.length) throw new Error('auto 自动测速组为空')

  const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')
  if (!proxyGroup?.outbounds?.includes('auto')) throw new Error('Proxy 组缺少 auto')
  if (proxyGroup.default !== 'auto') throw new Error('much 配置的 Proxy.default 必须是 auto')

  for (const group of config.outbounds) {
    if (group?.type === 'urltest' && !group.outbounds?.length) {
      throw new Error(`${group.tag} 测速组为空`)
    }
    if (group?.type !== 'selector') continue
    if (!group.outbounds?.length) throw new Error(`${group.tag} 选择器为空`)
    if (!group.default || !group.outbounds.includes(group.default)) {
      throw new Error(`${group.tag} 默认值不存在：${group.default}`)
    }
  }
}

function normalizeTemplate() {
  if (!config.experimental) config.experimental = {}
  if (!config.experimental.cache_file) config.experimental.cache_file = {}
  if (!config.experimental.clash_api) config.experimental.clash_api = {}
  if (!config.dns) config.dns = {}
  if (!config.route) config.route = {}
  if (!Array.isArray(config.dns.rules)) config.dns.rules = []
  if (!Array.isArray(config.outbounds)) config.outbounds = []
  if (!Array.isArray(config.route.rules)) config.route.rules = []
  if (!Array.isArray(config.route.rule_set)) config.route.rule_set = []

  // Apple 客户端不使用这两个 Clash UI 下载字段
  delete config.experimental.clash_api.external_ui_download_detour
  delete config.experimental.clash_api.external_ui_http_client

  config.experimental.cache_file.enabled = true
  config.experimental.cache_file.store_dns = true
  delete config.experimental.cache_file.store_fakeip

  config.dns.timeout = '3s'
  config.dns.strategy = 'prefer_ipv4'
  config.dns.cache_capacity = 65536
  config.dns.reverse_mapping = true
  config.dns.optimistic = { enabled: true, timeout: '5m' }
  config.dns.final = 'proxy-dns'

  config.http_clients = [{ tag: 'direct', version: 2 }]
  config.route.default_http_client = 'direct'
  config.route.default_domain_resolver = 'local-dns'
  config.route.auto_detect_interface = true
  config.route.final = 'Proxy'

  config.dns.servers = [
    {
      type: 'hosts',
      tag: 'hosts-fix',
      predefined: {
        'dns.google': ['8.8.8.8', '8.8.4.4'],
        'dns.alidns.com': ['223.5.5.5', '223.6.6.6'],
        'cloudflare-dns.com': ['104.16.248.249', '104.16.249.249'],
        'dns.cloudflare.com': ['104.16.248.249', '104.16.249.249'],
        'raw.githubusercontent.com': [
          '185.199.108.133',
          '185.199.109.133',
          '185.199.110.133',
          '185.199.111.133'
        ],
        'cdn.jsdelivr.net': ['104.16.89.20', '104.16.90.20']
      }
    },
    {
      type: 'local',
      tag: 'local',
      neighbor_domain: ['.local', '.lan']
    },
    { type: 'mdns', tag: 'mdns-server' },
    { tag: 'local-dns', type: 'udp', server: '223.5.5.5' },
    {
      tag: 'proxy-dns',
      type: 'tls',
      server: 'dns.google',
      server_port: 853,
      domain_resolver: 'hosts-fix',
      detour: 'Proxy'
    }
  ]

  config.dns.rules = config.dns.rules
    .map(removeDnsRuleStrategy)
    .filter(r => r?.server !== 'fakeip' && r?.server !== 'home-dns')

  const downloadDomains = [
    'testingcf.jsdelivr.net',
    'gh-proxy.com',
    'github.com',
    'raw.githubusercontent.com',
    'ghfast.top',
    'ghproxy.net',
    'cdn.jsdelivr.net'
  ]
  const wechatDomains = [
    'weixin.qq.com',
    'wx.qq.com',
    'wechat.com',
    'qpic.cn',
    'qlogo.cn',
    'gtimg.com',
    'tenpay.com',
    'url.cn',
    'weiyun.com',
    'mmbiz.qpic.cn',
    'mmbiz.qlogo.cn'
  ]

  if (!config.dns.rules.some(r => r?.server === 'local-dns' && Array.isArray(r?.domain_suffix) && r.domain_suffix.includes('cdn.jsdelivr.net'))) {
    config.dns.rules.push({ domain_suffix: downloadDomains, action: 'route', server: 'local-dns' })
  }
  if (!config.dns.rules.some(r => r?.server === 'local-dns' && Array.isArray(r?.domain_suffix) && r.domain_suffix.includes('weixin.qq.com'))) {
    config.dns.rules.push({ domain_suffix: wechatDomains, action: 'route', server: 'local-dns' })
  }

  config.inbounds = (config.inbounds || []).map(i => {
    if (i?.type !== 'tun') return i
    const next = {
      ...i,
      stack: 'system',
      auto_route: true,
      strict_route: true,
      dns_mode: 'hijack',
      dns_address: '172.19.0.2',
      endpoint_independent_nat: true,
      udp_timeout: i.udp_timeout || '5m0s'
    }
    if (next.platform?.http_proxy) delete next.platform.http_proxy
    if (next.platform && Object.keys(next.platform).length === 0) delete next.platform
    return next
  })

  delete config.endpoints
  config.outbounds = config.outbounds.filter(o =>
    !['home', 'wg-home', '__HOME_PLACEHOLDER__'].includes(o?.tag)
  )

  config.route.rules = config.route.rules.filter(r => {
    if (['home', 'wg-home'].includes(r?.outbound)) return false
    if (r?.action === 'route-options' || r?.action === 'resolve') return false
    if (r?.ip_version === 6 && r?.action === 'reject') return false
    const text = JSON.stringify(r)
    if (r?.action === 'reject' && (text.includes('"stun"') || text.includes('"turn"') || text.includes('"dtls"'))) return false
    if (r?.ip_cidr === '198.18.0.0/15') return false
    if (Array.isArray(r?.ip_cidr) && r.ip_cidr.includes('198.18.0.0/15')) {
      r.ip_cidr = r.ip_cidr.filter(x => x !== '198.18.0.0/15')
      if (!r.ip_cidr.length) return false
    }
    return true
  })

  const finalOnly = config.route.rules.filter(r =>
    r && typeof r === 'object' && Object.keys(r).length === 1 && r.outbound
  )
  config.route.rules = config.route.rules.filter(r =>
    !(r && typeof r === 'object' && Object.keys(r).length === 1 && r.outbound)
  )

  config.route.rules.unshift({
    type: 'logical',
    mode: 'and',
    rules: [
      { ip_version: 6 },
      { default_interface_address: '2000::/3', invert: true }
    ],
    action: 'reject'
  })

  config.route.rules.push(
    { protocol: ['stun', 'dtls'], action: 'reject' },
    {
      type: 'logical',
      mode: 'or',
      rules: [
        { network: 'udp', port: [3478, 5349, 5350, 19302, 10000] },
        { domain_regex: '^stun\\..+' },
        { domain_keyword: ['stun', 'turn', 'httpdns'] },
        { protocol: 'stun' }
      ],
      action: 'reject'
    },
    {
      action: 'route-options',
      udp_disable_domain_unmapping: true,
      udp_connect: true
    },
    { action: 'resolve' },
    ...finalOnly
  )

  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote') {
      delete rs.download_detour
      rs.http_client = 'direct'
      if (typeof rs.url === 'string') {
        rs.url = rs.url
          .replace('https://raw.githubusercontent.com/', 'https://ghfast.top/raw.githubusercontent.com/')
          .replace('https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/', 'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/')
          .replace('https://testingcf.jsdelivr.net/gh/Toperlock/sing-box-geosite@main/', 'https://ghfast.top/raw.githubusercontent.com/Toperlock/sing-box-geosite/main/')
      }
    }
    return rs
  })

  removePublicDirect32Rules()
}

normalizeTemplate()

let proxies
if (url) {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
    subscription: { name, url, source: 'remote' }
  })
} else {
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy }
  })
}

const proxyTags = proxies.map(p => p.tag)
if (!proxyTags.length) throw new Error('没有获取到代理节点')

const fixedGroupTags = [
  'Proxy', 'OpenAI', 'Google', 'Telegram', 'Twitter', 'Facebook',
  'BiliBili', 'Bahamut', 'Spotify', 'TikTok', 'Netflix', 'Disney+',
  'Apple', 'Microsoft', 'Games', 'Streaming', 'Global', 'China',
  'HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others',
  'auto', 'direct'
]

config.outbounds = config.outbounds.filter(o =>
  !o?.tag || fixedGroupTags.includes(o.tag) || !proxyTags.includes(o.tag)
)

const outboundRules = (outbound || '')
  .split('🕳')
  .filter(Boolean)
  .map(item => {
    const [outboundPattern, tagPattern = '.*'] = item.split('🏷')
    return [createOutboundRegExp(outboundPattern), createTagRegExp(tagPattern)]
  })

for (const group of config.outbounds) {
  if (!Array.isArray(group?.outbounds)) continue
  for (const [outboundRegex, tagRegex] of outboundRules) {
    if (outboundRegex.test(group.tag)) {
      group.outbounds = dedupe([...group.outbounds, ...getTags(proxies, tagRegex)])
    }
  }
}

config.outbounds.push(...proxies)

ensureMuchAutoAndRegionGroups(proxyTags)

let proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && o?.type === 'selector')
if (!proxyGroup) {
  proxyGroup = { tag: 'Proxy', type: 'selector', outbounds: [], default: 'auto' }
  config.outbounds.unshift(proxyGroup)
}
proxyGroup.outbounds = dedupe(['auto', ...proxyTags, 'direct'])
proxyGroup = enforceMuchProxySelector(proxyTags)

if (!config.outbounds.some(o => o?.tag === 'direct')) {
  config.outbounds.push({ type: 'direct', tag: 'direct' })
}

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
for (const [tag, preferred] of Object.entries(selectorDefaults)) {
  setSelectorDefault(tag, preferred)
}
for (const group of config.outbounds) {
  if (group?.type !== 'selector') continue
  group.outbounds = dedupe(group.outbounds)
  if (!group.default || !group.outbounds.includes(group.default)) {
    group.default = group.outbounds[0]
  }
}

const proxyDns = config.dns.servers.find(s => s?.tag === 'proxy-dns')
if (!proxyDns || proxyDns.detour !== 'Proxy') {
  throw new Error('proxy-dns 必须 detour 到 Proxy')
}
if (!config.dns.servers.some(s => s?.tag === 'local-dns')) {
  throw new Error('缺少 local-dns')
}
if (config.experimental?.clash_api?.external_ui_http_client !== undefined) {
  throw new Error('Apple 客户端不支持 external_ui_http_client')
}
if (config.experimental?.clash_api?.external_ui_download_detour !== undefined) {
  throw new Error('Apple 配置不应包含 external_ui_download_detour')
}
if (config.route.rule_set.some(rs => rs?.download_detour !== undefined)) {
  throw new Error('alpha44 不应包含 rule_set.download_detour')
}
if (config.route.rule_set.some(rs => rs?.type === 'remote' && rs?.http_client !== 'direct')) {
  throw new Error('远程 rule-set 必须使用 http_client=direct')
}
const directClient = config.http_clients.find(c => c?.tag === 'direct')
if (!directClient || directClient.detour !== undefined) {
  throw new Error('direct HTTP client 必须存在且不能设置 detour')
}
if (config.dns.servers.some(s => s?.strategy !== undefined)) {
  throw new Error('dns.servers 不应包含 strategy')
}
if (config.dns.rules.some(r => JSON.stringify(r).includes('"strategy"'))) {
  throw new Error('DNS rule action 不应包含 strategy')
}
if (config.route.rules.some(r => r?.protocol === 'quic' || (Array.isArray(r?.protocol) && r.protocol.includes('quic')))) {
  throw new Error('本配置保留 UDP/QUIC，不应加入 QUIC Drop')
}

validateMuchGroups()

$content = JSON.stringify(config, null, 2)
console.log('✅ 完成 iPhone / Mac much no-home 配置生成（alpha44）')
