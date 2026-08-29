# DSH 端安装说明（另一台设备）

`qq-bridge` 仓库包含桥接、控制台、插件和两个 DSH agent preset。安装脚本会把 `qq-chat-v2`、`qq-admin` 以及 MCP 配置部署到目标设备的 DSH 环境。

## 安装步骤

在目标设备上：

1. **克隆/获取仓库**：

   ```bash
   git clone https://github.com/aplainjane/ai-chat-bot.git qq-bridge
   cd qq-bridge
   ```

2. **安装依赖**：

   ```bash
   npm install
   ```

   > `postinstall` 会自动修补 `@snowluma/sdk` 的 ESM 打包 bug。

3. **创建配置文件**：

   ```bash
   cp config.example.json config.json
   ```

   > Windows CMD 用户请用：`copy config.example.json config.json`

   然后编辑 `config.json`，填写：

   - `snowluma.wsUrl` / `httpUrl`（例如 `ws://127.0.0.1:3001` / `http://127.0.0.1:3000`，分别对应 OneBot WebSocket 与 HTTP API 端口）
   - `snowluma.accessToken`
   - `ownerQQ`
   - `dsh.ownerTools`（管理员私聊是否启用完整工具）
   - `dsh.ownerWorkspace`（管理员工具会话的工作目录）
   - `allow.private` / `allow.groups`

4. **运行 DSH 端安装脚本**：

   ```bash
   node scripts/setup-dsh.mjs
   ```

   默认安装到 `web` profile；如果 DSH 使用其他 profile，可以传参：

   ```bash
   node scripts/setup-dsh.mjs <profile名>
   ```

   脚本会完成：

   - 安装 agent preset：`~/.dsh/.agent-presets/qq-chat-v2`、`~/.dsh/.agent-presets/qq-admin`
   - 在 `~/.dsh/profiles/web/cordis.patch.yml` 挂载：
     - `mcp-snowluma`（`src/mcp-snowluma-safe.js`）
     - `mcp-snowluma-host`（`src/mcp-host-server.js`）
     - `mcp-web-search-safe`（`src/mcp-web-search-safe.js`）
   - 在 `~/.dsh/profiles/web/package.json` 注册 `qq-mode-console` 插件
   - 把 `qq-mode-console` 插件的默认模式设为 `reserved2`（二代仿真）
   - 创建本地 `state/mode.json`（`mode: reserved2`）作为 DSH settings 不可用时的兜底
   - 尝试自动执行 `dsh plugin --profile web install`（当 `dsh` CLI 在 PATH 中可用时），注册 `qq-mode-console` 的 bundle 依赖；若 `dsh` 不在 PATH，缺失依赖时 DSH 会提示补跑

   > 脚本可重复运行；它会覆盖上述三个 preset、更新 MCP 路径并重建失效的插件链接。
   > 已存在的 `qq-bridge/state/mode.json` 会被保留（不覆盖用户设置）；全新安装才会写入 `mode: reserved2`。
   > 如果之后把 `qq-bridge` 目录移动/重新 clone 到别的路径，请重新运行一次本脚本，否则 DSH 里的 MCP/插件绝对路径会指向旧位置。
   > 也可用环境变量指定 DSH 根目录：`DSH_HOME=/path/to/.dsh node scripts/setup-dsh.mjs <profile>`。

5. **重启 DSH**：

   必须重启 DSH（或让 DSH 重新加载 profile），新 preset 和 MCP 工具才会生效。

   > 默认模式为 **群友模式（`reserved2`）**，即“文本不自动转发、AI 通过工具自主收发”。当前仅此一种运行模式；如需临时指定模式，可修改 `state/mode.json` 后重启桥接（只能写 `reserved2`）。

## 验证是否装好

1. **DSH WebUI 设置页**：应能看到 `qq-mode` 配置卡片，显示当前模式为群友模式（`reserved2`）。
2. **新建会话时**：agent preset 列表中应能看到：
   - `QQ 聊天角色（二代仿真）`（`qq-chat-v2`，群友模式使用，锁定无本地工具）
   - `QQ 管理员助手（完整工具）`（`qq-admin`，管理员私聊使用）
