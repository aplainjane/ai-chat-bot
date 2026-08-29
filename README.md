# AI Chat Bot：QQ ↔ DeepSeek Harness 桥接

把 DeepSeek Harness（下文简称 DSH）接到 QQ。QQ 私聊或群消息经 SnowLuma 的 OneBot v11 接口进入桥接进程，再被投递到独立的 DSH 会话；模型的回复、追问和工具审批会沿原路返回 QQ。

这个仓库不只是聊天转发器。它还提供管理员工作会话、群友模式、按会话切换人设、图片与表情处理、本地控制台，以及一组带白名单和限频的 QQ 工具。

> 本项目基于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) 二次开发，当前版本由 [aplainjane/ai-chat-bot](https://github.com/aplainjane/ai-chat-bot) 继续维护。感谢原作者提供基础实现。
>
> 本项目与 DeepSeek、腾讯、QQ、SnowLuma 官方均无隶属关系。DSH、SnowLuma 和 QQ 是独立的第三方组件或服务，请分别遵守它们的许可协议和使用条款。

[项目说明书](docs/PROJECT_GUIDE.md) · [DSH 端安装说明](docs/DSH_SETUP.md)

## 它是怎么接入 QQ 和 DSH 的

```text
QQ NT
  │
  │ SnowLuma 接入 QQ 进程
  ▼
SnowLuma
  │ OneBot v11
  │ WebSocket 收事件 / HTTP API 发消息
  ▼
qq-bridge（本仓库，独立 Node.js 进程）
  │
  ├── DSH Web API：创建会话、发送 prompt、接收回复与审批
  ├── MCP：向 DSH 提供受限的 QQ、SnowLuma 和网页查询工具
  └── 本地控制台：http://127.0.0.1:3100
  │
  ▼
DeepSeek Harness
```

OneBot 是一套机器人接口规范，不是这个项目里需要单独安装的 npm 包。SnowLuma 负责实现 OneBot v11 并连接 QQ，本项目消费它提供的 WebSocket 和 HTTP 接口。

本项目也不只是一个 DSH 插件：桥接主体是独立进程。仓库内的 `qq-mode-console` 才是安装到 DSH 的设置页插件；`setup-dsh.mjs` 还会安装 agent preset，并把本项目的 MCP 服务挂到 DSH profile。

## 当前仓库增加了什么

相较于上游基础版本，当前仓库重点扩展了这些部分：

- 管理员 QQ 私聊可启用 `qq-admin`，用手机给 DSH 派任务、继续追问、处理工具审批，并调用完整的本地工作工具。
- 唯一运行模式是群友模式（二代仿真）：消息进入未读池，AI 自主决定是否参与，不再机械转发。
- 每个 QQ 私聊和群聊独立映射到 DSH 会话，映射会保存到 `state/sessions.json`。
- 支持按会话设置角色卡，内置小鲸鱼、猫娘、女朋友、纯良鲸鱼娘和傲娇助手，也可以新增自己的 Markdown 角色卡。
- 群友模式允许 AI 自主读取未读消息、发言、等待、潜水并设置下次唤醒条件，不再把每条群消息机械转发给模型。
- 支持引用回复、`@`、图片、合并转发、拍一拍、QQ 收藏表情同步、识图、备注、收藏和发送。
- 群聊黑话可以自动提取和研究，经控制台人工确认后再注入聊天上下文。
- DSH 的 `ask_user_question` 和工具审批会回传 QQ，管理员可以直接回复选项、`通过` 或 `拒绝`。
- 本地 Web 控制台可管理模式、人设、白名单、社交参数、黑话、表情、会话和运行状态。
- 增加会话白名单、会话令牌、敏感内容拦截、SSRF 防护、发送限频和控制台鉴权。
- DSH 重启期间消息会暂存，恢复后继续投递；桥接带单实例锁和 Windows 守护启动脚本。

## 管理员会话：从 QQ 直接让 DSH 干活

管理员工作会话由 `ownerQQ` 和 `dsh.ownerTools` 共同启用。把自己的 QQ 号填入 `ownerQQ`，再设置 `dsh.ownerTools: true`，该 QQ 的私聊会优先使用 `qq-admin` preset。这个优先级高于群友模式：即使机器人当前处于群友模式，管理员私聊也不会进入未读池等待唤醒，而是直接送到 DSH 处理。

```text
管理员 QQ 私聊
  → 独立 DSH 会话
  → qq-admin preset
  → PowerShell、文件读写与搜索、后台任务、技能、网页抓取等 DSH 工具
  → 结果 / 追问 / 审批返回 QQ
```

你可以像使用 DSH 本身一样，在 QQ 里要求它检查项目、修改代码、运行测试或查询资料。管理员发来的新消息使用 `steer` 投递，可以立即补充或纠正正在执行的任务，不需要等当前回合排队结束。DSH 的最终结果会自动返回 QQ；遇到追问或需要确认的工具调用时，桥接也会把请求发到管理员 QQ，回复选项、`通过` 或 `拒绝` 即可。

`qq-admin` 不挂载普通 QQ 会话使用的工具限制插件，因此能够使用 DSH 的本地工作工具；权限仍受 DSH 所在机器的工作目录、沙箱和审批策略约束。群聊和其他人的私聊继续使用 `qq-chat-v2`（锁定、无本地工具），不会因为管理员开启工具会话而获得本地工具。

不要把管理员 QQ 号、控制台令牌或 OneBot token 公开。

### 最快启用管理员工具会话

1. 在 `config.json` 中设置自己的 `ownerQQ`，把 `dsh.ownerTools` 设为 `true`。
2. 把 `dsh.ownerWorkspace` 设为允许 DSH 工作的目录，例如 `F:\\deepseek harness\\workspace`。管理员会话将在这里执行文件和终端任务。
3. 运行 `node scripts/setup-dsh.mjs web`，它会把 `qq-admin` 安装到 DSH。
4. 重启 DSH 和桥接。
5. 若该 QQ 以前已经创建过普通聊天会话，先发送 `/reset`，再发送任务。新会话日志应显示 `preset: qq-admin`。

不必切换任何模式：`ownerTools` 开启后，管理员私聊始终优先进入工具会话。

### 管理员命令

以下命令由桥接直接处理，只有 `ownerQQ` 可以使用：

```text
/status          查看当前会话、白名单、人设和模式
/reset           清空本 QQ 会话与 DSH 会话的映射，下条消息创建新上下文
/new             与 /reset 相同
/role 小鲸鱼     为当前会话切换角色
/role off        清除当前会话角色，回到默认人格
/silent          静默群友消息，只保留管理员对话
/active          退出静默，恢复正常回复
```

未被桥接识别的斜杠命令会原样交给 DSH，例如 `/model`。

管理员也可以直接用自然语言管理人设：

```text
查看角色列表
查看人格
切换角色：猫娘
退出角色扮演
设置默认人格：小鲸鱼
设置 group:123456789 人格：傲娇助手
```

人设按会话保存。给某个群设置猫娘，不会影响管理员工作会话；未单独设置的会话使用全局默认人格。切换人设只改变提示词和表达方式，不会绕过 DSH 的工具权限或审批。

## 运行模式

桥接只有一种运行模式：**群友模式**（二代仿真）。它把“是否说话”交给 AI 自己判断：

- 群聊 / 私聊消息先进入会话的未读池，不机械转发给模型。
- AI 自主调用 QQ 工具查看未读、发言、引用回复、等待、潜水，并设置下次唤醒条件。
- 文本不自动转发；AI 通过 QQ 发送工具对外发言。
- 管理员私聊（开启 `ownerTools`）优先进入 `qq-admin` 工作会话，不走未读池。

当前模式由 DSH 设置页中的 `qq-mode` 卡片或桥接控制台 `http://127.0.0.1:3100` 管理；`setup-dsh.mjs` 会为全新环境写入 `reserved2` 默认值（即群友模式），已有 `state/mode.json` 时不会覆盖原设置。

## 安装前准备

需要以下组件：

1. Node.js。推荐 Node.js 24 LTS。
2. 已安装并能打开 Web 页的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，默认地址为 `http://127.0.0.1:3080`。
3. 已运行并成功接入 QQ 的 [SnowLuma](https://github.com/SnowLuma/SnowLuma)，需要开启 OneBot v11 的 WebSocket 服务端和 HTTP API。

虽然本仓库 `package.json` 的最低版本是 Node.js 22.13，但当前 DSH 源码要求 Node.js `^22.19.0` 或 `>=24.0.0`。直接使用 Node.js 24 可以避开旧版本缺少 `createZstdDecompress` 的启动错误。

SnowLuma 必须先成功接入受支持的 QQ NT 进程，并在 WebUI 中显示在线。仅仅打开 SnowLuma，但一直停在“QQ.exe 等待连接”，OneBot 端口即使已经配置也无法收发 QQ 消息。

## 安装

下面以 Windows CMD 为例：

```bat
git clone https://github.com/aplainjane/ai-chat-bot.git qq-bridge
cd qq-bridge
npm install
copy config.example.json config.json
```

PowerShell 用户把最后一条换成：

```powershell
Copy-Item config.example.json config.json
```

然后编辑 `config.json`。至少确认这些字段：

```json
{
  "dsh": {
    "baseUrl": "http://127.0.0.1:3080",
    "provider": "deepseek-official",
    "model": "换成你的 DSH 中实际可用的模型",
    "reasoningEffort": "high",
    "ownerTools": true,
    "ownerWorkspace": "F:\\deepseek harness\\workspace"
  },
  "snowluma": {
    "wsUrl": "ws://127.0.0.1:3001",
    "httpUrl": "http://127.0.0.1:3000",
    "accessToken": ""
  },
  "ownerQQ": 123456789,
  "allow": {
    "private": [123456789],
    "groups": [987654321]
  },
  "deny": {
    "private": [],
    "groups": []
  },
  "allowAllWhenEmpty": false
}
```

注意：

- `snowluma.wsUrl` 是 OneBot WebSocket 地址，用来接收事件。
- `snowluma.httpUrl` 是 OneBot HTTP API 地址，用来主动发送和查询。HTTP 与 WebSocket 端口不要填反。
- SnowLuma 两端设置了 access token 时，`config.json` 必须填写同一个值。
- `ownerQQ` 是唯一管理员 QQ。要使用管理模式，必须正确填写。
- `dsh.ownerTools: true` 让管理员私聊优先使用 `qq-admin`；不需要完整本地工具时设为 `false`。
- `dsh.ownerWorkspace` 是管理员工具会话的工作目录。建议指向专门的项目父目录，不要指向整个系统盘或用户主目录。
- 首次测试建议只放行自己的私聊和一个测试群，并保持 `allowAllWhenEmpty: false`。
- `provider`、`model` 和 `reasoningEffort` 要以你的 DSH 设置页中实际可用的选项为准。
- `config.json` 含真实账号和令牌，已被 Git 忽略，不要提交。

## 安装到 DSH

在桥接仓库目录运行：

```bat
node scripts/setup-dsh.mjs web
```

如果你的 DSH profile 不是 `web`，把最后的 `web` 换成实际名称。脚本可以重复执行，它会：

- 安装 `qq-chat-v2` 和 `qq-admin` 两个 agent preset。
- 在目标 profile 的 `cordis.patch.yml` 中挂载三个 MCP 服务。
- 把 `qq-mode-console` 链接到 DSH 插件目录并注册到 profile。
- 尝试运行 `dsh plugin --profile web install` 安装 profile bundle。
- 为全新环境创建 `state/mode.json`，默认使用群友模式（`reserved2`）。

运行完必须重启 DSH，让 preset、MCP 和设置页插件生效。如果脚本提示找不到 `dsh` 命令，可以在 DSH 仓库中手动运行：

```bat
pnpm dsh plugin --profile web install
```

更完整的说明见 [docs/DSH_SETUP.md](docs/DSH_SETUP.md)。如果之后移动了本仓库目录，也要重新运行安装脚本，因为 DSH 的 MCP 配置保存了脚本的绝对路径。

### 验证 `qq-admin`

安装脚本会把仓库内的 `dsh/agent-presets/qq-admin` 复制到：

```text
%USERPROFILE%\.dsh\.agent-presets\qq-admin\preset.yml
%USERPROFILE%\.dsh\.agent-presets\qq-admin\agent.cordis.yml
```

重启 DSH 后，agent preset 列表中应能看到“QQ 管理员助手（完整工具）”。如果管理员 QQ 已有旧会话，在私聊中发送 `/reset`，下一条消息会用 `qq-admin` 新建会话。

## 启动顺序

1. 启动 DSH，确认 `http://127.0.0.1:3080` 可以打开。
2. 启动 SnowLuma，确认 QQ 已登录，OneBot HTTP 和 WebSocket 均已开启。
3. 在本仓库启动桥接。

```bat
npm start
```

Windows 也可以双击 `start.bat`。它通过守护脚本运行，桥接异常退出后会自动重启；关闭守护窗口即停止。`restart.bat` 用于结束旧实例、清理失效锁并重新启动。

正常启动后，日志中应出现 SnowLuma WebSocket 已连接的信息。控制台默认位于：

```text
http://127.0.0.1:3100
```

控制台所有请求都需要令牌。若 `consoleToken` 留空，桥接会自动生成并保存到 `state/console-token`。建议只监听本机，不要把控制台和 OneBot 端口直接暴露到公网。

## 角色卡

角色卡位于 `roles/`，一个角色对应一个 Markdown 文件，文件名就是角色名：

```text
roles/
├── 小鲸鱼.md
├── 猫娘.md
├── 女朋友.md
├── 纯良鲸鱼娘.md
└── 傲娇助手.md
```

添加 `roles/吐槽役.md` 后，管理员即可发送 `切换角色：吐槽役` 或 `/role 吐槽役`。角色卡会注入对应 DSH 会话，不需要修改桥接源码。

## 群友模式能做什么

二代群友模式把“是否说话”交给 AI 自己判断。桥接保存会话最近消息和未读状态，AI 可按配置调用：

- 消息工具：读取未读/最近消息、查看消息详情、查看活跃成员、读取合并转发。
- 互动工具：发送私聊或群聊、引用回复、分条发送、拍一拍。
- 媒体与表情：读取消息图片、获取自身形象、同步收藏表情、识别、备注、收藏和发送。
- 状态工具：等待新消息、标记已读、配置关键词、`@`、提问、拍一拍或指定成员唤醒。
- 上下文工具：写入和查询记忆、查询或提交黑话、报告执行反馈。

默认配置带每分钟和每小时发送上限、批量发送间隔、最大消息长度和唤醒频率限制。AI 可以潜水，但不会在没有约束的情况下无限轮询或刷屏。

## 安全边界

- 白名单和黑名单在桥接层执行，黑名单优先。
- `qq-admin` 只会分配给开启 `ownerTools` 的 `ownerQQ` 私聊；群聊和其他私聊使用锁定、无本地工具的 `qq-chat-v2`，审批也只接受管理员操作。
- 群友模式的发送工具需要桥接签发的会话 token，不能仅凭本地 HTTP 地址任意调用。
- QQ 发送工具再次检查目标会话和白名单，并过滤伪造 CQ 码。
- 网页抓取工具拦截本机、内网和其他可能触发 SSRF 的地址。
- 敏感内容审计可以阻止部分密钥、凭据或高风险内容直接发回 QQ。
- SnowLuma 进程启停默认关闭；只有显式设置 `snowluma.allowProcessControl: true` 后才可能使用。

这些措施不能代替 DSH 自身的沙箱和审批。管理模式能够操作真实项目，请给 DSH 一个范围明确的工作目录，并保留工具审批。

## 测试与诊断

```bat
npm run self-test                         rem 只测试 DSH 会话链路
node scripts/check-onebot-status.mjs      rem 检查 OneBot HTTP 状态
node scripts/test-onebot-connection.mjs   rem 检查 OneBot 连接
npm run test-vision                       rem 测试图片/视觉消息
npm run test-forward                      rem 测试合并转发
npm run test-stickers                     rem 测试收藏表情
npm run test-wait                         rem 测试群友模式等待机制
```

部分脚本会创建测试会话或向白名单目标发送消息，运行前先检查脚本参数和 `config.json`。

## 常见问题

### DSH 报 `createZstdDecompress` 不存在

当前 Node.js 版本过低。升级到 Node.js 24，重新打开终端后确认：

```bat
node -v
npm -v
```

然后重新安装依赖并启动 DSH。

### SnowLuma 一直显示“QQ.exe 等待连接”

这发生在 OneBot 之前，说明 SnowLuma 尚未接入 QQ 进程。确认使用其支持的 QQ NT 版本、QQ 和 SnowLuma 权限级别一致、QQ 已登录，并查看 SnowLuma 日志中是否有注入或版本不匹配错误。管理员运行本身不能解决版本不兼容。

### 发送时报 HTTP 426

`snowluma.httpUrl` 填到了 WebSocket 端口。HTTP API 通常是 `3000`，WebSocket 通常是 `3001`，以 SnowLuma WebUI 的实际配置为准。

### 发送时报 401 / unauthorized

SnowLuma HTTP、WebSocket 与桥接使用的 access token 不一致。统一 token 后重启桥接。

### 看不到 `qq-mode` 设置卡片

先重新运行 `node scripts/setup-dsh.mjs web`，再执行：

```bat
pnpm dsh plugin --profile web install
```

随后重启 DSH。若使用其他 profile，请同时替换命令里的 `web`。

### QQ 消息没有进入 DSH

依次检查 SnowLuma 是否在线、WebSocket 是否连接、目标 QQ 或群是否在 `allow` 中、目标是否被 `deny` 拦截。

### 管理员私聊没有使用 `qq-admin`

确认 `ownerQQ` 与发送者 QQ 完全一致、`config.json` 中 `dsh.ownerTools` 为 `true`，并检查 `%USERPROFILE%\.dsh\.agent-presets\qq-admin` 是否存在。修改配置后重启桥接；旧会话仍绑定旧 preset 时，可在管理员私聊发送 `/reset`，再发一条新消息创建干净的管理员会话。

### DSH 重启时收到的消息会丢吗

桥接会在 DSH 不可用时按会话排队，并定期探测恢复。默认每个会话最多暂存 50 条，恢复后继续投递。不要在恢复前重复启动第二个桥接实例，单实例锁会主动拒绝它。

## 目录说明

```text
qq-bridge/
├── src/                         桥接主体、DSH 客户端和 MCP 服务
├── public/console.html          本地 Web 控制台
├── roles/                       可切换的 Markdown 角色卡
├── dsh/agent-presets/           qq-chat-v2 / qq-admin preset
├── plugins/qq-mode-console/     DSH 设置页模式插件
├── scripts/setup-dsh.mjs        DSH 端安装脚本
├── scripts/                     测试、诊断和维护脚本
├── docs/                        详细设计与安装说明
├── config.example.json          脱敏配置模板
└── state/                       会话、模式、记忆等运行状态，不提交 Git
```

核心实现入口是 `src/bridge.js`，DSH 协议客户端位于 `src/dsh-client.js`，QQ 安全工具位于 `src/mcp-snowluma-safe.js`。

## 使用提醒

机器人接入、自动发言和进程注入可能触发平台风控，也可能违反相关软件的使用条款。建议使用测试账号和测试群，控制发送频率，不要处理真实凭据或隐私数据。由此产生的账号、数据和合规风险由使用者自行承担。
