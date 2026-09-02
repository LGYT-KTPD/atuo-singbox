// OpenWrt / momo 专用 Sub-Store 自动注入脚本
// 目标：sing-box 1.14.0 + momo
//
// 参数：
// name=你的订阅名&type=subscription
// name=你的组合订阅名&type=collection
// url=https://example.com/sub&type=subscription&name=remote

log(`🚀 开始生成 momo sing-box 配置`)

let { type, name, includeUnsupportedProxy, url } = $arguments

type = /^1$|col|collection|组合/i.test(type || '')
  ? 'collection'
  : 'subscription'

const parser = ProxyUtils.JSON5 || JSON

let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`模板文件不是合法 JSON/JSON5`)
}

if (!name && !url) {
  throw new Error(`缺少参数：必须传入 name=订阅名，或 url=订阅链接`)
}

log(`① 获取订阅：type=${type}, name=${name || 'remote-url'}`)

let rawArtifact

if (url) {
  rawArtifact = await produceArtifact({
    name: name || 'remote-url',
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
    subscription: {
      name: name || 'remote-url',
      url,
      source: 'remote',
    },
  })
} else {
  rawArtifact = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })
}

let generated
try {
  generated = JSON.parse(rawArtifact)
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`Sub-Store 生成的 sing-box 配置不是合法 JSON`)
}

const generatedOutbounds = Array.isArray(generated.outbounds)
  ? generated.outbounds
  : []

const generatedEndpoints = Array.isArray(generated.endpoints)
  ? generated.endpoints
  : []

log(`② 获取到 outbounds=${generatedOutbounds.length}, endpoints=${generatedEndpoints.length}`)

if (!Array.isArray(config.outbounds)) {
  config.outbounds = []
}

if (!Array.isArray(config.endpoints)) {
  config.endpoints = []
}

const reservedOutboundTags = new Set([
  '🚀 默认代理',
  '🐸 手动选择',
  '♻️ 自动选择',
  'GLOBAL',
  '🎯 全球直连',
  'COMPATIBLE',
])

const defaultGroup = findOutbound(config, '🚀 默认代理')
const manualGroup = findOutbound(config, '🐸 手动选择')
const autoGroup = findOutbound(config, '♻️ 自动选择')
const globalGroup = findOutbound(config, 'GLOBAL')

if (!defaultGroup) throw new Error(`模板缺少 outbound：🚀 默认代理`)
if (!manualGroup) throw new Error(`模板缺少 outbound：🐸 手动选择`)
if (!autoGroup) throw new Error(`模板缺少 outbound：♻️ 自动选择`)

ensureOutbounds(defaultGroup)
ensureOutbounds(manualGroup)
ensureOutbounds(autoGroup)
if (globalGroup) ensureOutbounds(globalGroup)

// 记录上一次注入到选择组里的节点，用于清理已失效订阅节点。
// 只清理选择组曾引用过的标签，避免误删模板中手工维护的静态出站。
const previousInjectedTags = new Set([
  ...manualGroup.outbounds,
  ...autoGroup.outbounds,
].filter(tag => typeof tag === 'string' && !reservedOutboundTags.has(tag)))

const allGeneratedTags = new Set()

const cleanOutbounds = sanitizeGeneratedItems(
  generatedOutbounds,
  'outbound',
  allGeneratedTags
)

const cleanEndpoints = sanitizeGeneratedItems(
  generatedEndpoints,
  'endpoint',
  allGeneratedTags
)

let injectedTags = [
  ...cleanOutbounds.map(o => o.tag),
  ...cleanEndpoints.map(e => e.tag),
]

injectedTags = [...new Set(injectedTags)]

log(`③ 有效可注入节点数量：${injectedTags.length}`)

if (!findOutbound(config, '🎯 全球直连')) {
  config.outbounds.push({
    tag: '🎯 全球直连',
    type: 'direct'
  })
}

log(`④ 清理旧注入节点`)

const newInjectedTagSet = new Set(injectedTags)

config.outbounds = config.outbounds.filter(o => {
  if (!o || !o.tag) return false
  if (reservedOutboundTags.has(o.tag)) return true
  if (previousInjectedTags.has(o.tag)) return false
  if (newInjectedTagSet.has(o.tag)) return false
  return true
})

config.endpoints = config.endpoints.filter(e => {
  if (!e || !e.tag) return false
  if (previousInjectedTags.has(e.tag)) return false
  if (newInjectedTagSet.has(e.tag)) return false
  return true
})

let finalProxyTags = injectedTags

if (finalProxyTags.length === 0) {
  ensureCompatible(config)
  finalProxyTags = ['COMPATIBLE']
  log(`⚠️ 未获取到有效节点，已使用 COMPATIBLE 兜底`)
}

log(`⑤ 写入选择分组`)

defaultGroup.outbounds = [
  '♻️ 自动选择',
  '🐸 手动选择',
  '🎯 全球直连'
]
defaultGroup.default = defaultGroup.outbounds.includes(defaultGroup.default)
  ? defaultGroup.default
  : '♻️ 自动选择'
defaultGroup.interrupt_exist_connections = false

manualGroup.outbounds = finalProxyTags
manualGroup.interrupt_exist_connections = false

