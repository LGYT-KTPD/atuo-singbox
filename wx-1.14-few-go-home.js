// Windows SFW sing-box 1.14.0-alpha.44：自建节点少节点 no-home
// alpha44：使用 http_clients / default_http_client，并吸收 PK alpha40-42 稳定优化

log('🚀 开始')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config



function removeDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return rule
  delete rule.strategy
  if (Array.isArray(rule.rules)) rule.rules = rule.rules.map(removeDnsRuleStrategy)
  return rule
}

function applyAlpha44PkOptimizations() {
  if (!config.experimental) config.experimental = {}
  if (!config.experimental.cache_file) config.experimental.cache_file = {}
  if (!config.experimental.clash_api) config.experimental.clash_api = {}
  if (!config.dns) config.dns = {}
  if (!config.route) config.route = {}
  if (!Array.isArray(config.dns.rules)) config.dns.rules = []
  if (!Array.isArray(config.route.rule_set)) config.route.rule_set = []
  if (!Array.isArray(config.http_clients)) config.http_clients = []

  delete config.experimental.clash_api.external_ui_download_detour
  config.experimental.clash_api.external_ui_http_client = 'direct-download'

  config.experimental.cache_file.enabled = true
  config.experimental.cache_file.store_dns = true
  delete config.experimental.cache_file.store_fakeip

  config.dns.reverse_mapping = true
  config.dns.strategy = 'prefer_ipv4'
  config.dns.timeout = '3s'
  config.dns.cache_capacity = 65536
  config.dns.optimistic = { enabled: true, timeout: '5m' }
  config.dns.final = 'proxy-dns'
  config.dns.rules = config.dns.rules.map(removeDnsRuleStrategy)

  config.http_clients = config.http_clients.filter(c =>
    !['direct-download', 'proxy-download'].includes(c?.tag)
  )
  config.http_clients.unshift(
    { tag: 'direct-download', version: 2 },
    { tag: 'proxy-download', version: 2, detour: 'Proxy' }
  )

  config.route.default_domain_resolver = 'local-dns'
  config.route.default_http_client = 'direct-download'

  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote') {
      delete rs.download_detour
    rs.http_client = 'direct-download'
    }
    return rs
  })

  if (Array.isArray(config.inbounds)) {
    config.inbounds = config.inbounds.map(i => {
      if (i?.type !== 'tun') return i
      return {
        ...i,
        stack: 'system',
        auto_route: true,
        strict_route: true,
        dns_mode: 'hijack',
        dns_address: '172.19.0.2',
        endpoint_independent_nat: true,
        udp_timeout: i.udp_timeout || '5m0s'
      }
    })
  }
}


function env(name, fallback = undefined) {
  const v = process?.env?.[name]
  if (v === undefined || v === null || String(v).trim() === '') return fallback
  return String(v).trim()
}
function envNumber(name, fallback = undefined) {
  const raw = env(name, fallback === undefined ? undefined : String(fallback))
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`${name} 必须是数字，当前值=${raw}`)
  return n
}
function envList(name, fallback = '') {
  return String(env(name, fallback) || '').split(',').map(s => s.trim()).filter(Boolean)
}
function requireEnv(names) {
  const missing = names.filter(n => !env(n))
  if (missing.length) throw new Error(`.env 缺少变量：${missing.join(', ')}`)
}
function applyWgHome() {
  requireEnv(['WG_PRIVATE_KEY','WG_PEER_ADDRESS','WG_PEER_PORT','WG_PEER_PUBLIC_KEY'])
  const homeCidrs = envList('WG_HOME_CIDRS', '192.168.1.0/24')
  const homeDomains = envList('WG_HOME_DOMAINS', 'ktpd.fun,xwcac68u.top')
  if (!Array.isArray(config.endpoints)) config.endpoints = []
  config.endpoints = config.endpoints.filter(e => e?.tag !== 'wg-home')
  config.endpoints.unshift({
    type:'wireguard',
    tag:'wg-home',
    system:false,
    address:envList('WG_ADDRESS', '10.14.0.2/32'),
    private_key:env('WG_PRIVATE_KEY'),
    mtu:envNumber('WG_MTU', 1420),
    peers:[{
      address:env('WG_PEER_ADDRESS'),
      port:envNumber('WG_PEER_PORT'),
      public_key:env('WG_PEER_PUBLIC_KEY'),
      allowed_ips:envList('WG_ALLOWED_IPS', homeCidrs.join(',')),
      persistent_keepalive_interval:envNumber('WG_KEEPALIVE', 25)
    }]
  })

  if (!Array.isArray(config.dns.servers)) config.dns.servers = []
  config.dns.servers = config.dns.servers.filter(s => s?.tag !== 'home-dns')
  config.dns.servers.push({
    tag:'home-dns', type:'udp',
    server:env('WG_HOME_DNS','192.168.1.118'),
    detour:'wg-home'
  })
  config.dns.rules = config.dns.rules.filter(r =>
    r?.server !== 'home-dns' && !JSON.stringify(r).includes('__WG_HOME_DOMAIN_PLACEHOLDER__')
  )
  if (homeDomains.length) {
    config.dns.rules.unshift({ domain_suffix:homeDomains, action:'route', server:'home-dns' })
  }

  config.route.rules = config.route.rules.filter(r =>
    r?.outbound !== 'wg-home' && !JSON.stringify(r).includes('__WG_HOME_DOMAIN_PLACEHOLDER__')
  )
  const homeRules = []
  if (homeDomains.length) homeRules.push({ domain_suffix:homeDomains, outbound:'wg-home' })
  if (homeCidrs.length) homeRules.push({ ip_cidr:homeCidrs, outbound:'wg-home' })
  const i = config.route.rules.findIndex(r => r?.ip_is_private === true)
  config.route.rules.splice(i >= 0 ? i : 0, 0, ...homeRules)
}

