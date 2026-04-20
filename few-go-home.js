// 简化版：适合自建 1-2 个节点
// 作用：
// 1. 读取订阅节点
// 2. 把所有节点统一插入到 auto 组
// 3. Proxy 组只负责在 home / auto / direct 之间切换
// 4. 保留 home 注入逻辑
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

log(`③ 将所有订阅节点插入 auto`)
const autoGroup = config.outbounds.find(o => o?.tag === 'auto')
if (!autoGroup) {
  throw new Error(`模板中未找到 tag=auto 的 outbound`)
}
if (!Array.isArray(autoGroup.outbounds)) {
  autoGroup.outbounds = []
}

const proxyTags = proxies.map(p => p.tag)
autoGroup.outbounds.push(...proxyTags)
log(`✅ auto 插入 ${proxyTags.length} 个节点`)

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
  log(`⚠️ auto 为空，已自动插入 COMPATIBLE(direct)`)
}

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

  const proxyGroup = config.outbounds.find(o => o?.tag === 'Proxy' && Array.isArray(o?.outbounds))
  if (proxyGroup) {
    proxyGroup.outbounds = proxyGroup.outbounds.filter(t => t !== 'home')
    proxyGroup.outbounds.unshift('home')
    log(`✅ 已将 home 放到 selector: Proxy 前面`)
  }
} else {
  log(`⚠️ HOME_SS_SERVER/HOME_SS_PORT/HOME_SS_PASSWORD 未配置齐全，跳过 home 注入`)
}

config.outbounds.push(...proxies)

// ⑤ 基础校验
const hasHome = config.outbounds.some(o => o?.tag === 'home')
if (!hasHome) {
  throw new Error('最终配置中缺少 tag=home 的 outbound')
}

const proxyGroupCheck = config.outbounds.find(o => o?.tag === 'Proxy')
if (!proxyGroupCheck || !Array.isArray(proxyGroupCheck.outbounds) || !proxyGroupCheck.outbounds.includes('home')) {
  throw new Error('最终配置中 Proxy 组未正确包含 home')
}

const autoGroupCheck = config.outbounds.find(o => o?.tag === 'auto')
if (!autoGroupCheck || !Array.isArray(autoGroupCheck.outbounds) || autoGroupCheck.outbounds.length === 0) {
  throw new Error('最终配置中 auto 组为空')
}

$content = JSON.stringify(config, null, 2)

function log(v) {
  console.log(`[📦 sing-box 简化脚本] ${v}`)
}

log(`🔚 结束`)