3. **工具列表**：普通 `qq-chat-v2` 会话只能看到受限工具，不应出现 PowerShell 或文件写入工具；`qq-admin` 会话则应能看到 PowerShell、文件读写、搜索和后台任务等本地工具。

## 配置和使用管理员工具会话

在 `config.json` 的 `dsh` 节点加入：

```json
{
  "dsh": {
    "ownerTools": true,
    "ownerWorkspace": "F:\\deepseek harness\\workspace"
  },
  "ownerQQ": 123456789
}
```

- `ownerQQ` 必须是管理员本人 QQ。
- `ownerTools: true` 让该 QQ 的私聊优先使用 `qq-admin`。
- `ownerWorkspace` 是 DSH 执行文件和终端任务的目录，应限制在确实需要操作的项目范围内。

重启 DSH 和桥接后，用管理员 QQ 私聊机器人。如果以前已经聊过，先发送 `/reset` 清掉旧会话映射，再发送“查看这个项目并运行测试”之类的任务。日志出现 `preset: qq-admin` 即表示加载成功。

管理员可以继续在 QQ 中补充要求；新消息会直接 steer 到当前 DSH 工作会话。DSH 发起问题时直接回复答案，工具审批则回复 `通过` 或 `拒绝`。发送 `/role 小鲸鱼` 可以在保留完整工具能力的同时切换表达人设，`/role off` 恢复默认管理员助手。

`ownerTools` 开启后，管理员私聊始终优先进入 `qq-admin` 工具会话，不受当前运行模式影响。

## 常见问题

- **看不到 `qq-mode` 设置卡片**：确认 `setup-dsh.mjs` 已把 `qq-mode-console` 加入 profile 的 `package.json` bundles，并重启 DSH。
- **MCP 工具没有出现**：确认 `cordis.patch.yml` 中三个 MCP 条目的路径指向当前仓库，并重启 DSH。
- **preset 没有出现**：确认 `~/.dsh/.agent-presets/qq-chat-v2` 和 `qq-admin` 存在，并重启 DSH。
- **管理员仍进入普通聊天 preset**：确认 `ownerQQ` 正确、`dsh.ownerTools` 为 `true`；然后在管理员私聊发送 `/reset`，让桥接创建新的 `qq-admin` 会话。
- **启动 DSH 报 `failed to parse overlay cordis.patch.yml: YAMLException`**：多为历史版脚本残留的空数组 `[]` 引发。重新运行最新版脚本（会自动剥离）即可，或手动删除该文件里独立成行的 `[]` 后重启 DSH。
- **启动 DSH 报 `cannot resolve profile bundle "qq-mode-console"`**：profile 的 bundle 依赖尚未安装。运行 `dsh plugin --profile web install`（`web` 换成你的实际 profile 名）后重启 DSH；新版脚本会尝试自动执行这一步。
- **发送消息报 `unauthorized` / HTTP 401**：`config.json` 的 `snowluma.accessToken` 与 SnowLuma 的 OneBot 实例 token 不一致。将 SnowLuma WebUI 中 HTTP 与 WebSocket 两端的 accessToken 设为相同，再填入 `config.json`，然后重启桥。
- **发送消息报 HTTP 426（Upgrade Required）**：说明 `config.json` 里的 `snowluma.httpUrl` 指向了 **WebSocket 端口**。`httpUrl` 必须是 OneBot 的 **HTTP API 地址**（例如 `http://127.0.0.1:3000`），而 `wsUrl` 才是 WebSocket 地址（例如 `ws://127.0.0.1:3001`）。请在 SnowLuma WebUI 的 OneBot 配置里分别确认 HTTP 和 WebSocket 的端口。也可以运行诊断脚本：
   ```bash
   node scripts/check-onebot-status.mjs
   ```