function isIPv4(value) {
  return typeof value === 'string' &&
    /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)
}

function isPublicIPv4(value) {
  if (!isIPv4(value)) return false

  const [a, b] = value.split('.').map(Number)

  if (a === 0 || a === 10 || a === 127) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 169 && b === 254) return false
  if (a >= 224) return false

  return true
}

function getProxyServerIPv4List(proxies) {
  const servers = []

  for (const proxy of proxies || []) {
    const candidates = [
      proxy?.server,
      proxy?.address,
      proxy?.host,
      proxy?.server_address
    ]

    for (const item of candidates) {
      if (isPublicIPv4(item)) {
        servers.push(item)
      }
    }
  }

  return [...new Set(servers)]
}

function ensureSelfBuiltServerDirectRule(proxies) {
  if (!config.route) config.route = {}
  if (!Array.isArray(config.route.rules)) config.route.rules = []

  const servers = getProxyServerIPv4List(proxies)

  if (!servers.length) {
    throw new Error('自建 VPS 配置未能从代理节点中提取 IPv4 server，无法生成 server/32 direct')
  }

  const managedCidrs = servers.map(server => `${server}/32`)

  config.route.rules = config.route.rules.filter(rule => {
    if (rule?.outbound !== 'direct') return true

    const ipCidr = rule?.ip_cidr

    if (typeof ipCidr === 'string') {
      return !managedCidrs.includes(ipCidr)
    }

    if (Array.isArray(ipCidr)) {
      return !ipCidr.some(item => managedCidrs.includes(item))
    }

    return true
  })

  const serverDirectRules = managedCidrs.map(cidr => ({
    ip_cidr: cidr,
    outbound: 'direct'
  }))

  config.route.rules.unshift(...serverDirectRules)
}

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

applyAlpha44PkOptimizations()
applyWgHome()

if (!config.experimental) config.experimental = {}
if (!config.experimental.clash_api) config.experimental.clash_api = {}
config.experimental.clash_api.external_ui_http_client = 'direct-download'

// alpha44：保留 http_clients

if (!config.route) config.route = {}
config.route.default_domain_resolver = 'local-dns'
// alpha44：保留 default_http_client

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
  r?.server === 'local-dns' &&
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
    server: 'local-dns'
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

    delete rs.download_detour
    rs.http_client = 'direct-download'

    if (rs?.type === 'remote') {
      rs.http_client = 'direct-download'
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

const localDns = config.dns?.servers?.find(s => s?.tag === 'local-dns')
if (!localDns) {
  throw new Error('缺少 local-dns，route.default_domain_resolver 会失效')
}

const homeDns = config.dns?.servers?.find(s => s?.tag === 'home-dns')
if (!homeDns || homeDns.detour !== 'wg-home') {
  throw new Error('home-dns 必须存在并 detour 到 wg-home')
}

const homeDnsRule = config.dns?.rules?.find(r =>
  r?.server === 'home-dns' &&
  Array.isArray(r?.domain_suffix) &&
  r.domain_suffix.length > 0
)
if (!homeDnsRule) {
  throw new Error('缺少内网域名 -> home-dns 规则')
}

const homeRouteRule = config.route?.rules?.find(r =>
  r?.outbound === 'wg-home' &&
  Array.isArray(r?.domain_suffix) &&
  r.domain_suffix.length > 0
)
if (!homeRouteRule) {
  throw new Error('缺少内网域名 -> wg-home 路由规则')
}



ensureSelfBuiltServerDirectRule(proxies)


const directDownloadClient = config.http_clients?.find(c => c?.tag === 'direct-download')
if (directDownloadClient?.detour !== undefined) {
  throw new Error('direct-download HTTP client 不应设置 detour；留空即直接连接')
}

if (config.route?.rule_set?.some(rs => rs?.download_detour !== undefined)) {
  throw new Error('alpha44 最终配置不应包含 download_detour')
}
if (config.dns?.servers?.some(s => s?.strategy !== undefined)) {
  throw new Error('Windows SFW 配置中 dns.servers 不支持 strategy 字段')
}

if (config.dns?.rules?.some(r => JSON.stringify(r).includes('"strategy"'))) {
  throw new Error('DNS rule action 中不应包含已弃用 strategy')
}

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Windows SFW 1.14-alpha44 final 自建节点 no-home 脚本] ${v}`)
}

log('✅ 完成')
