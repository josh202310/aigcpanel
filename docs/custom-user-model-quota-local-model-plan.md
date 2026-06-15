# AIGCPanel 用户、模型、配额与本地模型改造方案

本文档用于在正式改代码前统一改造范围、落点和实施顺序。方案基于当前代码结构分析，目标是尽量复用现有架构，降低一次性改造风险。

## 1. 当前系统结构概览

### 1.1 技术栈

- 桌面壳：Electron
- 前端：Vue 3 + Pinia + Arco Design
- 构建：Vite
- 本地数据：better-sqlite3 + Electron IPC
- 任务系统：前端任务调度 + 本地 SQLite 任务记录
- 模型体系分为两套：聊天大模型 Provider、本地/远程 AIGC 服务 Server

### 1.2 关键目录

- `src/module/Model/`：聊天大模型配置、选择、调用。
- `src/store/modules/user.ts`：前端用户状态。
- `electron/mapi/user/`：Electron 主进程用户 IPC、用户信息获取、用户 API 请求代理。
- `src/service/PermissionService.ts`：云模型任务权限检查。
- `src/store/modules/task.ts`：任务调度队列。
- `src/service/TaskService.ts`：任务记录的 SQLite 增删改查。
- `src/store/modules/server.ts`：本地/远程/云端模型服务管理。
- `electron/aigcserver/`：本地和远程 AIGC 服务执行适配。
- `electron/mapi/db/`：SQLite 初始化与迁移。

### 1.3 当前两类模型调用

#### 聊天大模型调用链

```text
ModelAgentButton / ModelGenerateButton
  -> ModelGenerator.vue
  -> src/module/Model/store/model.ts
  -> src/module/Model/provider/provider.ts
  -> src/module/Model/provider/driver/openai.ts
  -> fetch(OpenAI-compatible chat completions)
```

当前底层只实现了 `openai` 类型，所有聊天模型都按 OpenAI Chat Completions 协议调用。

#### 本地/远程 AIGC 服务调用链

```text
业务创建页面
  -> PermissionService.checkForTask
  -> TaskService.submit
  -> taskStore.dispatch
  -> 具体 task.runFunc
  -> serverStore.call
  -> $mapi.server.callFunctionWithException
  -> EasyServer / RemoteServer / CloudServer 适配
```

这一套主要服务于 TTS、ASR、数字人视频、文生图、图生图等任务。

## 2. 改造目标

### 2.1 目标一：大模型改为自己配置的模型

支持把当前聊天大模型调用切换到自己的模型服务。

需要支持两类模型服务：

- OpenAI 兼容接口：最优先支持，改造量小。
- 非 OpenAI 兼容接口：通过新增 provider driver 支持。

### 2.2 目标二：用户模块改为自己的用户管理模块

将当前依赖 `https://aigcpanel.com/api/app_manager/*` 的用户系统替换为自己的用户系统。

要求保留前端现有用户状态结构，减少页面改动。

### 2.3 目标三：每个用户计算调用次数和配额

支持按用户统计和限制调用次数、配额或点数。

需要覆盖：

- 聊天大模型调用。
- TTS、ASR、视频生成、图片生成等任务。
- 本地模型和云端模型是否计费可配置。

### 2.4 目标四：加入调用本地模型的功能

支持两类本地模型：

- 本地聊天模型：Ollama、LM Studio、LocalAI、vLLM、llama.cpp server 等。
- 本地任务模型：TTS、ASR、数字人、文生图、图生图等。

## 3. 用户模块改造方案

### 3.1 当前用户模块现状

当前配置入口：

- `src/config.ts`

当前用户主逻辑：

- `electron/mapi/user/main.ts`
- `electron/mapi/user/render.ts`
- `src/store/modules/user.ts`
- `src/hooks/user.ts`
- `src/api/user.ts`

当前官方接口：

- `POST app_manager/user_info`
- `GET app_manager/user_web`
- `GET app_manager/enter`
- 其他接口统一通过 `window.$mapi.user.apiPost(...)` 调用。

当前前端用户状态结构：

```ts
{
  apiToken: string | null,
  user: {
    id: string | null,
    name: string | null,
    avatar: string | null,
    deviceCode: string | null
  },
  data: {
    vip: {
      id: string | null,
      flag: string | null,
      title: string | null,
      icon: string | null,
      isDefault: boolean
    },
    functions: Record<string, any>
  },
  basic: Record<string, any>
}
```

