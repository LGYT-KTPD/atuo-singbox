// Android sing-box 1.13.14：自建节点 few no-home（RealIP）
log('🚀 开始')

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
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
    const candidates = [proxy?.server, proxy?.address, proxy?.host, proxy?.server_address]
    for (const item of candidates) {
      if (isPublicIPv4(item)) servers.push(item)
    }
  }
  return [...new Set(servers)]
}

function ensureSelfBuiltServerDirectRule(proxies) {
  if (!config.route) config.route = {}
  if (!Array.isArray(config.route.rules)) config.route.rules = []
  const servers = getProxyServerIPv4List(proxies)
  if (!servers.length) throw new Error('未能从代理节点中提取 IPv4 server，无法生成 server/32 direct')
  const managedCidrs = servers.map(server => `${server}/32`)
  config.route.rules = config.route.rules.filter(rule => {
    if (rule?.outbound !== 'DIRECT') return true
    const ipCidr = rule?.ip_cidr
    if (typeof ipCidr === 'string') return !managedCidrs.includes(ipCidr)
    if (Array.isArray(ipCidr)) return !ipCidr.some(item => managedCidrs.includes(item))
    return true
  })
  config.route.rules.unshift(...managedCidrs.map(cidr => ({ ip_cidr: cidr, outbound: 'DIRECT' })))
}

function normalizeConfig() {
  delete config.http_clients

  if (config.experimental?.clash_api?.external_ui_http_client) {
    delete config.experimental.clash_api.external_ui_http_client
  }

  if (config.experimental?.cache_file) {
    delete config.experimental.cache_file['store_' + 'dns']
    delete config.experimental.cache_file['store_' + 'fakeip']
    delete config.experimental.cache_file.store_rdrc
    delete config.experimental.cache_file.rdrc_timeout
  }

  if (!config.dns) config.dns = {}
  if (!Array.isArray(config.dns.servers)) config.dns.servers = []
  if (!Array.isArray(config.dns.rules)) config.dns.rules = []

  delete config.dns.cache_capacity
  delete config.dns.optimistic
  delete config.dns.fakeip

  config.dns.servers = config.dns.servers.filter(s => s?.type !== 'fakeip' && s?.tag !== 'fakeip')
  config.dns.rules = config.dns.rules.filter(r => r?.server !== 'fakeip')
  config.dns.final = 'ggdns'
  config.dns.strategy = 'ipv4_only'
  config.dns.reverse_mapping = true

  if (!config.dns.servers.some(s => s?.tag === 'hosts_fix')) {
    config.dns.servers.unshift({ type: 'hosts', tag: 'hosts_fix', predefined: { 'dns.google': ['8.8.8.8', '8.8.4.4'] } })
  }
  if (!config.dns.servers.some(s => s?.tag === 'local')) {
    config.dns.servers.push({ type: 'local', tag: 'local' })
  }
  if (!config.dns.servers.some(s => s?.tag === 'ggdns')) {
    config.dns.servers.push({ type: 'https', tag: 'ggdns', detour: 'proxy', domain_resolver: 'hosts_fix', server: 'dns.google' })
  }
  config.dns.servers = config.dns.servers.map(s => {
    if (s?.tag === 'ggdns') return { ...s, type: 'https', detour: 'proxy', domain_resolver: 'hosts_fix', server: s.server || 'dns.google' }
    return s
  })

  if (!config.route) config.route = {}
  delete config.route.default_http_client
  config.route.default_domain_resolver = 'local'
  config.route.auto_detect_interface = true
  config.route.final = 'proxy'

  if (Array.isArray(config.route.rules)) {
    config.route.rules = config.route.rules.filter(r => r?.ip_cidr !== '198.18.0.0/15' && r?.outbound !== 'home' && r?.outbound !== 'wg-home')
  }

  if (Array.isArray(config.route.rule_set)) {
    config.route.rule_set = config.route.rule_set
      .filter(rs => rs?.tag !== 'fakeip-filter')
      .map(rs => {
        delete rs.http_client
        if (rs?.type === 'remote') rs.download_detour = 'DIRECT'
        return rs
      })
  }

  if (Array.isArray(config.outbounds)) {
    config.outbounds = config.outbounds.filter(o => o?.tag !== 'home' && o?.tag !== 'wg-home' && o?.tag !== '__HOME_PLACEHOLDER__')
  }

  if (Array.isArray(config.inbounds)) {
    config.inbounds = config.inbounds.map(i => {
      if (i?.type === 'tun' && i?.tag === 'tun-in') {
        const tun = { ...i, mtu: i.mtu || 1500, auto_route: true, strict_route: true, udp_timeout: i.udp_timeout || '5m0s', stack: i.stack || 'mixed', endpoint_independent_nat: true }
        delete tun.dns_mode
        delete tun.dns_address
        return tun
      }
      return i
    })
  }
}

normalizeConfig()

let proxies
if (url) {
  proxies = await produceArtifact({
    name, type, platform: 'sing-box', produceType: 'internal',
    produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
    subscription: { name, url, source: 'remote' },
  })
} else {
  proxies = await produceArtifact({
    name, type, platform: 'sing-box', produceType: 'internal',
    produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
  })
}

const proxyTags = proxies.map(p => p.tag)
if (proxyTags.length === 0) throw new Error('没有获取到代理节点')

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  if (o.tag === 'proxy') return true
  if (o.tag === 'DIRECT') return true
  if (o.tag === 'GLOBAL') return true
  if (o.tag === 'CN') return true
  if (o.tag === 'AUTO') return false
  if (o.tag === 'auto') return false
  if (o.tag === '__PROXY_PLACEHOLDER__') return false
  return !proxyTags.includes(o.tag)
})

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'proxy' && Array.isArray(o?.outbounds))
if (!proxyGroup) throw new Error('模板中未找到 tag=proxy 的 selector')

proxyGroup.outbounds = [...proxyTags, 'DIRECT']
proxyGroup.default = proxyTags[0] || 'DIRECT'
if (proxyGroup.outbounds[0] === 'DIRECT') throw new Error('proxy 组第一个不能是 DIRECT')

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'ggdns')
if (!proxyDns || proxyDns.detour !== 'proxy') throw new Error('DNS 服务器 ggdns 必须 detour 到 proxy')

ensureSelfBuiltServerDirectRule(proxies)

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Android 1.13.14 RealIP few no-home] ${v}`)
}

log('✅ 完成')
