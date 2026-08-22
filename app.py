#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TikTok Comments Web Application (Flask Backend)
================================================
"""

import os
import sys
import uuid
import json
import time
import queue
import threading
from flask import Flask, render_template, request, jsonify, Response, send_file
from scraper import extract_video_id, scrape_comments_generator, save_to_excel, check_server_health, ensure_server_running

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

# Lưu trữ trạng thái tác vụ trong bộ nhớ
TASKS = {}


class ScrapeTask:
    def __init__(self, task_id: str, video_id: str, max_comments: int, fetch_replies: bool):
        self.task_id = task_id
        self.video_id = video_id
        self.max_comments = max_comments
        self.fetch_replies = fetch_replies
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
    return render_template("index.html")


@app.route("/api/health")
def health():
    server_ready = check_server_health()
    return jsonify({
        "status": "ok",
        "signature_server_ready": server_ready,
        "active_tasks": len(TASKS)
    })


@app.route("/api/scrape", methods=["POST"])
def start_scrape():
    data = request.get_json() or {}
    url_or_id = data.get("url", "").strip()
    max_comments = int(data.get("max_comments", 0))
    fetch_replies = bool(data.get("fetch_replies", True))

    if not url_or_id:
        return jsonify({"status": "error", "message": "Vui lòng nhập link video TikTok!"}), 400

    try:
        video_id = extract_video_id(url_or_id)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

    task_id = str(uuid.uuid4())
    task = ScrapeTask(task_id, video_id, max_comments, fetch_replies)
    TASKS[task_id] = task

    # Chạy worker ngầm
    thread = threading.Thread(target=task.run, daemon=True)
    thread.start()

    return jsonify({
        "status": "ok",
        "task_id": task_id,
        "video_id": video_id
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Tự động kích hoạt Signature Server trong luồng nền
    threading.Thread(target=ensure_server_running, daemon=True).start()
    print("=" * 65)
    print(f"🚀 TikTok Comments Web Server đang chạy tại: http://localhost:{port}")
    print("=" * 65)
    app.run(host="0.0.0.0", port=port, debug=False)
