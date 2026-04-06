// https://raw.githubusercontent.com/LGYT-KTPD/template/refs/heads/main/zx_template.js#type=组合订阅&name=singbox&outbound=🕳ℹ️Proxy|auto🏷ℹ️^(?!.*(?:官网|剩余|流量|套餐|免费|订阅|到期时间|全球直连|GB|Expire Date|Traffic|ExpireDate)).*🕳ℹ️HongKong🏷ℹ️^(?!.*(?:us)).*(🇭🇰|HK|hk|香港|港|HongKong)🕳ℹ️TaiWan🏷ℹ️^(?!.*(?:us)).*(🇹🇼|TW|tw|台湾|臺灣|台|Taiwan)🕳ℹ️Japan🏷ℹ️^(?!.*(?:us)).*(🇯🇵|JP|jp|日本|日|Japan)🕳ℹ️Singapore🏷ℹ️^(?!.*(?:us)).*(新加坡|坡|狮城|SG|Singapore)🕳ℹ️America🏷ℹ️^(?!.*(?:AUS|RUS)).*(🇺🇸|US|us|美国|美|United States)🕳ℹ️Others🏷ℹ️^(?!.*(?:官网|剩余|流量|套餐|免费|订阅|到期时间|全球直连|GB|Expire Date|Traffic|ExpireDate|🇭🇰|HK|hk|香港|香|🇹🇼|TW|tw|台湾|台|🇸🇬|SG|sg|新加坡|狮|🇯🇵|JP|jp|日本|日|🇺🇸|US|us|美国|美|HongKong|Taiwan|Singapore|Japan|United States)).*

// 示例说明
// 读取 名称为 "机场" 的 组合订阅 中的节点(单订阅不需要设置 type 参数)
// 把 所有节点插入匹配 /Proxy|auto/i 的 outbound 中(跟在 🕳 后面, ℹ️ 表示忽略大小写, 不筛选节点不需要给 🏷 )
// 把匹配 /港|hk|hongkong|kong kong|🇭🇰/i  (跟在 🏷 后面, ℹ️ 表示忽略大小写) 的节点插入匹配 /hk|hk-auto/i 的 outbound 中
// ...
// 可选参数: includeUnsupportedProxy 包含官方/商店版不支持的协议 SSR. 用法: `&includeUnsupportedProxy=true`

// 支持传入订阅 URL. 参数为 url. 记得 url 需要 encodeURIComponent.
// 例如: http://a.com?token=123 应使用 url=http%3A%2F%2Fa.com%3Ftoken%3D123

// ⚠️ 如果 outbounds 为空, 自动创建 COMPATIBLE(direct) 并插入 防止报错
log(`🚀 开始`)

let { type, name, outbound, includeUnsupportedProxy, url } = $arguments

log(`传入参数 type: ${type}, name: ${name}, outbound: ${outbound}`)

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

log(`③ outbound 规则解析`)
const outbounds = outbound
  .split('🕳')
  .filter(i => i)
  .map(i => {
    let [outboundPattern, tagPattern = '.*'] = i.split('🏷')
    const tagRegex = createTagRegExp(tagPattern)
    log(`匹配 🏷 ${tagRegex} 的节点将插入匹配 🕳 ${createOutboundRegExp(outboundPattern)} 的 outbound 中`)
    return [outboundPattern, tagRegex]
  })

log(`④ outbound 插入节点`)
config.outbounds.map(outbound => {
  outbounds.map(([outboundPattern, tagRegex]) => {
    const outboundRegex = createOutboundRegExp(outboundPattern)
    if (outboundRegex.test(outbound.tag)) {
      if (!Array.isArray(outbound.outbounds)) {
        outbound.outbounds = []
      }
      const tags = getTags(proxies, tagRegex)
      log(`🕳 ${outbound.tag} 匹配 ${outboundRegex}, 插入 ${tags.length} 个 🏷 匹配 ${tagRegex} 的节点`)
      outbound.outbounds.push(...tags)
    }
  })
})

const compatible_outbound = {
  tag: 'COMPATIBLE',
  type: 'direct',
}

let compatible
log(`⑤ 空 outbounds 检查`)
config.outbounds.map(outbound => {
  outbounds.map(([outboundPattern, tagRegex]) => {
    const outboundRegex = createOutboundRegExp(outboundPattern)
    if (outboundRegex.test(outbound.tag)) {
      if (!Array.isArray(outbound.outbounds)) {
        outbound.outbounds = []
      }
      if (outbound.outbounds.length === 0) {
        if (!compatible) {
          config.outbounds.push(compatible_outbound)
          compatible = true
        }
        log(`🕳 ${outbound.tag} 的 outbounds 为空, 自动插入 COMPATIBLE(direct)`)
        outbound.outbounds.push(compatible_outbound.tag)
      }
    }
  })
})

log(`⑥ 注入 home(Shadowsocks)`)

// 从容器环境变量读取（你在飞牛 Docker 给 sub-store 容器加）
const HOME_SERVER = process.env.HOME_SS_SERVER
const HOME_PORT = Number(process.env.HOME_SS_PORT)
const HOME_PASS = process.env.HOME_SS_PASSWORD
const HOME_METHOD = process.env.HOME_SS_METHOD || '2022-blake3-chacha20-poly1305'

// 只有当环境变量齐全时才注入，避免你忘配导致脚本报错
if (HOME_SERVER && HOME_PORT && HOME_PASS) {
  const homeOutbound = {
    type: 'shadowsocks',
    tag: 'home',
    server: HOME_SERVER,
    server_port: HOME_PORT,
    password: HOME_PASS,
    method: HOME_METHOD,
  }

  // 1) 替换占位符
  let replaced = false
  config.outbounds = config.outbounds.map(o => {
    if (o?.tag === '__HOME_PLACEHOLDER__') {
      replaced = true
      return homeOutbound
    }
    return o
  })
  log(replaced ? '✅ 已替换 __HOME_PLACEHOLDER__ 为 home' : '⚠️ 未找到 __HOME_PLACEHOLDER__，将改为追加 home')

  // 2) 如果模板里没放占位符，就追加一个（兜底）
  if (!replaced) {
    const existed = config.outbounds.some(o => o?.tag === 'home')
    if (!existed) config.outbounds.unshift(homeOutbound)
  }

  // 3) 可选：把 home 加入 selector 组（按你的需要改）
  const addToGroups = ['Proxy']  // 你也可以加 'Global'、'China' 等
  for (const gTag of addToGroups) {
    const g = config.outbounds.find(o => o?.tag === gTag && Array.isArray(o?.outbounds))
    if (g && !g.outbounds.includes('home')) {
      g.outbounds.push('home')
      log(`✅ 已将 home 加入 selector: ${gTag}`)
    }
  }
} else {
  log(`⚠️ HOME_SS_SERVER/HOME_SS_PORT/HOME_SS_PASSWORD 未配置齐全，跳过 home 注入`)
}

config.outbounds.push(...proxies)

$content = JSON.stringify(config, null, 2)

function getTags(proxies, regex) {
  return (regex ? proxies.filter(p => regex.test(p.tag)) : proxies).map(p => p.tag)
}
function log(v) {
  console.log(`[📦 sing-box 模板脚本] ${v}`)
}
function createTagRegExp(tagPattern) {
  return new RegExp(tagPattern.replace('ℹ️', ''), tagPattern.includes('ℹ️') ? 'i' : undefined)
}
function createOutboundRegExp(outboundPattern) {
  return new RegExp(outboundPattern.replace('ℹ️', ''), outboundPattern.includes('ℹ️') ? 'i' : undefined)
}

log(`🔚 结束`)
