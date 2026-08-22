document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('scrapeForm');
    const videoUrlInput = document.getElementById('videoUrl');
    const pasteBtn = document.getElementById('pasteBtn');
    const clearBtn = document.getElementById('clearBtn');
    const sampleBtns = document.querySelectorAll('.btn-sample');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    const statusSection = document.getElementById('statusSection');
    const progressStatus = document.getElementById('progressStatus');
    const progressPercent = document.getElementById('progressPercent');
    const progressBar = document.getElementById('progressBar');
    const statCount = document.getElementById('statCount');
    const statTime = document.getElementById('statTime');

    const logConsole = document.getElementById('logConsole');
    const toggleLogBtn = document.getElementById('toggleLogBtn');

    const downloadSection = document.getElementById('downloadSection');
    const downloadBtn = document.getElementById('downloadBtn');

    const previewSection = document.getElementById('previewSection');
    const previewCount = document.getElementById('previewCount');
    const previewTbody = document.getElementById('previewTbody');

    let timerInterval = null;
    let startTime = null;
    let eventSource = null;

    // Paste from Clipboard
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                videoUrlInput.value = text.trim();
                videoUrlInput.focus();
            }
        } catch (err) {
            console.error('Không thể đọc clipboard:', err);
        }
    });

    // Clear Input
    clearBtn.addEventListener('click', () => {
        videoUrlInput.value = '';
        videoUrlInput.focus();
    });

    // Quick Sample Buttons
    sampleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sampleUrl = btn.getAttribute('data-url');
            if (sampleUrl) {
                videoUrlInput.value = sampleUrl;
                videoUrlInput.focus();
            }
        });
    });

    // Toggle Logs
    toggleLogBtn.addEventListener('click', () => {
        if (logConsole.style.display === 'none') {
            logConsole.style.display = 'flex';
            toggleLogBtn.textContent = 'Thu gọn';
        } else {
            logConsole.style.display = 'none';
            toggleLogBtn.textContent = 'Mở rộng';
        }
    });

    function addLog(message) {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logConsole.appendChild(line);
        logConsole.scrollTop = logConsole.scrollHeight;
    }

    function appendPreviewRows(comments) {
        if (!comments || comments.length === 0) return;

        comments.forEach(cmt => {
            const row = document.createElement('tr');
            const isReply = cmt['Loại'] && cmt['Loại'].includes('Trả lời');
            const avatarUrl = cmt['Link Avatar'] || 'https://www.tiktok.com/favicon.ico';
            const likes = Number(cmt['Lượt thích (Likes)'] || 0).toLocaleString();
            const replies = Number(cmt['Số câu trả lời'] || 0).toLocaleString();

            row.innerHTML = `
                <td>${previewTbody.children.length + 1}</td>
                <td>
                    <div class="user-cell">
                        <img src="${avatarUrl}" class="user-avatar" onerror="this.src='https://www.tiktok.com/favicon.ico'" alt="avatar">
                        <span>@${cmt['Username'] || 'user'}</span>
                        ${isReply ? '<span class="badge-reply">Reply</span>' : ''}
                    </div>
                </td>
                <td>
                    <div class="comment-text">${escapeHtml(cmt['Nội dung bình luận'] || '')}</div>
                </td>
                <td><i class="fas fa-heart text-danger"></i> ${likes}</td>
                <td>${replies}</td>
                <td>${cmt['Thời gian đăng'] || '-'}</td>
            `;
            previewTbody.appendChild(row);
        });

        previewCount.textContent = previewTbody.children.length;
    }

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = videoUrlInput.value.trim();
        const maxComments = parseInt(document.getElementById('maxComments').value) || 0;
        const fetchReplies = document.getElementById('fetchReplies').checked;

        if (!url) return;

        // Reset UI State
        submitBtn.disabled = true;
        btnText.classList.add('hidden');
        btnSpinner.classList.remove('hidden');

        statusSection.classList.remove('hidden');
        downloadSection.classList.add('hidden');
        previewSection.classList.remove('hidden');
        previewTbody.innerHTML = '';
        logConsole.innerHTML = '';
        previewCount.textContent = '0';
        statCount.textContent = '0';
        statTime.textContent = '0s';

        progressBar.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang kết nối tới TikTok...';

        startTime = Date.now();
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            statTime.textContent = `${elapsed}s`;
        }, 1000);

        try {
            // 1. Gửi request tạo tác vụ
            const resp = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url,
                    max_comments: maxComments,
                    fetch_replies: fetchReplies
                })
            });

            const data = await resp.json();
            if (data.status !== 'ok') {
                throw new Error(data.message || 'Không thể bắt đầu tác vụ');
            }

            const taskId = data.task_id;
            addLog(`Tạo tác vụ thành công (Task ID: ${taskId.substring(0, 8)}...)`);

            // 2. Lắng nghe Server-Sent Events (SSE)
            if (eventSource) eventSource.close();
            eventSource = new EventSource(`/api/stream/${taskId}`);

            eventSource.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'ping') return;

                    if (msg.type === 'log') {
                        addLog(msg.message);
                        progressStatus.textContent = msg.message;
                        if (msg.progress) {
                            progressBar.style.width = `${msg.progress}%`;
                            progressPercent.textContent = `${msg.progress}%`;
                        }
                    } else if (msg.type === 'data') {
                        addLog(msg.message);
                        statCount.textContent = msg.total_count || previewTbody.children.length;
                        if (msg.new_comments) {
                            appendPreviewRows(msg.new_comments);
                        }
                        if (msg.progress) {
                            progressBar.style.width = `${msg.progress}%`;
                            progressPercent.textContent = `${msg.progress}%`;
                        }
                    } else if (msg.type === 'finished') {
                        clearInterval(timerInterval);
                        eventSource.close();

                        progressBar.style.width = '100%';
                        progressPercent.textContent = '100%';
                        progressStatus.innerHTML = '<i class="fas fa-check-circle text-success"></i> Đã hoàn thành!';
                        statCount.textContent = msg.total_count || previewTbody.children.length;
                        addLog(msg.message);

                        // Cập nhật nút Download
                        downloadBtn.href = `/api/download/${taskId}`;
                        downloadSection.classList.remove('hidden');

                        submitBtn.disabled = false;
                        btnText.classList.remove('hidden');
                        btnSpinner.classList.add('hidden');
                    } else if (msg.type === 'error') {
                        clearInterval(timerInterval);
                        eventSource.close();

                        addLog(msg.message);
                        progressStatus.innerHTML = `<span class="text-danger">${msg.message}</span>`;

                        submitBtn.disabled = false;
                        btnText.classList.remove('hidden');
                        btnSpinner.classList.add('hidden');
                    }
                } catch (err) {
                    console.error('Lỗi xử lý SSE:', err);
                }
            };

            eventSource.onerror = () => {
                eventSource.close();
                clearInterval(timerInterval);
                submitBtn.disabled = false;
                btnText.classList.remove('hidden');
                btnSpinner.classList.add('hidden');
            };

        } catch (error) {
            clearInterval(timerInterval);
            addLog(`❌ Lỗi: ${error.message}`);
            progressStatus.innerHTML = `<span style="color: #ef4444;">${error.message}</span>`;
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnSpinner.classList.add('hidden');
        }
    });
});
