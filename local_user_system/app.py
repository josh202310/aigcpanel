#!/usr/bin/env python3
import argparse
import base64
import calendar
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import traceback
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


APP_NAME = "LocalUserSystem"
CONFIG = {}
DB_PATH = ""


def now_ms():
    return int(time.time() * 1000)


def month_reset_at_ms(ts_ms=None):
    ts = (ts_ms or now_ms()) / 1000
    dt = time.localtime(ts)
    year = dt.tm_year
    month = dt.tm_mon + 1
    if month > 12:
        month = 1
        year += 1
    return int(time.mktime((year, month, 1, 0, 0, 0, 0, 0, -1)) * 1000)


def day_reset_at_ms(ts_ms=None):
    ts = (ts_ms or now_ms()) / 1000
    dt = time.localtime(ts)
    return int(time.mktime((dt.tm_year, dt.tm_mon, dt.tm_mday + 1, 0, 0, 0, 0, 0, -1)) * 1000)


def calc_reset_at(reset_cycle):
    if reset_cycle == "day":
        return day_reset_at_ms()
    if reset_cycle == "never":
        return 0
    return month_reset_at_ms()


def json_dumps(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def api_ok(data=None, msg="ok"):
    return {"code": 0, "msg": msg, "data": data if data is not None else {}}


def api_error(msg, code=10000, data=None):
    return {"code": code, "msg": msg, "data": data if data is not None else {}}


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000
    )
    return salt, base64.b64encode(digest).decode("ascii")


def verify_password(password, salt, password_hash):
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, password_hash)


def token_value():
    return secrets.token_urlsafe(48)


def load_config(path):
    if not os.path.exists(path):
        example = os.path.join(os.path.dirname(path), "config.example.json")
        if os.path.exists(example):
            with open(example, "r", encoding="utf-8") as f:
                config = json.load(f)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return config
        raise FileNotFoundError(path)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def db_execute(sql, params=()):
    with db_connect() as conn:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid


def db_first(sql, params=()):
    with db_connect() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchone()


def db_select(sql, params=()):
    with db_connect() as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall()


def migrate():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db_connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token TEXT UNIQUE NOT NULL,
                expires_at_ms INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                last_used_at_ms INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS user_quotas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scene TEXT NOT NULL,
                amount_type TEXT NOT NULL,
                limit_amount INTEGER NOT NULL,
                used_amount INTEGER NOT NULL DEFAULT 0,
                reset_cycle TEXT NOT NULL DEFAULT 'month',
                reset_at_ms INTEGER NOT NULL DEFAULT 0,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                UNIQUE(user_id, scene, amount_type),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS usage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                scene TEXT NOT NULL,
                provider_id TEXT DEFAULT '',
                model_id TEXT DEFAULT '',
                biz TEXT DEFAULT '',
                task_id TEXT DEFAULT '',
                amount INTEGER NOT NULL,
                amount_type TEXT NOT NULL,
                status TEXT NOT NULL,
                idempotency_key TEXT DEFAULT '',
                remote_usage_id TEXT DEFAULT '',
                meta TEXT DEFAULT '{}',
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                UNIQUE(idempotency_key),
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            """
        )
        conn.commit()


def ensure_default_user():
    default_user = CONFIG.get("default_user") or {}
    username = default_user.get("username", "demo")
    password = default_user.get("password", "demo123456")
    user = db_first("SELECT * FROM users WHERE username = ?", (username,))
    if user:
        ensure_default_quotas(user["id"])
        return user["id"]
    salt, password_hash = hash_password(password)
    ts = now_ms()
    user_id = db_execute(
        """
        INSERT INTO users (username, password_salt, password_hash, name, avatar, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            username,
            salt,
            password_hash,
            default_user.get("name", username),
            default_user.get("avatar", ""),
            ts,
            ts,
        ),
    )
    ensure_default_quotas(user_id)
    return user_id


def ensure_default_quotas(user_id):
    ts = now_ms()
    for quota in CONFIG.get("default_quotas", []):
        scene = quota.get("scene")
        amount_type = quota.get("amount_type", "count")
        if not scene:
            continue
        existing = db_first(
            "SELECT id FROM user_quotas WHERE user_id = ? AND scene = ? AND amount_type = ?",
            (user_id, scene, amount_type),
        )
        if existing:
            continue
        db_execute(
            """
            INSERT INTO user_quotas
            (user_id, scene, amount_type, limit_amount, used_amount, reset_cycle, reset_at_ms, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
            """,
            (
                user_id,
                scene,
                amount_type,
                int(quota.get("limit_amount", 0)),
                quota.get("reset_cycle", "month"),
                calc_reset_at(quota.get("reset_cycle", "month")),
                ts,
                ts,
            ),
        )


