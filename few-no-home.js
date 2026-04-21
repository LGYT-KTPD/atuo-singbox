// 单节点/少节点 Sub-Store 模板脚本（无 home 注入）
// 作用：
// 1. 读取订阅节点
// 2. 将所有订阅节点直接插入 Proxy 组
// 3. 不再使用 auto/urltest
// 4. 生成后做基础校验

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
let proxies
if (url) {
  log(`直接从 URL ${url} 读取订阅`)
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
  log(`将读取名称为 ${name} 的 ${type === 'collection' ? '组合' : ''}订阅`)
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
log(`③ 获取到 ${proxyTags.length} 个订阅节点`)

// 将订阅节点加入 outbounds
config.outbounds.push(...proxies)

// 重建 Proxy 组：只包含订阅节点 + direct
const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && Array.isArray(o?.outbounds))
if (!proxyGroup) {
  throw new Error(`模板中未找到 tag=Proxy 的 selector`)
}

proxyGroup.outbounds = [...proxyTags, 'direct']
if (!proxyGroup.outbounds.length) {
  proxyGroup.outbounds = ['direct']
}

if (!proxyGroup.default || !proxyTags.includes(proxyGroup.default)) {
  proxyGroup.default = proxyTags[0] || 'direct'
}

log(`✅ Proxy 已注入 ${proxyTags.length} 个节点，默认=${proxyGroup.default}`)

// 清理 auto/urltest（如果模板里残留）
config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

// 基础校验
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

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 sing-box 无 home 脚本] ${v}`)
}

log(`🔚 结束`)
