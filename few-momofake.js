// momo / OpenWrt 专用：Sub-Store 自动注入 sing-box 节点
// 适合：自建少量节点 / 组合订阅 / 单订阅
// 作用：
// 1. 读取模板 JSON
// 2. 从 Sub-Store 订阅或组合订阅生成 sing-box outbounds/endpoints
// 3. 自动注入到：
//    - ♻️ 自动选择
//    - 🐸 手动选择
// 4. 自动清理占位节点
// 5. 保留 momo 必需 inbounds：dns-in / redirect-in / tproxy-in / tun-in

log(`🚀 开始生成 momo 配置`)

let { type, name, includeUnsupportedProxy, url } = $arguments

log(`传入参数 type=${type}, name=${name}, url=${url ? '已提供' : '未提供'}`)

type = /^1$|col|collection|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON

let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`❌ 模板解析失败：${e.message ?? e}`)
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}

log(`① 获取订阅节点`)

let data
if (url) {
  data = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
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
  data = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })
}

try {
  data = JSON.parse(data)
} catch (e) {
  log(`❌ 订阅生成结果不是合法 JSON：${e.message ?? e}`)
  throw new Error(`订阅生成失败`)
}

const subOutbounds = Array.isArray(data.outbounds) ? data.outbounds : []
const subEndpoints = Array.isArray(data.endpoints) ? data.endpoints : []

log(`获取到 outbounds=${subOutbounds.length}，endpoints=${subEndpoints.length}`)

if (!Array.isArray(config.outbounds)) {
  config.outbounds = []
}

if (!Array.isArray(config.endpoints)) {
  config.endpoints = []
}

const injectedItems = [...subOutbounds, ...subEndpoints]
const injectedTags = unique(
  injectedItems
    .map(item => item?.tag)
    .filter(Boolean)
)

if (injectedTags.length === 0) {
  log(`⚠️ 未获取到有效节点，将使用 COMPATIBLE 兜底`)
  ensureDirectOutbound(config, 'COMPATIBLE')
  injectedTags.push('COMPATIBLE')
}

log(`② 清理模板中的占位节点`)

const placeholderTags = [
  '你的节点1',
  '__PROXY_PLACEHOLDER__',
  '__NODE_PLACEHOLDER__',
  'COMPATIBLE'
]

config.outbounds = config.outbounds.filter(o => {
  if (!o?.tag) return true
  return !placeholderTags.includes(o.tag)
})

config.endpoints = config.endpoints.filter(e => {
  if (!e?.tag) return true
  return !placeholderTags.includes(e.tag)
})

log(`③ 注入节点到选择器`)

const defaultSelector = findOutbound(config, '🚀 默认代理')
const manualSelector = findOutbound(config, '🐸 手动选择')
const autoSelector = findOutbound(config, '♻️ 自动选择')
const globalSelector = findOutbound(config, 'GLOBAL')

if (!defaultSelector) {
  throw new Error(`模板中未找到 tag=🚀 默认代理 的 selector`)
}

if (!autoSelector) {
  throw new Error(`模板中未找到 tag=♻️ 自动选择 的 urltest`)
}

ensureArray(defaultSelector, 'outbounds')
ensureArray(autoSelector, 'outbounds')

autoSelector.outbounds = mergeTags([], injectedTags)

if (manualSelector) {
  ensureArray(manualSelector, 'outbounds')
  manualSelector.outbounds = mergeTags([], injectedTags)
}

defaultSelector.outbounds = mergeTags(
  [
    '♻️ 自动选择',
    '🐸 手动选择',
    '🎯 全球直连'
  ],
  []
)

if (globalSelector) {
  ensureArray(globalSelector, 'outbounds')
  globalSelector.outbounds = mergeTags(
    [
      '🚀 默认代理',
      '🎯 全球直连',
      '🐸 手动选择',
      '♻️ 自动选择'
    ],
    []
  )
}

log(`④ 写入订阅节点`)

config.outbounds.push(...subOutbounds)
config.endpoints.push(...subEndpoints)

dedupeByTag(config.outbounds)
dedupeByTag(config.endpoints)

log(`⑤ 检查 momo 必需 inbound`)

const requiredInbounds = [
  'dns-in',
  'redirect-in',
  'tproxy-in',
  'tun-in'
]

const inboundTags = new Set((config.inbounds || []).map(i => i?.tag))

for (const tag of requiredInbounds) {
  if (!inboundTags.has(tag)) {
    throw new Error(`模板缺少 momo 必需 inbound：${tag}`)
  }
}

log(`✅ 注入完成：节点数量 ${injectedTags.length}`)

$content = JSON.stringify(config, null, 2)

function findOutbound(config, tag) {
  return config.outbounds.find(o => o?.tag === tag)
}

function ensureArray(obj, key) {
  if (!Array.isArray(obj[key])) {
    obj[key] = []
  }
}

function mergeTags(base, extra) {
  return unique([
    ...base.filter(Boolean),
    ...extra.filter(Boolean)
  ])
}

function unique(arr) {
  return [...new Set(arr)]
}

function dedupeByTag(arr) {
  const seen = new Set()
  for (let i = arr.length - 1; i >= 0; i--) {
    const tag = arr[i]?.tag
    if (!tag) continue
    if (seen.has(tag)) {
      arr.splice(i, 1)
    } else {
      seen.add(tag)
    }
  }
}

function ensureDirectOutbound(config, tag) {
  if (!config.outbounds.some(o => o?.tag === tag)) {
    config.outbounds.push({
      tag,
      type: 'direct'
    })
  }
}

function log(v) {
  console.log(`[📦 momo 自动注入] ${v}`)
}