def create_token(user_id):
    token = token_value()
    ts = now_ms()
    db_execute(
        """
        INSERT INTO user_tokens (user_id, token, expires_at_ms, created_at_ms, last_used_at_ms)
        VALUES (?, ?, 0, ?, ?)
        """,
        (user_id, token, ts, ts),
    )
    return token


def get_token_user(token):
    if not token:
        return None
    row = db_first(
        """
        SELECT u.* FROM user_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ? AND u.status = 'active' AND (t.expires_at_ms = 0 OR t.expires_at_ms > ?)
        """,
        (token, now_ms()),
    )
    if row:
        db_execute(
            "UPDATE user_tokens SET last_used_at_ms = ? WHERE token = ?",
            (now_ms(), token),
        )
    return row


def default_user_token():
    username = (CONFIG.get("default_user") or {}).get("username", "demo")
    user = db_first("SELECT * FROM users WHERE username = ?", (username,))
    if not user:
        return None, None
    token = db_first(
        "SELECT token FROM user_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        (user["id"],),
    )
    if token:
        return user, token["token"]
    return user, create_token(user["id"])


def row_to_user(row):
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "avatar": row["avatar"] or "",
        "deviceCode": "",
        "username": row["username"],
    }


def reset_quota_if_needed(quota):
    if quota["reset_cycle"] == "never" or quota["reset_at_ms"] == 0:
        return quota
    if quota["reset_at_ms"] > now_ms():
        return quota
    new_reset_at = calc_reset_at(quota["reset_cycle"])
    db_execute(
        """
        UPDATE user_quotas
        SET used_amount = 0, reset_at_ms = ?, updated_at_ms = ?
        WHERE id = ?
        """,
        (new_reset_at, now_ms(), quota["id"]),
    )
    return db_first("SELECT * FROM user_quotas WHERE id = ?", (quota["id"],))


def get_quota(user_id, scene, amount_type="count"):
    quota = db_first(
        "SELECT * FROM user_quotas WHERE user_id = ? AND scene = ? AND amount_type = ?",
        (user_id, scene, amount_type),
    )
    if quota:
        return reset_quota_if_needed(quota)
    return None


def quota_map(user_id):
    ensure_default_quotas(user_id)
    rows = db_select("SELECT * FROM user_quotas WHERE user_id = ? ORDER BY scene", (user_id,))
    result = {}
    for row in rows:
        row = reset_quota_if_needed(row)
        remaining = max(0, int(row["limit_amount"]) - int(row["used_amount"]))
        result[row["scene"]] = {
            "amountType": row["amount_type"],
            "limit": row["limit_amount"],
            "used": row["used_amount"],
            "remaining": remaining,
            "resetCycle": row["reset_cycle"],
            "resetAt": row["reset_at_ms"],
        }
    return result


def user_info_payload(user, token):
    qmap = quota_map(user["id"])
    member = CONFIG.get("default_member") or {}
    functions = CONFIG.get("default_functions") or {}
    return {
        "apiToken": token or "",
        "user": row_to_user(user),
        "data": {
            "vip": {
                "id": member.get("id", "local_default"),
                "flag": member.get("flag", "local"),
                "title": member.get("title", "本地用户"),
                "icon": member.get("icon", ""),
                "isDefault": bool(member.get("is_default", False)),
            },
            "functions": functions,
            "quota": qmap,
            "usage": qmap,
        },
        "basic": {"userEnable": True},
    }


def extract_token(headers):
    token = headers.get("Api-Token") or headers.get("api-token") or ""
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    return token.strip()


def require_user(handler):
    token = extract_token(handler.headers)
    user = get_token_user(token)
    if user:
        return user, token
    if CONFIG.get("dev_auto_login", False):
        return default_user_token()
    return None, token


def login(data):
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if not username or not password:
        return api_error("用户名和密码不能为空", 10001)
    user = db_first("SELECT * FROM users WHERE username = ?", (username,))
    if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
        return api_error("用户名或密码错误", 10002)
    if user["status"] != "active":
        return api_error("用户已被禁用", 10003)
    ensure_default_quotas(user["id"])
    token = create_token(user["id"])
    return api_ok(user_info_payload(user, token))


