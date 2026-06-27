// iPhone / Mac 1.14 测试版专用：自建节点少节点 + SS 回家
// 修复：不用 log()，统一用 console.log()

console.log(`🚀 开始`)

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

if (!Array.isArray(config.http_clients)) config.http_clients = []
if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({ tag: 'direct' })
}

if (!config.route) config.route = {}
config.route.default_http_client = 'direct'
config.route.default_domain_resolver = 'local'

if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace('https://raw.githubusercontent.com/', 'https://ghfast.top/raw.githubusercontent.com/')
        .replace('https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/', 'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/')
        .replace('https://testingcf.jsdelivr.net/gh/Toperlock/sing-box-geosite@main/', 'https://ghfast.top/raw.githubusercontent.com/Toperlock/sing-box-geosite/main/')
    }

    delete rs.download_detour
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

  if (!replaced && !config.outbounds.some(o => o?.tag === 'home')) {
    config.outbounds.unshift(homeOutbound)
  }
}

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && Array.isArray(o?.outbounds))
if (!proxyGroup) throw new Error(`模板中未找到 tag=Proxy 的 selector`)

proxyGroup.outbounds = [...proxyTags, 'direct']

if (!proxyGroup.default || !proxyTags.includes(proxyGroup.default)) {
  proxyGroup.default = proxyTags[0] || 'direct'
}

config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

if (!config.outbounds.some(o => o?.tag === 'home')) {
  throw new Error('最终配置中缺少 tag=home 的 outbound，请检查 HOME_SS_SERVER / HOME_SS_PORT / HOME_SS_PASSWORD 是否已配置')
}

if (proxyGroup.outbounds.includes('home')) {
  throw new Error('Proxy 组不应包含 home')
}

$content = JSON.stringify(config, null, 2)

console.log(`✅ 完成`)
