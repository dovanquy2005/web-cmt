# TikTok Comments Web Application (`web-cmt`)

Ứng dụng Web hoàn chỉnh (Frontend + Backend) cho phép người dùng nhập link video TikTok bất kỳ và tải về toàn bộ bình luận dưới dạng file Excel `.xlsx`.

## 🌟 Tính Năng Nổi Bật
- **Giao diện hiện đại**: Thiết kế phong cách Dark Mode Glassmorphism + hiệu ứng TikTok Neon.
- **Xem trước trực tiếp (Live Preview)**: Hiển thị avatar, tên người dùng, nội dung bình luận, lượt tim ngay khi đang tải.
- **Tiến trình thời gian thực**: Cập nhật thanh % tiến độ và nhật ký hoạt động qua Server-Sent Events (SSE).
- **Tự động 100%**: Tự động sinh chữ ký bảo mật X-Bogus/X-Gnarly và phân trang cào hết toàn bộ câu trả lời con (replies).
- **Xuất file Excel chuyên nghiệp**: Tự động định dạng bảng, cố định tiêu đề (Freeze Panes).

## 🚀 Cách Chạy Thử (Chỉ 1 Bước)

### Cách 1: Chạy bằng file 1-Click (Windows)
Double-click vào file **`run.bat`** bên trong thư mục `web-cmt/`. Trình duyệt sẽ tự động mở trang web tại:
```
http://localhost:5000
```

### Cách 2: Chạy bằng dòng lệnh Terminal
```bash
cd web-cmt
python app.py
```
Sau đó truy cập: `http://localhost:5000` trên trình duyệt.

## 📂 Cấu Trúc Thư Mục `web-cmt/`
```
web-cmt/
├── app.py              # Backend Web Server (Flask REST & SSE API)
├── scraper.py          # Động cơ cào dữ liệu và xuất Excel
├── requirements.txt    # Các thư viện phụ thuộc
├── run.bat             # File chạy nhanh 1-click cho Windows
├── templates/
│   └── index.html      # Giao diện Web (HTML5)
├── static/
│   ├── css/
│   │   └── style.css   # Giao diện CSS Glassmorphism
│   └── js/
│       └── app.js      # Logic JavaScript xử lý tương tác & SSE
└── downloads/          # Thư mục chứa các file Excel đã tạo
```