def register(data):
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    name = str(data.get("name", username)).strip() or username
    if len(username) < 3:
        return api_error("用户名至少需要 3 个字符", 10001)
    if len(password) < 8:
        return api_error("密码至少需要 8 个字符", 10001)
    if db_first("SELECT id FROM users WHERE username = ?", (username,)):
        return api_error("用户名已存在", 10004)
    salt, password_hash = hash_password(password)
    ts = now_ms()
    user_id = db_execute(
        """
        INSERT INTO users (username, password_salt, password_hash, name, avatar, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (username, salt, password_hash, name, str(data.get("avatar", "")), ts, ts),
    )
    ensure_default_quotas(user_id)
    user = db_first("SELECT * FROM users WHERE id = ?", (user_id,))
    token = create_token(user_id)
    return api_ok(user_info_payload(user, token))


def usage_check(user, data):
    scene = str(data.get("scene", "llm_chat") or "llm_chat")
    amount_type = str(data.get("amountType") or data.get("amount_type") or "count")
    amount = int(data.get("amount") or 1)
    quota = get_quota(user["id"], scene, amount_type)
    if not quota:
        return api_error("配额未配置", 20001, {"allowed": False, "scene": scene})
    remaining = int(quota["limit_amount"]) - int(quota["used_amount"])
    allowed = remaining >= amount
    if not allowed:
        return api_error(
            "配额不足",
            20002,
            {
                "allowed": False,
                "scene": scene,
                "remaining": max(0, remaining),
                "limit": quota["limit_amount"],
                "used": quota["used_amount"],
            },
        )
    usage_id = f"local-{secrets.token_hex(12)}"
    return api_ok(
        {
            "allowed": True,
            "usageId": usage_id,
            "scene": scene,
            "remaining": remaining,
            "limit": quota["limit_amount"],
            "used": quota["used_amount"],
            "resetAt": quota["reset_at_ms"],
        }
    )


def usage_consume(user, data):
    scene = str(data.get("scene", "llm_chat") or "llm_chat")
    amount_type = str(data.get("amountType") or data.get("amount_type") or "count")
    amount = int(data.get("amount") or 1)
    status = "consumed" if data.get("success", True) else "failed"
    idempotency_key = str(data.get("idempotencyKey") or data.get("idempotency_key") or "")
    if not idempotency_key:
        usage_id = str(data.get("usageId") or "")
        if usage_id:
            idempotency_key = usage_id
    if idempotency_key:
        existing = db_first(
            "SELECT * FROM usage_records WHERE idempotency_key = ?", (idempotency_key,)
        )
        if existing:
            return api_ok({"recordId": existing["id"], "duplicated": True, "quota": quota_map(user["id"])})

    quota = get_quota(user["id"], scene, amount_type)
    if not quota:
        return api_error("配额未配置", 20001)
    if status == "consumed":
        remaining = int(quota["limit_amount"]) - int(quota["used_amount"])
        if remaining < amount:
            return api_error("配额不足", 20002, {"remaining": max(0, remaining)})
        db_execute(
            """
            UPDATE user_quotas
            SET used_amount = used_amount + ?, updated_at_ms = ?
            WHERE id = ?
            """,
            (amount, now_ms(), quota["id"]),
        )
    ts = now_ms()
    idempotency_key_db = idempotency_key if idempotency_key else None
    record_id = db_execute(
        """
        INSERT INTO usage_records
        (user_id, scene, provider_id, model_id, biz, task_id, amount, amount_type, status,
         idempotency_key, remote_usage_id, meta, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            scene,
            str(data.get("providerId") or data.get("provider_id") or ""),
            str(data.get("modelId") or data.get("model_id") or ""),
            str(data.get("biz") or ""),
            str(data.get("taskId") or data.get("task_id") or ""),
            amount,
            amount_type,
            status,
            idempotency_key_db,
            str(data.get("usageId") or ""),
            json_dumps(data.get("meta") or {}),
            ts,
            ts,
        ),
    )
    return api_ok({"recordId": record_id, "quota": quota_map(user["id"])})


def usage_summary(user):
    return api_ok({"quota": quota_map(user["id"])})


