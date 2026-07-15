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

applyAndroidStableOptimizations()


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

function removePublicDirect32RulesAndroid() {
  if (!Array.isArray(config.route?.rules)) return
  config.route.rules = config.route.rules.map(rule => {
    if (rule?.outbound !== 'DIRECT') return rule
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

function applyAndroidStableOptimizations() {
  delete config.http_clients

  if (!config.experimental) config.experimental = {}
  if (!config.experimental.cache_file) config.experimental.cache_file = {}
  if (!config.experimental.clash_api) config.experimental.clash_api = {}

  delete config.experimental.clash_api.external_ui_http_client
  config.experimental.clash_api.external_ui_download_detour = 'DIRECT'

  delete config.experimental.cache_file['store_' + 'dns']
  delete config.experimental.cache_file['store_' + 'fakeip']
  delete config.experimental.cache_file.store_rdrc
  delete config.experimental.cache_file.rdrc_timeout

  if (!config.dns) config.dns = {}
  if (!Array.isArray(config.dns.servers)) config.dns.servers = []
  if (!Array.isArray(config.dns.rules)) config.dns.rules = []

  delete config.dns.cache_capacity
  delete config.dns.optimistic
  delete config.dns.fakeip

  config.dns.final = 'ggdns'
  config.dns.strategy = 'ipv4_only'
  config.dns.reverse_mapping = true

  const predefined = {
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

  config.dns.servers = config.dns.servers.filter(s =>
    !['hosts_fix', 'local', 'ggdns', 'fakeip'].includes(s?.tag)
  )
  config.dns.servers.unshift(
    { type: 'hosts', tag: 'hosts_fix', predefined },
    { type: 'local', tag: 'local' },
    {
      type: 'https',
      tag: 'ggdns',
      detour: 'proxy',
      domain_resolver: 'hosts_fix',
      server: 'dns.google'
    }
  )
  config.dns.rules = config.dns.rules.filter(r => r?.server !== 'fakeip')

  if (!config.route) config.route = {}
  delete config.route.default_http_client
  config.route.default_domain_resolver = 'local'
  config.route.auto_detect_interface = true
  config.route.final = 'proxy'

  if (Array.isArray(config.route.rule_set)) {
    config.route.rule_set = config.route.rule_set
      .filter(rs => rs?.tag !== 'fakeip-filter')
      .map(rs => {
        delete rs.http_client
        if (rs?.type === 'remote') rs.download_detour = 'DIRECT'
        return rs
      })
  }

  config.route.rules = (config.route.rules || []).filter(r => {
    const t = JSON.stringify(r)
    if (r?.outbound === 'home' || r?.outbound === 'wg-home') return false
    if (r?.ip_cidr === '198.18.0.0/15') return false
    if (r?.action === 'reject' && (t.includes('"stun"') || t.includes('"turn"') || t.includes('"dtls"'))) return false
    return true
  })

  // Android 1.13.14 保留 QUIC Drop 与全局 IPv6 Reject。
  if (!config.route.rules.some(r => r?.protocol === 'quic' && r?.action === 'reject')) {
    config.route.rules.splice(2, 0, { protocol: 'quic', action: 'reject' })
  }
  if (!config.route.rules.some(r => r?.ip_version === 6 && r?.action === 'reject')) {
    config.route.rules.splice(3, 0, { ip_version: 6, action: 'reject' })
  }

  const resolveRules = config.route.rules.filter(r => r?.action === 'resolve')
  config.route.rules = config.route.rules.filter(r => r?.action !== 'resolve')
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
    ...resolveRules
  )

  config.inbounds = (config.inbounds || []).map(i => {
    if (i?.type !== 'tun') return i
    const next = {
      ...i,
      mtu: i.mtu || 1500,
      auto_route: true,
      strict_route: true,
      udp_timeout: i.udp_timeout || '5m0s',
      stack: 'mixed',
      endpoint_independent_nat: true
    }
    delete next.dns_mode
    delete next.dns_address
    return next
  })
}


function ensureAndroidMuchGroups(proxyTags) {
  const regionTags = ['HongKong', 'TaiWan', 'Singapore', 'Japan', 'America', 'Others']

  let autoGroup = config.outbounds.find(o => o?.tag === 'auto' && o?.type === 'urltest')
  if (!autoGroup) {
    autoGroup = {
      tag: 'auto',
      type: 'urltest',
      outbounds: [],
      url: 'http://www.gstatic.com/generate_204',
      interval: '3m',
      tolerance: 50,
      idle_timeout: '30m'
    }
    config.outbounds.push(autoGroup)
  }

  autoGroup.outbounds = uniq(proxyTags)
  if (!autoGroup.outbounds.length) throw new Error('auto 自动测速组没有可用代理节点')

  for (const tag of regionTags) {
    const group = config.outbounds.find(o => o?.tag === tag && o?.type === 'urltest')
    if (!group) throw new Error(`模板缺少地区测速组：${tag}`)
    group.outbounds = uniq((group.outbounds || []).filter(x => proxyTags.includes(x)))
    if (!group.outbounds.length) group.outbounds = [...proxyTags]
  }

  const proxyGroup = config.outbounds.find(o => o?.tag === 'proxy' && o?.type === 'selector')
  if (!proxyGroup) throw new Error('模板缺少 proxy selector')

  proxyGroup.outbounds = uniq(['auto', ...regionTags, ...proxyTags, 'DIRECT'])
  proxyGroup.default = 'auto'

  const defaults = {
    proxy: 'auto',
    OpenAI: 'America',
    Google: 'HongKong',
    Telegram: 'Singapore',
    Twitter: 'HongKong',
    Facebook: 'HongKong',
    BiliBili: 'DIRECT',
    Bahamut: 'TaiWan',
    Spotify: 'America',
    TikTok: 'Japan',
    Netflix: 'HongKong',
    'Disney+': 'HongKong',
    Apple: 'DIRECT',
    Microsoft: 'DIRECT',
    Games: 'DIRECT',
    Streaming: 'HongKong',
    Global: 'HongKong',
    China: 'DIRECT'
  }

  for (const [tag, preferred] of Object.entries(defaults)) {
    const group = config.outbounds.find(o => o?.tag === tag && o?.type === 'selector')
    if (!group) continue
    group.outbounds = uniq(group.outbounds || [])
    if (group.outbounds.includes(preferred)) group.default = preferred
    else if (!group.default || !group.outbounds.includes(group.default)) group.default = group.outbounds[0]
  }

  return proxyGroup
}

function validateAndroidMuchGroups() {
  const autoGroup = config.outbounds.find(o => o?.tag === 'auto' && o?.type === 'urltest')
  if (!autoGroup?.outbounds?.length) throw new Error('auto 自动测速组为空')

  const proxyGroup = config.outbounds.find(o => o?.tag === 'proxy' && o?.type === 'selector')
  if (!proxyGroup?.outbounds?.includes('auto')) throw new Error('proxy 组缺少 auto')
  if (proxyGroup.default !== 'auto') throw new Error('proxy.default 必须为 auto')

  for (const group of config.outbounds) {
    if (group?.type === 'urltest' && !group.outbounds?.length) {
      throw new Error(`${group.tag} 测速组为空`)
    }
    if (group?.type === 'selector') {
      if (!group.outbounds?.length) throw new Error(`${group.tag} 选择器为空`)
      if (!group.default || !group.outbounds.includes(group.default)) {
        throw new Error(`${group.tag} 默认值不存在：${group.default}`)
      }
    }
  }
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
  if (o.tag === 'AUTO') return false
  if (o.tag === 'auto') return true
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
    o.outbounds = o.outbounds.filter(x => x !== 'AUTO' && x !== '__PROXY_PLACEHOLDER__' && x !== 'home' && x !== 'wg-home')
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


config.outbounds.push(...proxies)

const proxyGroup = ensureAndroidMuchGroups(proxyTags)

const proxyDns = config.dns?.servers?.find(s => s?.tag === 'ggdns')
if (!proxyDns || proxyDns.detour !== 'proxy') throw new Error('DNS 服务器 ggdns 必须 detour 到 proxy')

removePublicDirect32RulesAndroid()

if (JSON.stringify(config).includes('store_dns')) throw new Error('Android 1.13.14 不支持 store_dns')
if (JSON.stringify(config).includes('"fakeip"')) throw new Error('RealIP 配置不应包含 fakeip')


if (config.http_clients !== undefined) throw new Error('Android 1.13.14 不支持 http_clients')
if (config.route?.default_http_client !== undefined) throw new Error('Android 1.13.14 不支持 route.default_http_client')
if (config.experimental?.clash_api?.external_ui_http_client !== undefined) {
  throw new Error('Android 1.13.14 不支持 external_ui_http_client')
}
if (JSON.stringify(config).includes('store_dns')) throw new Error('Android 1.13.14 不支持 store_dns')
if (config.dns?.cache_capacity !== undefined) throw new Error('Android 1.13.14 不使用 dns.cache_capacity')
if (config.dns?.optimistic !== undefined) throw new Error('Android 1.13.14 不使用 dns.optimistic')
if (config.inbounds?.some(i => i?.dns_mode !== undefined || i?.dns_address !== undefined)) {
  throw new Error('Android 1.13.14 TUN 不使用 dns_mode / dns_address')
}
if (config.route?.rule_set?.some(rs => rs?.type === 'remote' && rs?.download_detour !== 'DIRECT')) {
  throw new Error('Android 1.13.14 远程 rule-set 必须使用 download_detour=DIRECT')
}

validateAndroidMuchGroups()

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 Android 1.13.14 RealIP much no-home] ${v}`)
}

log('✅ 完成')
