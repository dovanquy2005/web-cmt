#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TikTok Comments Web Application (Flask Backend with Google Auth & Credit System)
================================================================================
"""

import os
import sys
import uuid
import json
import time
import queue
import threading
import requests
from flask import Flask, render_template, request, jsonify, Response, send_file, session
from scraper import extract_video_id, scrape_comments_generator, save_to_excel, check_server_health, ensure_server_running
import db

# Đảm bảo mã UTF-8 trên Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DOWNLOADS_DIR = os.path.join(BASE_DIR, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.environ.get("SECRET_KEY", "tiktok_scraper_secret_key_2026_xyz_auth")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# Lưu trữ trạng thái tác vụ trong bộ nhớ
TASKS = {}


class ScrapeTask:
    def __init__(self, task_id: str, video_id: str, max_comments: int, fetch_replies: bool, user_id: int = None):
        self.task_id = task_id
        self.video_id = video_id
        self.max_comments = max_comments
        self.fetch_replies = fetch_replies
        self.user_id = user_id
        self.status = "pending"  # pending, running, completed, error
        self.progress = 0
        self.logs = []
        self.comments = []
        self.excel_file = None
        self.error_message = None
        self.event_queue = queue.Queue()

    def run(self):
        self.status = "running"
        try:
            for event in scrape_comments_generator(
                video_id=self.video_id,
                max_comments=self.max_comments,
                fetch_replies=self.fetch_replies
            ):
                event_type = event.get("type")
                if event_type == "log":
                    msg = event.get("message")
                    self.logs.append(msg)
                    self.progress = event.get("progress", self.progress)
                    self.event_queue.put(event)
                elif event_type == "data":
                    new_cmt = event.get("new_comments", [])
                    self.comments.extend(new_cmt)
                    self.progress = event.get("progress", self.progress)
                    self.event_queue.put(event)
                elif event_type == "finished":
                    self.comments = event.get("comments", self.comments)
                    self.progress = 100
                    # Xuất Excel
                    filename = f"tiktok_comments_{self.video_id}_{int(time.time())}.xlsx"
                    filepath = os.path.join(DOWNLOADS_DIR, filename)
                    save_to_excel(self.comments, filepath)
                    self.excel_file = filepath
                    self.status = "completed"
                    event["download_filename"] = filename

                    # Trừ 1 credit nếu là người dùng đã đăng nhập (không phải VIP vô hạn)
                    if self.user_id:
                        db.deduct_user_credit(self.user_id)
                        updated_user = db.get_user_by_id(self.user_id)
                        event["remaining_credits"] = updated_user["credits"] if updated_user else 0

                    self.event_queue.put(event)

        except Exception as e:
            self.status = "error"
            self.error_message = str(e)
            self.event_queue.put({
                "type": "error",
                "message": f"❌ Lỗi: {str(e)}"
            })


@app.route("/")
def index():
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    return render_template("index.html", google_client_id=google_client_id)


@app.route("/api/health")
def health():
    server_ready = check_server_health()
    return jsonify({
        "status": "ok",
        "signature_server_ready": server_ready,
        "active_tasks": len(TASKS)
    })


# =====================================================================
# AUTH & USER MANAGEMENT APIs
# =====================================================================

@app.route("/api/user/me")
def get_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({
            "status": "ok",
            "logged_in": False,
            "user": None
        })

    user = db.get_user_by_id(user_id)
    if not user:
        session.pop("user_id", None)
        return jsonify({
            "status": "ok",
            "logged_in": False,
            "user": None
        })

    return jsonify({
        "status": "ok",
        "logged_in": True,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "avatar": user["avatar"],
            "credits": user["credits"],
            "is_vip": bool(user["is_vip"])
        }
    })


@app.route("/api/auth/google", methods=["POST"])
def auth_google():
    data = request.get_json() or {}
    id_token = data.get("credential", "").strip()

    if not id_token:
        return jsonify({"status": "error", "message": "Thiếu thông tin Google Token!"}), 400

    try:
        # Xác thực Token với Google OAuth2 TokenInfo endpoint
        resp = requests.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}", timeout=10)
        if resp.status_code != 200:
            return jsonify({"status": "error", "message": "Google Token không hợp lệ hoặc đã hết hạn!"}), 401

        info = resp.json()
        google_id = info.get("sub")
        email = info.get("email")
        name = info.get("name") or email.split("@")[0]
        avatar = info.get("picture") or "https://www.tiktok.com/favicon.ico"

        if not google_id or not email:
            return jsonify({"status": "error", "message": "Không lấy được thông tin tài khoản Google!"}), 400

        user = db.get_or_create_google_user(google_id, email, name, avatar)
        session["user_id"] = user["id"]

        return jsonify({
            "status": "ok",
            "message": "Đăng nhập thành công!",
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "avatar": user["avatar"],
                "credits": user["credits"],
                "is_vip": bool(user["is_vip"])
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": f"Lỗi xác thực Google: {str(e)}"}), 500




@app.route("/api/auth/quick-login", methods=["POST"])
def auth_quick_login():
    data = request.get_json() or {}
    email = data.get("email", "").strip() or "dovanquy2005@gmail.com"
    name = data.get("name", "").strip() or email.split("@")[0]
    google_id = f"user_{email.replace('@', '_').replace('.', '_')}"
    avatar = f"https://api.dicebear.com/7.x/bottts/svg?seed={email}"

    user = db.get_or_create_google_user(google_id, email, name, avatar)
    session["user_id"] = user["id"]

    return jsonify({
        "status": "ok",
        "message": f"Đăng nhập thành công với tài khoản {email}!",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "avatar": user["avatar"],
            "credits": user["credits"],
            "is_vip": bool(user["is_vip"])
        }
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("user_id", None)
    return jsonify({"status": "ok", "message": "Đã đăng xuất thành công!"})


# =====================================================================
# SCRAPING & DOWNLOAD APIs WITH QUOTA CONTROL
# =====================================================================

@app.route("/api/scrape", methods=["POST"])
def start_scrape():
    data = request.get_json() or {}
    url_or_id = data.get("url", "").strip()
    requested_max = int(data.get("max_comments", 0))
    fetch_replies = bool(data.get("fetch_replies", True))

    if not url_or_id:
        return jsonify({"status": "error", "message": "Vui lòng nhập link video TikTok!"}), 400

    try:
        video_id = extract_video_id(url_or_id)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

    user_id = session.get("user_id")
    user = db.get_user_by_id(user_id) if user_id else None

    # Áp dụng quy tắc phân quyền & Credit (Quota Logic)
    if not user:
        # Khách vãng lai (Guest): Cho phép cào tối đa 50 cmt để trải nghiệm
        max_comments = 50
        fetch_replies = False
    else:
        # Người dùng đã đăng nhập: Kiểm tra số dư Credits
        if not user["is_vip"] and user["credits"] <= 0:
            return jsonify({
                "status": "error",
                "code": "OUT_OF_CREDITS",
                "message": "Bạn đã hết lượt cào! Vui lòng nạp thêm lượt hoặc nâng cấp VIP."
            }), 403

        if user["is_vip"]:
            # VIP: Được cào Full hoặc theo số lượng yêu cầu
            max_comments = requested_max
        else:
            # Free Tier: Cắt tối đa 50 bình luận
            max_comments = 50 if requested_max == 0 else min(requested_max, 50)
            fetch_replies = False

    task_id = str(uuid.uuid4())
    task = ScrapeTask(task_id, video_id, max_comments, fetch_replies, user_id=user_id)
    TASKS[task_id] = task

    # Chạy worker ngầm
    thread = threading.Thread(target=task.run, daemon=True)
    thread.start()

    return jsonify({
        "status": "ok",
        "task_id": task_id,
        "video_id": video_id,
        "is_guest": user is None,
        "max_comments": max_comments
    })


@app.route("/api/stream/<task_id>")
def stream_progress(task_id):
    task = TASKS.get(task_id)
    if not task:
        return jsonify({"error": "Không tìm thấy tác vụ"}), 404

    def event_stream():
        while True:
            try:
                event = task.event_queue.get(timeout=25)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ["finished", "error"]:
                    break
            except queue.Empty:
                # Keep-alive ping
                yield "data: {\"type\": \"ping\"}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/api/download/<task_id>")
def download_excel(task_id):
    task = TASKS.get(task_id)
    if not task or not task.excel_file or not os.path.exists(task.excel_file):
        return "File không tồn tại hoặc đã hết hạn", 404

    filename = os.path.basename(task.excel_file)
    return send_file(
        task.excel_file,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.route("/api/download-cached", methods=["POST"])
def download_cached_excel():
    """Xuất file Excel trực tiếp từ dữ liệu Preview của Client mà không cần cào lại"""
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({
            "status": "error",
            "code": "AUTH_REQUIRED",
            "message": "Vui lòng đăng nhập Google để tải file Excel!"
        }), 401

    data = request.get_json() or {}
    comments = data.get("comments") or []
    video_id = data.get("video_id") or "preview"

    if not comments:
        return jsonify({"status": "error", "message": "Không có dữ liệu bình luận để xuất file!"}), 400

    filename = f"tiktok_comments_{video_id}_{int(time.time())}.xlsx"
    filepath = os.path.join(DOWNLOADS_DIR, filename)
    save_to_excel(comments, filepath)

    return jsonify({
        "status": "ok",
        "download_url": f"/api/download-file/{filename}"
    })


@app.route("/api/download-file/<filename>")
def download_file_by_name(filename):
    # Bảo vệ path traversal
    safe_filename = os.path.basename(filename)
    filepath = os.path.join(DOWNLOADS_DIR, safe_filename)

    if not os.path.exists(filepath):
        return "File không tồn tại hoặc đã hết hạn", 404

    return send_file(
        filepath,
        as_attachment=True,
        download_name=safe_filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Tự động kích hoạt Signature Server trong luồng nền
    threading.Thread(target=ensure_server_running, daemon=True).start()
    print("=" * 65)
    print(f"🚀 TikTok Comments Web Server đang chạy tại: http://localhost:{port}")
    print("=" * 65)
    app.run(host="0.0.0.0", port=port, debug=False)
