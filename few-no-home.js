// 单节点/少节点 Sub-Store 模板脚本（无 home，http_client 兼容版）

log(`🚀 开始`)

let { type, name, includeUnsupportedProxy, url } = $arguments
log(`传入参数 type: ${type}, name: ${name}`)

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
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

// 启动链路修复：不要使用 clash_api.external_ui_http_client
if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

// 补 direct http_client
if (!Array.isArray(config.http_clients)) {
  config.http_clients = []
}

if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({ tag: 'direct' })
}

if (!config.route) {
  config.route = {}
}

config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local'

// 替换 rule-set 下载源，并删除旧 download_detour
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
        )
        .replace(
          'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/',
          'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/'
        )
        .replace(
          'https://testingcf.jsdelivr.net/gh/',
          'https://ghfast.top/https://github.com/'
        )
    }

    if (rs?.download_detour) {
      delete rs.download_detour
    }

    return rs
  })
}

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

// 清理 auto/urltest
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
