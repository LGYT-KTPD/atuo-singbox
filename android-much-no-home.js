// Android sing-box 1.13.14：机场多节点 much no-home（RealIP）
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

function createTagRegExp(tagPattern) {
  return new RegExp(tagPattern.replace('ℹ️', ''), tagPattern.includes('ℹ️') ? 'i' : undefined)
}

function createOutboundRegExp(outboundPattern) {
  return new RegExp(outboundPattern.replace('ℹ️', ''), outboundPattern.includes('ℹ️') ? 'i' : undefined)
}

function getTags(proxies, regex) {
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))]
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
  if (['proxy', 'DIRECT', 'CN', 'Global', 'OpenAI', 'Google', 'Telegram', 'Twitter', 'Facebook', 'BiliBili', 'Bahamut', 'Spotify', 'TikTok', 'Netflix', 'Disney+', 'Apple', 'Microsoft', 'Games', 'Streaming', 'HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others'].includes(o.tag)) return true
  if (o.tag === 'AUTO' || o.tag === 'auto') return false
  if (o.tag === '__PROXY_PLACEHOLDER__') return false
  return !proxyTags.includes(o.tag)
})

const outboundRules = (outbound || '')
  .split('🕳')
  .filter(Boolean)
  .map(i => {
    let [outboundPattern, tagPattern = '.*'] = i.split('🏷')
    return [createOutboundRegExp(outboundPattern), createTagRegExp(tagPattern)]
  })

config.outbounds.forEach(o => {
  if (Array.isArray(o.outbounds)) {
    o.outbounds = o.outbounds.filter(x => x !== 'auto' && x !== 'AUTO' && x !== '__PROXY_PLACEHOLDER__' && x !== 'home' && x !== 'wg-home')
  }
})

config.outbounds.forEach(o => {
  outboundRules.forEach(([outboundRegex, tagRegex]) => {
    if (outboundRegex.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) o.outbounds = []
      o.outbounds = uniq([...o.outbounds, ...getTags(proxies, tagRegex)])
    }
  })
})

for (const groupTag of ['HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others']) {
  const group = config.outbounds.find(o => o?.tag === groupTag && Array.isArray(o.outbounds))
  if (group && group.outbounds.length === 0) {
    group.outbounds = [...proxyTags]
  }
}

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'proxy' && Array.isArray(o?.outbounds))
if (!proxyGroup) throw new Error('模板中未找到 tag=proxy 的 selector')

proxyGroup.outbounds = uniq(['Global', ...proxyTags, 'DIRECT'])
proxyGroup.default = proxyGroup.outbounds[0]

if (proxyGroup.outbounds[0] === 'DIRECT') throw new Error('proxy 组第一个不能是 DIRECT')

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'ggdns')
if (!proxyDns || proxyDns.detour !== 'proxy') throw new Error('DNS 服务器 ggdns 必须 detour 到 proxy')

if (JSON.stringify(config).includes('store_dns')) throw new Error('Android 1.13.14 不支持 store_dns')
if (JSON.stringify(config).includes('"fakeip"')) throw new Error('RealIP 配置不应包含 fakeip')

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Android 1.13.14 RealIP much no-home] ${v}`)
}

log('✅ 完成')