autoGroup.outbounds = finalProxyTags
autoGroup.url = autoGroup.url || 'https://cp.cloudflare.com'
autoGroup.interval = autoGroup.interval || '10m'
autoGroup.tolerance = autoGroup.tolerance ?? 50
autoGroup.idle_timeout = autoGroup.idle_timeout || '30m'
autoGroup.interrupt_exist_connections = false

if (globalGroup) {
  globalGroup.outbounds = [
    '🚀 默认代理',
    '🎯 全球直连',
    '🐸 手动选择',
    '♻️ 自动选择'
  ]
  globalGroup.default = globalGroup.outbounds.includes(globalGroup.default)
    ? globalGroup.default
    : '🚀 默认代理'
  globalGroup.interrupt_exist_connections = false
}

log(`⑥ 追加订阅节点`)

config.outbounds.push(...cleanOutbounds)
config.endpoints.push(...cleanEndpoints)

log(`⑦ 修复 rule_set 引用`)
fixRuleSetReferences(config)

log(`⑧ 检查 momo 必要入口`)
checkMomoInbounds(config)

log(`⑨ 应用 sing-box 1.14.0 兼容清理`)
applySingBox114Compat(config)

$content = JSON.stringify(config, null, 2)

log(`✅ 完成：已注入 ${finalProxyTags.length} 个节点`)
log(`🔚 结束`)

function findOutbound(config, tag) {
  return config.outbounds.find(o => o && o.tag === tag)
}

function ensureOutbounds(group) {
  if (!Array.isArray(group.outbounds)) {
    group.outbounds = []
  }
}

function ensureCompatible(config) {
  if (!config.outbounds.some(o => o && o.tag === 'COMPATIBLE')) {
    config.outbounds.push({
      tag: 'COMPATIBLE',
      type: 'direct'
    })
  }
}

function sanitizeGeneratedItems(list, kind, allGeneratedTags) {
  const result = []

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (!item.tag || !item.type) continue

    if (reservedOutboundTags.has(item.tag)) {
      log(`⚠️ 跳过与模板保留标签冲突的 ${kind}：${item.tag}`)
      continue
    }

    if (allGeneratedTags.has(item.tag)) {
      log(`⚠️ 跳过重复 tag：${item.tag}`)
      continue
    }

    allGeneratedTags.add(item.tag)
    result.push(item)
  }

  return result
}

function fixRuleSetReferences(config) {
  if (!config.route) return
  if (!Array.isArray(config.route.rules)) return
  if (!Array.isArray(config.route.rule_set)) return

  const exists = new Set(
    config.route.rule_set
      .filter(r => r && r.tag)
      .map(r => r.tag)
  )

  config.route.rules = config.route.rules.filter(rule => {
    if (!rule) return false
    if (!rule.rule_set) return true

    if (Array.isArray(rule.rule_set)) {
      rule.rule_set = rule.rule_set.filter(tag => exists.has(tag))
      return rule.rule_set.length > 0 || rule.action || rule.outbound || rule.server
    }

    if (typeof rule.rule_set === 'string' && !exists.has(rule.rule_set)) {
      delete rule.rule_set
    }

    return Object.keys(rule).length > 0
  })
}

function checkMomoInbounds(config) {
  if (!Array.isArray(config.inbounds)) {
    throw new Error(`模板缺少 inbounds`)
  }

  const tags = new Set(
    config.inbounds
      .filter(i => i && i.tag)
      .map(i => i.tag)
  )

  for (const tag of ['dns-in', 'redirect-in', 'tproxy-in', 'tun-in']) {
    if (!tags.has(tag)) {
      throw new Error(`momo 模板缺少必要 inbound：${tag}`)
    }
  }
}

function applySingBox114Compat(config) {
  // sing-box 1.14.0:
  // 1. dns.independent_cache 已弃用
  // 2. dns.rules[*].strategy 旧式 DNS rule action 已弃用；
  //    保留顶层 dns.strategy
  // 3. cache_file.store_rdrc / rdrc_timeout 迁移到 store_dns

  if (config.dns && typeof config.dns === 'object') {
    delete config.dns.independent_cache

    if (Array.isArray(config.dns.rules)) {
      for (const rule of config.dns.rules) {
        cleanLegacyDnsRuleStrategy(rule)
      }
    }
  }

  const cache = config.experimental?.cache_file
  if (cache && typeof cache === 'object') {
    const hadRdrc =
      Object.prototype.hasOwnProperty.call(cache, 'store_rdrc') ||
      Object.prototype.hasOwnProperty.call(cache, 'rdrc_timeout')

    delete cache.store_rdrc
    delete cache.rdrc_timeout

    if (hadRdrc && cache.store_dns === undefined) {
      cache.store_dns = true
    }
  }
}

function cleanLegacyDnsRuleStrategy(rule) {
  if (!rule || typeof rule !== 'object') return

  delete rule.strategy

  if (Array.isArray(rule.rules)) {
    for (const subRule of rule.rules) {
      cleanLegacyDnsRuleStrategy(subRule)
    }
  }
}

function log(v) {
  console.log(`[📦 momo 自动注入] ${v}`)
}