### 3.2 推荐保留的兼容结构

你的用户系统建议返回兼容结构：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "apiToken": "user-token",
    "user": {
      "id": "10001",
      "name": "张三",
      "avatar": "https://example.com/avatar.png",
      "deviceCode": "optional-device-code"
    },
    "data": {
      "vip": {
        "id": "plan_basic",
        "flag": "basic",
        "title": "基础版",
        "icon": "",
        "isDefault": false
      },
      "functions": {},
      "quota": {
        "llm": {
          "limit": 1000,
          "used": 20,
          "remaining": 980,
          "resetAt": 1767225600000
        },
        "task": {
          "limit": 100,
          "used": 3,
          "remaining": 97,
          "resetAt": 1767225600000
        }
      }
    },
    "basic": {
      "userEnable": true
    }
  }
}
```

### 3.3 建议新增配置

在 `src/config.ts` 中增加自己的服务配置。示例：

```ts
const BASE_URL = "https://your-domain.com";

export const AppConfig = {
  ...,
  apiBaseUrl: `${BASE_URL}/api`,
  authBaseUrl: `${BASE_URL}/api`,
  quotaBaseUrl: `${BASE_URL}/api`,
};
```

如果用户系统、配额系统、业务 API 是同一个后端，可以只保留 `apiBaseUrl`。

### 3.4 后端接口建议

最少需要：

```text
POST /api/user/info
POST /api/user/logout
POST /api/usage/check
POST /api/usage/consume
POST /api/usage/summary
POST /api/usage/records
```

如果仍需内嵌用户中心页面：

```text
GET /api/user/web
GET /api/user/enter
```

如果不需要内嵌页面，可以将 `PageUser.vue` 改成本地用户信息页。

### 3.5 用户模块改造落点

优先改：

- `electron/mapi/user/main.ts`
  - 替换 `userInfoApi()`。
  - 替换 `post()` 的 URL 拼接和 token header。
  - 替换 `getWebEnterUrl()` 和 `openWebUrl()`，或改成本地页面。
- `src/store/modules/user.ts`
  - 保持现有字段。
  - 增加 `quota`、`usage` 的类型声明。
- `src/hooks/user.ts`
  - 如果不再使用官方用户 web 页面，需要调整白名单和跳转逻辑。
- `src/config.ts`
  - 替换官方域名和 API 地址。

### 3.6 用户认证建议

推荐让 Electron 主进程统一保存和附带 token：

- 渲染进程不直接处理敏感 token 的请求细节。
- 所有需要鉴权的业务接口走 `window.$mapi.user.apiPost`。
- 用户 token 缓存在现有 `StorageMain.set("user", "data", ...)`。

## 4. 大模型 Provider 改造方案

### 4.1 当前大模型实现

关键文件：

- `src/module/Model/types.ts`
- `src/module/Model/providers.ts`
- `src/module/Model/store/model.ts`
- `src/module/Model/provider/provider.ts`
- `src/module/Model/provider/driver/base.ts`
- `src/module/Model/provider/driver/openai.ts`
- `src/module/Model/ModelSetting.vue`
- `src/module/Model/ModelSelector.vue`

当前 `ProviderType` 只有：

```ts
export type ProviderType = "openai";
```

当前调用体：

```json
{
  "model": "model-id",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

### 4.2 OpenAI 兼容模型接入

如果你的模型服务兼容 OpenAI `/v1/chat/completions`，优先走这个方案。

用户在大模型设置页添加：

- Provider 名称：自定义，例如 `公司内网模型`。
- Provider 类型：`openai`。
- API URL/API Host：你的模型服务地址，例如 `https://llm.example.com` 或 `http://127.0.0.1:8000`。
- API Key：如需要则填写，不需要可为空。
- Model ID：例如 `qwen2.5-72b-instruct`。

需要优化点：

- API Key 允许为空。
- 自定义 Provider 的 `apiUrl` 当前创建时为空，实际依赖 `data.apiHost`，可保留。
- 增加默认自定义模型配置入口，减少用户手工添加步骤。

### 4.3 非 OpenAI 兼容模型接入

如果你的模型接口不是 OpenAI 协议，新增 driver。

建议新增：

```text
src/module/Model/provider/driver/custom.ts
```

修改：

```ts
export type ProviderType = "openai" | "custom";
```

在 `provider.ts` 注册：

```ts
const ModelProviderMap = {
  openai: OpenAiModelProvider,
  custom: CustomModelProvider,
};
```

在 `ModelProvider.apiUrl()` 中增加：

```ts
case "custom":
  return apiHost || apiUrl;
```

`CustomModelProvider.chat()` 负责把内部统一参数转换成你的接口格式，再把响应转换成：

```ts
{
  code: 0,
  msg: "ok",
  data: {
    content: "模型输出内容",
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  }
}
```

### 4.4 建议扩展 ChatParam

当前 `ChatParam` 只有：

```ts
export type ChatParam = {
  systemPrompt: string | null;
};
```

建议扩展为：

```ts
export type ChatParam = {
  systemPrompt: string | null;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  metadata?: Record<string, any>;
};
```

第一阶段可以不做流式输出，先保留 `stream?: false`。

### 4.5 建议扩展返回 usage

`ModelChatResult` 建议扩展：

```ts
export type ModelChatResult = {
  code: number;
  msg: string;
  data?: {
    content?: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    [key: string]: any;
  };
};
```

这样配额系统可以按次数或 token 计费。

## 5. 配额与调用次数改造方案

### 5.1 配额统计原则

如果是多用户系统，配额校验必须在后端完成，客户端只做：

- 调用前预检查。
- 调用后上报消耗。
- 本地缓存展示。
- 离线或网络异常时给出明确提示。

不要只依赖本地 SQLite 做硬限制，因为用户可以修改本地数据。

### 5.2 统计维度

建议支持以下维度：

- `userId`：用户 ID。
- `scene`：调用场景，如 `llm_chat`、`sound_tts`、`asr`、`video_gen`、`text_to_image`。
- `providerId`：聊天模型供应商。
- `modelId`：模型 ID。
- `biz`：任务业务类型。
- `taskId`：任务 ID。
- `amount`：消耗数量。
- `amountType`：`count`、`token`、`credit`、`second`。
- `status`：`reserved`、`consumed`、`failed`、`refunded`。
- `meta`：请求、响应、错误等扩展信息。

### 5.3 后端配额接口建议

调用前检查：

```text
POST /api/usage/check
```

请求：

```json
{
  "scene": "llm_chat",
  "providerId": "openai",
  "modelId": "gpt-4o-mini",
  "amount": 1,
  "amountType": "count",
  "meta": {}
}
```

响应：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "allowed": true,
    "remaining": 99,
    "usageId": "usage-reservation-id"
  }
}
```

调用后扣减：

```text
POST /api/usage/consume
```

请求：

```json
{
  "usageId": "usage-reservation-id",
  "scene": "llm_chat",
  "providerId": "openai",
  "modelId": "gpt-4o-mini",
  "amount": 1234,
  "amountType": "token",
  "success": true,
  "meta": {
    "promptTokens": 500,
    "completionTokens": 734
  }
}
```

配额概览：

```text
POST /api/usage/summary
```

### 5.4 客户端 UsageService 设计

建议新增：

```text
src/service/UsageService.ts
```

职责：

- 从 `userStore` 获取当前用户。
- 统一调用 `window.$mapi.user.apiPost`。
- 提供 `check`、`consume`、`recordLocal`、`summary` 方法。
- 失败时返回统一错误。

建议接口：

```ts
export const UsageService = {
  async check(input: UsageCheckInput): Promise<UsageCheckResult>;
  async consume(input: UsageConsumeInput): Promise<void>;
  async recordLocal(input: UsageRecordInput): Promise<void>;
  async summary(): Promise<UsageSummary>;
};
```

### 5.5 本地用量表

建议在 `electron/mapi/db/migration.ts` 增加新版本迁移：

```sql
CREATE TABLE IF NOT EXISTS data_usage_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
  userId TEXT,
  scene TEXT,
  providerId TEXT,
  modelId TEXT,
  biz TEXT,
  taskId TEXT,
  amount INTEGER,
  amountType TEXT,
  status TEXT,
  remoteUsageId TEXT,
  meta TEXT
);
```

注意：当前 `data_task.createdAt` 是秒级，部分代码传入的是毫秒时间戳。后续统计时要统一时间单位，建议新表明确使用毫秒时间戳，或者命名为 `createdAtMs`。

### 5.6 聊天大模型配额落点

推荐在 `src/module/Model/store/model.ts` 的 `chat()` 中包裹：

```text
modelStore.chat
  -> UsageService.check(scene=llm_chat)
  -> ModelProvider.chat
  -> UsageService.consume(success/fail, usage tokens)
