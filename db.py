#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Database Management Module (Supabase + Local SQLite Fallback)
============================================================
"""

import os
import sys
import datetime
import sqlite3

# Đảm bảo mã UTF-8 trên Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", os.environ.get("SUPABASE_ANON_KEY", ""))).strip()

_supabase_client = None
USE_SUPABASE = False

if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        USE_SUPABASE = True
        print(f"[Database] ✅ Đã kết nối thành công tới Supabase Cloud: {SUPABASE_URL}")
    except Exception as e:
        print(f"[Database] ⚠️ Không thể khởi tạo Supabase Client ({str(e)}), chuyển sang SQLite.")
        USE_SUPABASE = False
else:
    print("[Database] ℹ️ Chưa phát hiện SUPABASE_URL/SUPABASE_KEY trong môi trường. Đang sử dụng cơ sở dữ liệu SQLite cục bộ (database.db).")

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.db")


# =============================================================================
# SQLITE HELPER METHODS (Dùng khi chưa cấu hình Supabase)
# =============================================================================

def get_sqlite_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_sqlite_db():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE,
            email TEXT,
            name TEXT,
            avatar TEXT,
            credits INTEGER DEFAULT 3,
            is_vip INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS scrape_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            video_id TEXT,
            comments_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)
    conn.commit()
    conn.close()


init_sqlite_db()


# =============================================================================
# UNIFIED DATABASE API (SUPABASE + SQLITE)
# =============================================================================

def get_user_by_id(user_id: int):
    if USE_SUPABASE and _supabase_client:
        try:
            res = _supabase_client.table("users").select("*").eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                user = res.data[0]
                user["is_vip"] = bool(user.get("is_vip", False))
                return user
        except Exception as e:
            print(f"[Database Error - Supabase]: {e}")

    # Fallback SQLite
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        user = dict(row)
        user["is_vip"] = bool(user.get("is_vip", 0))
        return user
    return None


def get_or_create_google_user(google_id: str, email: str, name: str, avatar: str):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if USE_SUPABASE and _supabase_client:
        try:
            res = _supabase_client.table("users").select("*").eq("google_id", google_id).execute()
            if res.data and len(res.data) > 0:
                # Cập nhật thông tin & thời gian đăng nhập
                update_res = _supabase_client.table("users").update({
                    "email": email,
                    "name": name,
                    "avatar": avatar,
                    "last_login": now
                }).eq("google_id", google_id).execute()
                user = update_res.data[0] if update_res.data else res.data[0]
                user["is_vip"] = bool(user.get("is_vip", False))
                return user
            else:
                # Tạo user mới với 3 credits mặc định
                new_user_data = {
                    "google_id": google_id,
                    "email": email,
                    "name": name,
                    "avatar": avatar,
                    "credits": 3,
                    "is_vip": False,
                    "created_at": now,
                    "last_login": now
                }
                insert_res = _supabase_client.table("users").insert(new_user_data).execute()
                if insert_res.data and len(insert_res.data) > 0:
                    user = insert_res.data[0]
                    user["is_vip"] = False
                    return user
        except Exception as e:
            print(f"[Database Error - Supabase]: {e}")

    # Fallback SQLite
    now_sqlite = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
    row = cursor.fetchone()

    if row:
        cursor.execute("""
            UPDATE users 
            SET email = ?, name = ?, avatar = ?, last_login = ?
            WHERE google_id = ?
        """, (email, name, avatar, now_sqlite, google_id))
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
        user = dict(cursor.fetchone())
        user["is_vip"] = bool(user.get("is_vip", 0))
        conn.close()
        return user
    else:
        cursor.execute("""
            INSERT INTO users (google_id, email, name, avatar, credits, is_vip, created_at, last_login)
            VALUES (?, ?, ?, ?, 3, 0, ?, ?)
        """, (google_id, email, name, avatar, now_sqlite, now_sqlite))
        conn.commit()
        user_id = cursor.lastrowid
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = dict(cursor.fetchone())
        user["is_vip"] = False
        conn.close()
        return user


def get_or_create_demo_user():
    return get_or_create_google_user(
        google_id="demo_user_123456",
        email="demo.user@gmail.com",
        name="Người Dùng Thử Nghiệm",
        avatar="https://api.dicebear.com/7.x/bottts/svg?seed=TikTokVIP"
    )


def deduct_user_credit(user_id: int) -> bool:
    user = get_user_by_id(user_id)
    if not user:
        return False

    if user.get("is_vip"):
        return True

    credits = user.get("credits", 0)
    if credits <= 0:
        return False

    new_credits = credits - 1

    if USE_SUPABASE and _supabase_client:
        try:
            _supabase_client.table("users").update({"credits": new_credits}).eq("id", user_id).execute()
            return True
        except Exception as e:
            print(f"[Database Error - Supabase]: {e}")

    # Fallback SQLite
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, user_id))
    conn.commit()
    conn.close()
    return True


def add_user_credits(user_id: int, amount: int) -> int:
    user = get_user_by_id(user_id)
    if not user:
        return 0

    new_credits = user.get("credits", 0) + amount

    if USE_SUPABASE and _supabase_client:
        try:
            res = _supabase_client.table("users").update({"credits": new_credits}).eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]["credits"]
        except Exception as e:
            print(f"[Database Error - Supabase]: {e}")

    # Fallback SQLite
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET credits = ? WHERE id = ?", (new_credits, user_id))
    conn.commit()
    conn.close()
    return new_credits