def usage_records(user, data):
    limit = min(max(int(data.get("limit") or 50), 1), 200)
    offset = max(int(data.get("offset") or 0), 0)
    rows = db_select(
        """
        SELECT * FROM usage_records
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        (user["id"], limit, offset),
    )
    records = []
    for row in rows:
        records.append(
            {
                "id": row["id"],
                "scene": row["scene"],
                "providerId": row["provider_id"],
                "modelId": row["model_id"],
                "biz": row["biz"],
                "taskId": row["task_id"],
                "amount": row["amount"],
                "amountType": row["amount_type"],
                "status": row["status"],
                "meta": json.loads(row["meta"] or "{}"),
                "createdAt": row["created_at_ms"],
            }
        )
    return api_ok({"records": records, "limit": limit, "offset": offset})


class Handler(BaseHTTPRequestHandler):
    server_version = f"{APP_NAME}/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s - %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), self.address_string(), fmt % args))

    def _send(self, status, data, content_type="application/json; charset=utf-8"):
        body = json_dumps(data).encode("utf-8") if isinstance(data, (dict, list)) else str(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Api-Token, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        if not raw:
            return {}
        return json.loads(raw)

    def do_OPTIONS(self):
        self._send(HTTPStatus.OK, {})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/health", "/api/health"):
            self._send(HTTPStatus.OK, api_ok({"service": APP_NAME, "time": now_ms()}))
            return
        if parsed.path in ("/api/user/web", "/api/app_manager/user_web", "/app_manager/user_web"):
            user, token = require_user(self)
            if not user:
                self._send(HTTPStatus.UNAUTHORIZED, api_error("LoginRequired", 1001))
                return
            html = """
            <!doctype html><html><head><meta charset='utf-8'><title>Local User</title></head>
            <body style='font-family:sans-serif;line-height:1.8;padding:24px'>
            <h2>Local User System</h2>
            <p>用户中心 Web 页面占位。AIGCPanel 可通过 API 获取用户和配额信息。</p>
            <script>window.__appManagerUserReady=function(){}</script>
            </body></html>
            """
            self._send(HTTPStatus.OK, html, "text/html; charset=utf-8")
            return
        self._send(HTTPStatus.NOT_FOUND, api_error("NotFound", 404))

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            path = path[4:]
        try:
            data = self._read_json()
            public_routes = {"/user/login", "/user/register", "/health"}
            compatible_user_info = {"/user/info", "/app_manager/user_info"}

            if path == "/health":
                self._send(HTTPStatus.OK, api_ok({"service": APP_NAME, "time": now_ms()}))
                return
            if path == "/user/login":
                self._send(HTTPStatus.OK, login(data))
                return
            if path == "/user/register":
                self._send(HTTPStatus.OK, register(data))
                return

            user, token = require_user(self)
            if not user:
                self._send(HTTPStatus.OK, api_error("LoginRequired", 1001))
                return

            if path in compatible_user_info:
                self._send(HTTPStatus.OK, api_ok(user_info_payload(user, token)))
            elif path == "/user/logout":
                db_execute("DELETE FROM user_tokens WHERE token = ?", (token,))
                self._send(HTTPStatus.OK, api_ok({}))
            elif path == "/usage/check":
                self._send(HTTPStatus.OK, usage_check(user, data))
            elif path == "/usage/consume":
                self._send(HTTPStatus.OK, usage_consume(user, data))
            elif path == "/usage/summary":
                self._send(HTTPStatus.OK, usage_summary(user))
            elif path == "/usage/records":
                self._send(HTTPStatus.OK, usage_records(user, data))
            else:
                self._send(HTTPStatus.NOT_FOUND, api_error("NotFound", 404, {"path": path}))
        except Exception as exc:
            traceback.print_exc()
            self._send(HTTPStatus.OK, api_error(str(exc), 500))


def main():
    global CONFIG, DB_PATH
    parser = argparse.ArgumentParser(description="Local user and quota API for AIGCPanel")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    CONFIG = load_config(args.config)
    host = args.host or CONFIG.get("host", "127.0.0.1")
    port = args.port or int(CONFIG.get("port", 18080))
    DB_PATH = CONFIG.get("database", "data/user_system.db")

    migrate()
    user_id = ensure_default_user()
    print(f"{APP_NAME} database: {DB_PATH}")
    print(f"{APP_NAME} default user id: {user_id}")
    print(f"{APP_NAME} listening: http://{host}:{port}")
    httpd = ThreadingHTTPServer((host, port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
