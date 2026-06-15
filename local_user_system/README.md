# Local User System for AIGCPanel

这是一个用于 AIGCPanel 联调的本地用户、Token、配额和用量统计服务。它只依赖 Python 标准库，使用 SQLite 存储数据，可以很容易迁移到 Ubuntu 云服务器。

## 功能

- 用户注册、登录。
- 兼容 AIGCPanel 当前 `app_manager/user_info` 返回结构。
- `Api-Token` / `Authorization: Bearer` 鉴权。
- 用户配额初始化、检查、扣减。
- 用量流水记录。
- 默认开发用户，方便本地调试。
- 无第三方 Python 依赖。

## 目录

```text
local_user_system/
  app.py                # 服务主程序
  config.example.json   # 配置示例
  config.json           # 首次启动自动从示例生成，本地环境文件
  data/                 # SQLite 数据目录，已加入 .gitignore
  run.sh                # 启动脚本
```

## 本地启动

```bash
cd local_user_system
cp config.example.json config.json
python3 app.py --config config.json
```

或：

```bash
cd local_user_system
chmod +x run.sh
./run.sh
```

默认监听：

```text
http://127.0.0.1:18080
```

默认用户：

```text
username: demo
password: demo123456
```

`config.json` 中 `dev_auto_login` 默认为 `true`。这表示没有 Token 时，`/api/app_manager/user_info` 会自动返回默认用户，方便 AIGCPanel 本地联调。部署到服务器时建议改为 `false`。

## AIGCPanel 对接方式

第一阶段可以把 AIGCPanel 的 `src/config.ts` 改成：

```ts
const BASE_URL = "http://127.0.0.1:18080";

export const AppConfig = {
  // ...
  apiBaseUrl: `${BASE_URL}/api`,
};
```

当前服务兼容这些路径：

- `POST /api/app_manager/user_info`
- `GET /api/app_manager/user_web`

因此可以先少改客户端代码。

## API

### 健康检查

```text
GET /health
GET /api/health
POST /api/health
```

### 注册

```text
POST /api/user/register
```

请求：

```json
{
  "username": "alice",
  "password": "password123",
  "name": "Alice"
}
```

### 登录

```text
POST /api/user/login
```

请求：

```json
{
  "username": "demo",
  "password": "demo123456"
}
```

响应会返回兼容 AIGCPanel 的结构：

```json
{
  "code": 0,
  "msg": "ok",
  "data": {
    "apiToken": "...",
    "user": {
      "id": "1",
      "name": "Demo User",
      "avatar": "",
      "deviceCode": "",
      "username": "demo"
    },
    "data": {
      "vip": {
        "id": "local_default",
        "flag": "local",
        "title": "本地用户",
        "icon": "",
        "isDefault": false
      },
      "functions": {},
      "quota": {}
    },
    "basic": {
      "userEnable": true
    }
  }
}
```

### 用户信息

```text
POST /api/user/info
POST /api/app_manager/user_info
```

请求头：

```text
Api-Token: <token>
```

或：

```text
Authorization: Bearer <token>
```

### 配额检查

```text
POST /api/usage/check
```

请求：

```json
{
  "scene": "llm_chat",
  "amount": 1,
  "amountType": "count",
  "providerId": "openai",
  "modelId": "gpt-4o-mini"
}
```

### 配额扣减

```text
POST /api/usage/consume
```

请求：

```json
{
  "usageId": "local-reservation-id",
  "scene": "llm_chat",
  "amount": 1,
  "amountType": "count",
  "success": true,
  "providerId": "openai",
  "modelId": "gpt-4o-mini",
  "meta": {
    "promptTokens": 10,
    "completionTokens": 20,
    "totalTokens": 30
  }
}
```

`usageId` 或 `idempotencyKey` 会作为幂等键，同一个键重复提交不会重复扣减。

### 配额概览

```text
POST /api/usage/summary
```

### 用量记录

```text
POST /api/usage/records
```

请求：

```json
{
  "limit": 50,
  "offset": 0
}
```

## 配额配置

默认配额在 `config.json` 的 `default_quotas` 中配置。

示例：

```json
{
  "scene": "llm_chat",
  "amount_type": "count",
  "limit_amount": 1000,
  "reset_cycle": "month"
}
```

支持的 `reset_cycle`：

- `day`：每天重置。
- `month`：每月重置。
- `never`：不自动重置。

当前默认场景：

- `llm_chat`
- `task`
- `sound_tts`
- `asr`
- `video_gen`
- `text_to_image`
- `image_to_image`

## Ubuntu 部署

### 1. 安装 Python

Ubuntu 22.04/24.04 通常已自带 Python 3。确认：

```bash
python3 --version
```

### 2. 上传目录

把 `local_user_system` 上传到服务器，例如：

```text
/opt/aigcpanel-user-system
```

### 3. 准备配置

```bash
cd /opt/aigcpanel-user-system
cp config.example.json config.json
```

生产建议修改：

```json
{
  "host": "127.0.0.1",
  "port": 18080,
  "dev_auto_login": false
}
```

如果要直接暴露端口，可以设置：

```json
{
  "host": "0.0.0.0"
}
```

更推荐使用 Nginx 反向代理，并保持服务监听 `127.0.0.1`。

### 4. systemd 服务

创建：

```bash
sudo nano /etc/systemd/system/aigcpanel-user-system.service
```

内容：

```ini
[Unit]
Description=AIGCPanel Local User System
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/aigcpanel-user-system
ExecStart=/usr/bin/python3 /opt/aigcpanel-user-system/app.py --config /opt/aigcpanel-user-system/config.json
Restart=always
RestartSec=3
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable aigcpanel-user-system
sudo systemctl start aigcpanel-user-system
sudo systemctl status aigcpanel-user-system
```

### 5. Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name user-api.example.com;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

之后 AIGCPanel 中配置：

```ts
const BASE_URL = "http://user-api.example.com";
apiBaseUrl: `${BASE_URL}/api`
```

## 安全建议

- 生产环境关闭 `dev_auto_login`。
- 修改默认用户密码，或删除默认用户。
- 使用 HTTPS。
- 重要配额扣减以后应接入真实后端鉴权和审计。
- SQLite 适合轻量部署；用户量增大后可以迁移到 PostgreSQL/MySQL。