```

优点：

- 所有聊天大模型调用都会经过这里。
- `ModelGenerator.vue`、`ModelAgentButton.vue` 不需要分别改。

### 5.7 任务模型配额落点

有两个可选方案。

#### 方案 A：在 TaskService.submit() 处检查

优点：

- 用户提交任务时立刻提示配额不足。
- 覆盖所有任务。

缺点：

- 只知道任务类型，不一定知道最终模型调用成本。
- 多步骤任务可能需要额外扣减。

#### 方案 B：在 serverStore.call() 处检查和扣减

优点：

- 所有本地/远程/云端服务调用都经过这里。
- 能按真实调用函数计费，如 `soundTts`、`asr`、`videoGen`。

缺点：

- 调用已经进入任务执行阶段，失败时要更新任务状态。

#### 推荐组合

- `TaskService.submit()` 做粗粒度预检查。
- `serverStore.call()` 做真实扣减。
- 缓存命中时不扣费，或按配置决定是否扣费。

### 5.8 配额失败处理

当配额不足时：

- 聊天模型：直接返回 `{ code: -1, msg: "配额不足" }`。
- 任务模型：任务不进入队列，或进入失败状态并显示原因。
- 页面展示：复用 `Dialog.tipError`，必要时打开用户中心或配额页。

## 6. 本地模型调用方案

### 6.1 本地聊天模型

适用：

- Ollama
- LM Studio
- LocalAI
- vLLM OpenAI server
- llama.cpp server 的 OpenAI 兼容模式

当前项目已经有 `ollama` 和 `lmstudio` provider 配置：

```ts
ollama: {
  api: { url: "http://localhost:11434" }
}

