#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Database Management Module (SQLite) for TikTok Comments Web App
"""

import os
import sqlite3
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database.db")


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
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


def get_user_by_id(user_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def get_or_create_google_user(google_id: str, email: str, name: str, avatar: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
    row = cursor.fetchone()

    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    if row:
        # Cập nhật thông tin & thời gian đăng nhập
        cursor.execute("""
            UPDATE users 
            SET email = ?, name = ?, avatar = ?, last_login = ?
            WHERE google_id = ?
        """, (email, name, avatar, now, google_id))
        conn.commit()
        cursor.execute("SELECT * FROM users WHERE google_id = ?", (google_id,))
        user = dict(cursor.fetchone())
        conn.close()
        return user
    else:
        # Tạo user mới, tặng 3 credits mặc định
        cursor.execute("""
            INSERT INTO users (google_id, email, name, avatar, credits, is_vip, created_at, last_login)
            VALUES (?, ?, ?, ?, 3, 0, ?, ?)
        """, (google_id, email, name, avatar, now, now))
        conn.commit()
        user_id = cursor.lastrowid
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = dict(cursor.fetchone())
        conn.close()
        return user


def get_or_create_demo_user():
    """Tài khoản thử nghiệm để test khi chưa gắn Google Client ID"""
    return get_or_create_google_user(
        google_id="demo_user_123456",
        email="demo.user@gmail.com",
        name="Người Dùng Thử Nghiệm",
        avatar="https://api.dicebear.com/7.x/bottts/svg?seed=TikTokVIP"
    )


def deduct_user_credit(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT credits, is_vip FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False

    credits = row["credits"]
    is_vip = row["is_vip"]

    # Nếu là VIP không giới hạn, hoặc còn credits
    if is_vip:
        conn.close()
        return True

    if credits > 0:
        cursor.execute("UPDATE users SET credits = credits - 1 WHERE id = ?", (user_id,))
        conn.commit()
        conn.close()
        return True

    conn.close()
    return False


def add_user_credits(user_id: int, amount: int) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET credits = credits + ? WHERE id = ?", (amount, user_id))
    conn.commit()
    cursor.execute("SELECT credits FROM users WHERE id = ?", (user_id,))
    new_credits = cursor.fetchone()["credits"]
    conn.close()
    return new_credits


# Khởi tạo DB khi load module
init_db()
