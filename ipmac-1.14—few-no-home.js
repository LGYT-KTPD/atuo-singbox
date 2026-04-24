// iPhone / Mac 1.14 测试版专用：自建节点少节点 no-home

console.log(`🚀 开始`)

let { type, name, includeUnsupportedProxy, url } = $arguments
type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config = parser.parse($content ?? $files[0])

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

config.outbounds = config.outbounds.filter(o =>
  o?.tag !== 'home' && o?.tag !== '__HOME_PLACEHOLDER__'
)

config.route.rules = config.route.rules.filter(r => r?.outbound !== 'home')

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

let proxies = url
  ? await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
      subscription: { name, url, source: 'remote' },
    })
  : await produceArtifact({
      name,
      type,
      platform: 'sing-box',
      produceType: 'internal',
      produceOpts: { 'include-unsupported-proxy': includeUnsupportedProxy },
    })

const proxyTags = proxies.map(p => p.tag)

config.outbounds.push(...proxies)

const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && Array.isArray(o?.outbounds))
if (!proxyGroup) throw new Error('模板中未找到 tag=Proxy 的 selector')

proxyGroup.outbounds = [...proxyTags, 'direct']
proxyGroup.default = proxyTags[0] || 'direct'

config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

if (proxyGroup.outbounds.includes('home')) {
  throw new Error('no-home 配置中 Proxy 组不应包含 home')
}

$content = JSON.stringify(config, null, 2)

console.log(`✅ 完成`)