lmstudio: {
  api: { url: "http://localhost:1234" }
}
```

当前 `ModelProvider.apiUrl()` 会拼接成：

```text
http://localhost:11434/v1/chat/completions
http://localhost:1234/v1/chat/completions
```

Ollama 和 LM Studio 都可支持 OpenAI 兼容接口，因此第一阶段可以直接复用 `openai` driver。

建议优化：

- 本地 provider API Key 可为空。
- 设置页中本地 provider 隐藏 API Key 或显示“可为空”。
- 增加常用本地模型默认项，如 `llama3.1`、`qwen2.5`、`deepseek-r1`。
- 增加连接测试，显示本地服务未启动时的清晰错误。

### 6.2 Ollama 原生接口可选方案

如果不想依赖 Ollama 的 OpenAI 兼容接口，可新增：

```text
src/module/Model/provider/driver/ollama.ts
```

调用：

```text
POST /api/chat
```

请求：

```json
{
  "model": "qwen2.5",
  "messages": [...],
  "stream": false
}
```

但第一阶段不建议做，除非确实需要 Ollama 原生特性。

### 6.3 本地任务模型

适用：

- 本地 TTS
- 本地 ASR
- 本地数字人视频生成
- 本地文生图/图生图

应复用现有 Server 体系，而不是接入聊天 Provider。

本地模型目录由 `src/store/modules/server.ts` 扫描：

```text
model/<模型目录>/config.json
```

`config.json` 中需要定义：

- `name`
- `title`
- `version`
- `functions`
- `settings`
- `easyServer`

`EasyServer` 会启动本地命令，并通过日志提取结果。

支持函数：

- `soundTts`
- `soundClone`
- `videoGen`
- `asr`
- `textToImage`
- `imageToImage`

### 6.4 本地模型与配额关系

建议配置化：

- 本地聊天模型是否计入配额。
- 本地任务模型是否计入配额。
- 本地模型是否只统计次数、不扣点数。

推荐默认策略：

- 云端模型：检查并扣减配额。
- 自有模型 API：检查并扣减配额。
- 纯本地模型：只统计次数，不限制，除非后台策略要求限制。

## 7. 页面与交互改造

### 7.1 大模型设置页

文件：

- `src/module/Model/ModelSetting.vue`
- `src/module/Model/components/ProviderAddDialog.vue`
- `src/module/Model/components/ProviderEditDialog.vue`
- `src/module/Model/components/ProviderTestDialog.vue`
- `src/module/Model/components/ModelAddDialog.vue`

建议调整：

- 新增 Provider 类型选择：`openai`、`custom`、可选 `ollama`。
- 自定义 Provider 支持填写 `apiHost`。
- 本地 Provider API Key 可为空。
- 测试按钮使用统一错误文案。

### 7.2 用户页面

当前 `PageUser.vue` 主要承载官方 Web 用户中心。

可选方案：

#### 方案 A：继续嵌入你的用户中心页面

保留 webview 逻辑，只替换 URL。

优点：

- 桌面端改动少。
- 会员、充值、配额记录由你的 Web 后台负责。

#### 方案 B：改成本地用户中心页面

直接在 Vue 中展示：

- 当前用户。
- 套餐。
- 配额余额。
- 调用次数。
- 最近使用记录。

优点：

- 体验更统一。
- 不依赖 webview。

缺点：

- 前端页面工作量更大。

建议第一阶段采用方案 A。

### 7.3 配额展示入口

建议在以下位置展示简要配额：

- `src/components/PageNav.vue`：用户头像旁显示套餐或剩余额度。
- `src/pages/Home.vue`：增加今日调用次数、剩余额度。
- `src/pages/PageUser.vue`：展示完整配额信息。

第一阶段只做 `PageUser.vue` 或 web 用户中心即可。

## 8. 代码实施阶段规划

### 阶段 1：用户系统替换

目标：应用能登录/识别你的用户，所有用户信息从你的接口获取。

修改文件：

- `src/config.ts`
- `electron/mapi/user/main.ts`
- `src/store/modules/user.ts`
- 必要时修改 `src/hooks/user.ts`、`src/pages/PageUser.vue`

验收标准：

- 启动后能获取你的用户信息。
- `userStore.user.id` 正确。
- `userStore.apiToken` 正确。
- `window.$mapi.user.apiPost` 能请求你的后端。
- 退出/刷新用户信息逻辑正常。

### 阶段 2：自定义大模型配置

目标：聊天大模型可以使用你的模型。

修改文件：

- `src/module/Model/types.ts`
- `src/module/Model/provider/provider.ts`
- `src/module/Model/provider/driver/openai.ts`
- 如果非兼容接口，新增 `src/module/Model/provider/driver/custom.ts`
- 必要时修改 `src/module/Model/providers.ts`
- 必要时修改模型设置相关组件

验收标准：

- 可以添加你的 Provider。
- 可以添加模型 ID。
- 模型测试成功。
- AI 生成按钮能使用你的模型返回内容。

### 阶段 3：UsageService 和聊天模型配额

目标：聊天大模型调用开始统计和限制。

修改文件：

- 新增 `src/service/UsageService.ts`
- `src/module/Model/store/model.ts`
- `electron/mapi/db/migration.ts`
- 可选新增 `src/service/UsageRecordService.ts`

验收标准：

- 调用前会检查配额。
- 配额不足时不调用模型。
- 调用成功后会消费配额。
- 调用失败按规则记录失败或释放预占额度。
- 本地有用量记录。

### 阶段 4：任务模型配额

目标：TTS、ASR、视频、图像等任务也纳入配额统计。

修改文件：

- `src/service/TaskService.ts`
- `src/store/modules/server.ts`
- `src/service/PermissionService.ts`
- `src/lib/server.ts`
- 具体任务文件按需调整

验收标准：

- 创建任务前会检查配额。
- 执行真实模型调用时会扣减配额。
- 缓存命中策略符合预期。
- 配额不足时任务不会无声失败。

### 阶段 5：本地聊天模型体验完善

目标：Ollama/LM Studio 等本地聊天模型能稳定使用。

修改文件：

- `src/module/Model/providers.ts`
- `src/module/Model/store/model.ts`
- `src/module/Model/provider/provider.ts`
- `src/module/Model/provider/driver/openai.ts`
- 模型设置页相关组件

验收标准：

- Ollama 默认地址可用。
- LM Studio 默认地址可用。
- API Key 可为空。
- 本地服务未启动时错误清晰。
- 本地模型可被 `ModelGenerator` 使用。

### 阶段 6：本地任务模型接入

目标：按现有 Server 体系接入你的本地任务模型。

修改/新增：

- 新增模型目录 `model/<your-model>/config.json`。
- 必要时新增启动脚本。
- 必要时调整 `EasyServer` 结果解析规则。

验收标准：

- 模型在服务列表中出现。
- 能启动/停止。
- 对应功能能创建任务并成功返回结果。
- 日志和错误可查看。

## 9. 风险点与注意事项

### 9.1 不建议只做客户端配额

客户端配额容易被绕过。真正限制必须放在后端。

### 9.2 时间戳单位要统一

当前部分表使用秒级 `strftime('%s', 'now')`，业务逻辑里大量使用毫秒时间戳。新增用量表建议明确使用毫秒字段，避免统计日期出错。

### 9.3 OpenAI 兼容接口差异

不同供应商对 `/v1/chat/completions` 的兼容程度不同：

- 有的要求 `Authorization` 必须存在。
- 有的本地服务不接受空 Bearer。
- 有的返回 `usage` 字段不完整。
- 有的错误返回不是 JSON。

需要在 `openai.ts` 中增强兼容性。

### 9.4 本地模型跨域不是主要问题

Electron 渲染进程中直接 fetch 本地服务通常可行，但更稳妥的做法是通过主进程代理。第一阶段可保持现状，若遇到 CORS 或证书问题，再引入主进程代理。

### 9.5 任务扣费幂等

任务可能重试，`serverStore.call()` 可能多次返回 `retry`。配额扣减必须具备幂等 ID，建议使用：

```text
scene + biz + taskId + functionName + attemptId
```

或者由后端返回 `usageId` 并保证重复提交不会重复扣费。

## 10. 推荐后端数据模型

### 10.1 用户表

```sql
users(
  id,
  name,
  avatar,
  status,
  created_at,
  updated_at
)
```

### 10.2 用户套餐表

```sql
user_plans(
  id,
  user_id,
  plan_code,
  title,
  starts_at,
  ends_at,
  status
)
```

### 10.3 配额表

```sql
user_quotas(
  id,
  user_id,
  scene,
  amount_type,
  limit_amount,
  used_amount,
  reset_cycle,
  reset_at
)
```

### 10.4 用量流水表

```sql
usage_records(
  id,
  user_id,
  scene,
  provider_id,
  model_id,
  biz,
  task_id,
  amount,
  amount_type,
  status,
  idempotency_key,
  meta,
  created_at
)
```

## 11. 建议优先确认的问题

在开始改代码前，需要确认以下问题：

1. 你的用户系统是否已有 API？返回结构能否兼容本文建议？
2. 你的大模型服务是否兼容 OpenAI `/v1/chat/completions`？
3. 配额按“调用次数”扣，还是按 token/点数扣？
4. 本地模型是否需要计入配额？
5. 用户中心页面继续用 webview，还是改成本地 Vue 页面？
6. 任务模型的配额是提交即扣，成功后扣，还是预占后结算？

## 12. 最小可行改造路径

如果希望最快跑通，建议按下面路线：

1. 用户接口返回兼容 `user_info` 结构。
2. 将 `AppConfig.apiBaseUrl` 改为你的后端。
3. 替换 `electron/mapi/user/main.ts` 的用户接口路径。
4. 让你的模型服务提供 OpenAI 兼容接口。
5. 在大模型设置中配置自定义 Provider 和 Model ID。
6. 新增 `UsageService`，先只统计 `modelStore.chat()` 调用次数。
7. 再把 `serverStore.call()` 纳入配额统计。
8. 最后完善本地 Ollama/LM Studio 和本地任务模型体验。

## 13. 第一轮建议实现清单

第一轮代码修改建议控制在以下范围：

- `src/config.ts`：配置你的 API 地址。
- `electron/mapi/user/main.ts`：替换用户信息接口和 API 代理。
- `src/store/modules/user.ts`：扩展 quota 类型。
- `src/module/Model/provider/driver/openai.ts`：增强 API Key 为空、本地模型错误处理、usage 返回。
- `src/module/Model/provider/provider.ts`：保持 OpenAI 兼容模型 URL 拼接，必要时增加自定义类型。
- `src/service/UsageService.ts`：新增用量服务。
- `src/module/Model/store/model.ts`：聊天调用接入配额检查和消费。
- `electron/mapi/db/migration.ts`：新增本地用量表。

完成第一轮后，再进入任务配额和本地任务模型接入。

