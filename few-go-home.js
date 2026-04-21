// 单节点/少节点 Sub-Store 模板脚本
// 作用：
// 1. 读取订阅节点
// 2. 将所有订阅节点直接插入 Proxy 组
// 3. home 单独注入，只用于回家
// 4. 不再使用 auto/urltest
// 5. 生成后做基础校验，避免产出半残配置

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

log(`④ 注入 home(Shadowsocks)`)

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

  log(replaced ? '✅ 已替换 __HOME_PLACEHOLDER__ 为 home' : '⚠️ 未找到 __HOME_PLACEHOLDER__，将改为追加 home')

  if (!replaced) {
    const existed = config.outbounds.some(o => o?.tag === 'home')
    if (!existed) config.outbounds.unshift(homeOutbound)
  }
} else {
  log(`⚠️ HOME_SS_SERVER/HOME_SS_PORT/HOME_SS_PASSWORD 未配置齐全，跳过 home 注入`)
}

// ⑤ 将订阅节点加入 outbounds
config.outbounds.push(...proxies)

// ⑥ 重建 Proxy 组：只包含订阅节点 + direct
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

// ⑦ 清理 auto/urltest（如果模板里残留）
config.outbounds = config.outbounds.filter(o => o?.tag !== 'auto')

// ⑧ 基础校验
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
