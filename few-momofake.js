// 简化版：适合自建 1-2 个节点（OpenWrt / momo）
// 作用：
// 1. 读取组合订阅/单订阅节点
// 2. 所有节点统一插入到 ♻️ 自动选择
// 3. 同时插入到 🐸 手动选择（如果模板里存在）
// 4. 去掉机场式地区分组和多测速依赖

log(`🚀 开始`)

let { type, name, includeUnsupportedProxy, url } = $arguments
log(`传入参数 type: ${type}, name: ${name}`)

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
log(`① 使用 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 解析配置文件`)
let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}

log(`② 获取订阅`)
let data = {}
if (url) {
  log(`直接从 URL ${url} 读取订阅`)
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
  log(`将读取名称为 ${name} 的 ${type === 'collection' ? '组合' : ''}订阅`)
  data = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })
}

data = JSON.parse(data)
const outbounds = data.outbounds ?? []
const endpoints = data.endpoints ?? []
const proxies = [...outbounds, ...endpoints]
log(`获取到 ${outbounds.length} 个节点, ${endpoints.length} 个端点`)

if (!Array.isArray(config.outbounds)) {
  config.outbounds = []
}

log(`③ 将所有订阅节点插入 ♻️ 自动选择`)
const autoGroup = config.outbounds.find(o => o?.tag === '♻️ 自动选择')
if (!autoGroup) {
  throw new Error(`模板中未找到 tag=♻️ 自动选择 的 outbound`)
}
if (!Array.isArray(autoGroup.outbounds)) {
  autoGroup.outbounds = []
}
const proxyTags = proxies.map(p => p.tag)
autoGroup.outbounds.push(...proxyTags)
log(`✅ ♻️ 自动选择 插入 ${proxyTags.length} 个节点`)

const manualGroup = config.outbounds.find(o => o?.tag === '🐸 手动选择')
if (manualGroup) {
  if (!Array.isArray(manualGroup.outbounds)) {
    manualGroup.outbounds = []
  }
  manualGroup.outbounds.push(...proxyTags)
  log(`✅ 🐸 手动选择 插入 ${proxyTags.length} 个节点`)
}

const compatibleOutbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

if (autoGroup.outbounds.length === 0) {
  const existed = config.outbounds.some(o => o?.tag === 'COMPATIBLE')
  if (!existed) {
    config.outbounds.push(compatibleOutbound)
  }
  autoGroup.outbounds.push('COMPATIBLE')
  log(`⚠️ ♻️ 自动选择 为空，已自动插入 COMPATIBLE(direct)`)
}

config.outbounds.push(...outbounds)
if (!Array.isArray(config.endpoints)) {
  config.endpoints = []
}
config.endpoints.push(...endpoints)

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 momo 简化脚本] ${v}`)
}

log(`🔚 结束`)
