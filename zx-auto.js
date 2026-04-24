// 多节点/多分组 Sub-Store 模板脚本（go-home, 1.14 稳定版）
// ✅ 适配：sing-box 1.14（iPhone / Mac）
// ✅ 启动链路：http_client + local DNS
// ❌ 不使用：external_ui_http_client / download_detour

log(`🚀 开始`)

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
let config

try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  throw new Error(`配置解析失败: ${e.message}`)
}

log(`🛠 修复启动链路（1.14 专用）`)

// ❌ 删除不兼容字段
if (config.experimental?.clash_api?.external_ui_http_client) {
  delete config.experimental.clash_api.external_ui_http_client
}

// ✅ http_client（关键）
if (!Array.isArray(config.http_clients)) {
  config.http_clients = []
}
if (!config.http_clients.some(c => c?.tag === 'direct')) {
  config.http_clients.unshift({ tag: 'direct' })
}

// ✅ route 修复
if (!config.route) {
  config.route = {}
}
config.route.default_domain_resolver = 'local'
config.route.default_http_client = 'direct'

// ✅ DNS：规则下载域名走 local
if (!config.dns) config.dns = {}
if (!Array.isArray(config.dns.rules)) config.dns.rules = []

const downloadDomains = [
  'ghfast.top',
  'raw.githubusercontent.com',
  'github.com',
  'gh-proxy.com',
  'testingcf.jsdelivr.net',
  'cdn.jsdelivr.net'
]

let dnsRule = config.dns.rules.find(r =>
  r?.server === 'local' &&
  Array.isArray(r?.domain_suffix) &&
  r.domain_suffix.includes('ghfast.top')
)

if (!dnsRule) {
  dnsRule = {
    domain_suffix: [],
    action: 'route',
    server: 'local',
    strategy: 'ipv4_only'
  }
  config.dns.rules.splice(Math.min(2, config.dns.rules.length), 0, dnsRule)
}

downloadDomains.forEach(d => {
  if (!dnsRule.domain_suffix.includes(d)) {
    dnsRule.domain_suffix.push(d)
  }
})

// ✅ rule-set：改 ghfast + 删除 download_detour
if (Array.isArray(config.route.rule_set)) {
  config.route.rule_set = config.route.rule_set.map(rs => {
    if (rs?.type === 'remote' && typeof rs.url === 'string') {
      rs.url = rs.url
        .replace(
          'https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing/',
          'https://ghfast.top/raw.githubusercontent.com/MetaCubeX/meta-rules-dat/sing/'
        )
        .replace(
          'https://testingcf.jsdelivr.net/gh/Toperlock/sing-box-geosite@main/',
          'https://ghfast.top/raw.githubusercontent.com/Toperlock/sing-box-geosite/main/'
        )
        .replace(
          'https://raw.githubusercontent.com/',
          'https://ghfast.top/raw.githubusercontent.com/'
        )
    }

    // ❌ 删除旧字段
    if (rs?.download_detour) {
      delete rs.download_detour
    }

    return rs
  })
}

log(`② 获取订阅节点`)

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

// ==================== 原模板逻辑 ====================

const outbounds = outbound
  .split('🕳')
  .filter(i => i)
  .map(i => {
    let [outboundPattern, tagPattern = '.*'] = i.split('🏷')
    return [new RegExp(outboundPattern), new RegExp(tagPattern)]
  })

config.outbounds.forEach(o => {
  outbounds.forEach(([oReg, tReg]) => {
    if (oReg.test(o.tag)) {
      if (!Array.isArray(o.outbounds)) o.outbounds = []
      o.outbounds.push(...proxies.filter(p => tReg.test(p.tag)).map(p => p.tag))
    }
  })
})

// 注入 home
const HOME_SERVER = process.env.HOME_SS_SERVER
const HOME_PORT = Number(process.env.HOME_SS_PORT)
const HOME_PASS = process.env.HOME_SS_PASSWORD

if (HOME_SERVER && HOME_PORT && HOME_PASS) {
  const home = {
    type: 'shadowsocks',
    tag: 'home',
    server: HOME_SERVER,
    server_port: HOME_PORT,
    password: HOME_PASS,
    method: '2022-blake3-chacha20-poly1305'
  }

  let replaced = false

  config.outbounds = config.outbounds.map(o => {
    if (o.tag === '__HOME_PLACEHOLDER__') {
      replaced = true
      return home
    }
    return o
  })

  if (!replaced) {
    if (!config.outbounds.some(o => o.tag === 'home')) {
      config.outbounds.unshift(home)
    }
  }
}

config.outbounds.push(...proxies)

$content = JSON.stringify(config, null, 2)

log(`✅ 完成（1.14 稳定版）`)
