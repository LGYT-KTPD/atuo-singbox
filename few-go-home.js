// 单节点/少节点 Sub-Store 模板脚本（http_client 启动稳定版）
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

if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
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

const HOME_SERVER = process.env.HOME_SS_SERVER
const HOME_PORT = Number(process.env.HOME_SS_PORT)
const HOME_PASS = process.env.HOME_SS_PASSWORD
const HOME_METHOD = process.env.HOME_SS_METHOD || '2022-blake3-chacha20-poly1305'

if (HOME_SERVER && HOME_PORT && HOME_PASS) {
  const homeOutbound = {
    type: 'shadowsocks',
    tag: 'home',
    server: HOME_SERVER,
    server_port: HOME_PORT,
    password: HOME_PASS,
    method: HOME_METHOD
  }

  let replaced = false

  config.outbounds = config.outbounds.map(o => {
    if (o?.tag === '__HOME_PLACEHOLDER__') {
      replaced = true
      return homeOutbound
    }
    return o
  })

  if (!replaced) {
    const existed = config.outbounds.some(o => o?.tag === 'home')
    if (!existed) config.outbounds.unshift(homeOutbound)
  }
}

config.outbounds.push(...proxies)

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

config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

const hasHome = config.outbounds.some(o => o?.tag === 'home')
if (!hasHome) {
  throw new Error('最终配置中缺少 tag=home 的 outbound')
}

const proxyGroupCheck = config.outbounds.find(o => o?.tag === 'Proxy')

if (!proxyGroupCheck || !Array.isArray(proxyGroupCheck.outbounds)) {
  throw new Error('最终配置中 Proxy 组不存在或格式错误')
}

if (proxyGroupCheck.outbounds.includes('home')) {
  throw new Error('最终配置中 Proxy 组不应包含 home')
}

if (proxyGroupCheck.outbounds.length === 0) {
  throw new Error('最终配置中 Proxy 组为空')
}

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 sing-box 单节点脚本] ${v}`)
}

log(`🔚 结束`)
