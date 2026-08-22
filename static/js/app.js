/**
 * TikTok Comments Web App - Client Logic & State Management
 * Features: Google Identity Services, State Retention, Quota Management, Platform Switcher & Toast System
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
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
    const previewDownloadBtn = document.getElementById('previewDownloadBtn');

    // Platform Tabs
    const tabTikTok = document.getElementById('tabTikTok');
    const tabFacebook = document.getElementById('tabFacebook');
    const tiktokPlatformView = document.getElementById('tiktokPlatformView');
    const facebookPlatformView = document.getElementById('facebookPlatformView');
    const btnBackToTikTok = document.getElementById('btnBackToTikTok');

    // Auth & Navigation Elements
    const navGuestView = document.getElementById('navGuestView');
    const navUserView = document.getElementById('navUserView');
    const navLoginBtn = document.getElementById('navLoginBtn');
    const navUserAvatar = document.getElementById('navUserAvatar');
    const navUserName = document.getElementById('navUserName');
    const navCreditCount = document.getElementById('navCreditCount');
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');
    const dropdownName = document.getElementById('dropdownName');
    const dropdownEmail = document.getElementById('dropdownEmail');
    const dropdownTopupBtn = document.getElementById('dropdownTopupBtn');
    const btnLogout = document.getElementById('btnLogout');
    const btnTopupNav = document.getElementById('btnTopupNav');
    const guestHint = document.getElementById('guestHint');

    // Modals
    const authModal = document.getElementById('authModal');
    const closeAuthModal = document.getElementById('closeAuthModal');

    const topupModal = document.getElementById('topupModal');
    const closeTopupModal = document.getElementById('closeTopupModal');
    const qrPaymentSection = document.getElementById('qrPaymentSection');
    const qrPkgName = document.getElementById('qrPkgName');
    const qrImage = document.getElementById('qrImage');

    // In-memory App State
    let currentUser = null;
    let currentComments = [];
    let currentVideoId = '';
    let currentTaskId = null;
    let timerInterval = null;
    let startTime = null;
    let eventSource = null;

    const STORAGE_KEY_STATE = 'TIKTOK_SCRAPE_CACHE_V2';
    const STORAGE_KEY_PENDING_DOWNLOAD = 'AUTH_PENDING_DOWNLOAD';

    // =========================================================================
    // 1. TOAST NOTIFICATION SYSTEM
    // =========================================================================
    function showToast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${iconMap[type] || 'fa-info-circle'}"></i></div>
            <div class="toast-msg">${escapeHtml(message)}</div>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(50px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    // =========================================================================
    // 2. USER AUTHENTICATION & GOOGLE GSI
    // =========================================================================
    async function checkCurrentUser() {
        try {
            const resp = await fetch('/api/user/me');
            const data = await resp.json();

            if (data.status === 'ok' && data.logged_in && data.user) {
                currentUser = data.user;
                updateUserUI(true);
            } else {
                currentUser = null;
                updateUserUI(false);
            }
        } catch (err) {
            console.error('Lỗi kiểm tra phiên đăng nhập:', err);
            currentUser = null;
            updateUserUI(false);
        }
    }

    function updateUserUI(isLoggedIn) {
        if (isLoggedIn && currentUser) {
            navGuestView.classList.add('hidden');
            navUserView.classList.remove('hidden');

            navUserName.textContent = currentUser.name || currentUser.email.split('@')[0];
            navUserAvatar.src = currentUser.avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=User';
            dropdownName.textContent = currentUser.name || 'Người dùng';
            dropdownEmail.textContent = currentUser.email || '';

            if (currentUser.is_vip) {
                navCreditCount.innerHTML = '<i class="fas fa-crown text-warning"></i> VIP';
                guestHint.textContent = '👑 Bạn là thành viên VIP: Cào Full không giới hạn';
            } else {
                navCreditCount.textContent = currentUser.credits;
                guestHint.textContent = `⚡ Bạn còn ${currentUser.credits} lượt cào khả dụng`;
            }
        } else {
            navGuestView.classList.remove('hidden');
            navUserView.classList.add('hidden');
            guestHint.textContent = 'Khách chưa đăng nhập: Cào thử 50 cmt miễn phí';
        }
    }

    function initGoogleAuth() {
        const clientId = (window.APP_CONFIG && window.APP_CONFIG.googleClientId) ? window.APP_CONFIG.googleClientId.trim() : '';
        if (!clientId) return;

        let attempts = 0;
        function tryRenderGoogleBtn() {
            attempts++;
            if (window.google && window.google.accounts && window.google.accounts.id) {
                try {
                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        callback: handleGoogleAuthCallback,
                        auto_select: false
                    });

                    const container = document.getElementById('g_id_signin_container');
                    if (container) {
                        container.innerHTML = '';
                        window.google.accounts.id.renderButton(container, {
                            theme: 'outline',
                            size: 'large',
                            type: 'standard',
                            shape: 'pill',
                            text: 'continue_with',
                            logo_alignment: 'left',
                            width: 280
                        });
                    }
                } catch (err) {
                    console.warn('Google GSI render error:', err);
                }
            } else if (attempts < 20) {
                setTimeout(tryRenderGoogleBtn, 200);
            }
        }

        tryRenderGoogleBtn();
    }

    async function handleGoogleAuthCallback(response) {
        try {
            const idToken = response.credential;
            const resp = await fetch('/api/auth/google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: idToken })
            });

            const data = await resp.json();
            if (data.status === 'ok') {
                currentUser = data.user;
                updateUserUI(true);
                authModal.classList.add('hidden');
                showToast(`🎉 Chào mừng ${currentUser.name}! Bạn có ${currentUser.credits} lượt cào.`, 'success');
                
                // Khôi phục State & Kiểm tra hành động tải pending
                handlePostLoginStateRetention();
            } else {
                showToast(data.message || 'Đăng nhập Google thất bại!', 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối máy chủ xác thực!', 'error');
        }
    }



    // Logout
    btnLogout.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            currentUser = null;
            updateUserUI(false);
            userDropdown.classList.add('hidden');
            showToast('Đã đăng xuất tài khoản.', 'info');
        } catch (err) {
            console.error('Logout error:', err);
        }
    });

    // User Dropdown toggle
    userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        userDropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        if (!userDropdown.classList.contains('hidden')) {
            userDropdown.classList.add('hidden');
        }
    });

    navLoginBtn.addEventListener('click', () => {
        openAuthModal();
    });

    function openAuthModal() {
        authModal.classList.remove('hidden');
        initGoogleAuth();
    }

    closeAuthModal.addEventListener('click', () => {
        authModal.classList.add('hidden');
    });

    // =========================================================================
    // 3. STATE PERSISTENCE & RETENTION (GIỮ NGUYÊN BÌNH LUẬN SAU LOGIN)
    // =========================================================================
    function saveScrapeState(videoUrl, comments, totalCount, taskId) {
        const state = {
            videoUrl: videoUrl,
            comments: comments || [],
            totalCount: totalCount || 0,
            taskId: taskId || null,
            savedAt: Date.now()
        };
        try {
            sessionStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
        } catch (e) {
            console.warn('Không thể lưu sessionStorage:', e);
        }
    }

    function restoreScrapeState() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY_STATE);
            if (!raw) return false;

            const state = JSON.parse(raw);
            if (!state || !state.comments || state.comments.length === 0) return false;

            // Điền lại URL
            if (state.videoUrl) videoUrlInput.value = state.videoUrl;

            // Khôi phục biến
            currentComments = state.comments;
            currentTaskId = state.taskId;

            // Render lại bảng preview
            previewTbody.innerHTML = '';
            appendPreviewRows(currentComments);
            previewCount.textContent = currentComments.length;
            statCount.textContent = currentComments.length;

            statusSection.classList.remove('hidden');
            previewSection.classList.remove('hidden');
            downloadSection.classList.remove('hidden');

            progressBar.style.width = '100%';
            progressPercent.textContent = '100%';
            progressStatus.innerHTML = '<i class="fas fa-check-circle text-success"></i> Dữ liệu xem trước đã được khôi phục';
            
            return true;
        } catch (err) {
            console.error('Lỗi khôi phục State:', err);
            return false;
        }
    }

    function handlePostLoginStateRetention() {
        const hasRestored = restoreScrapeState();
        const isPendingDownload = sessionStorage.getItem(STORAGE_KEY_PENDING_DOWNLOAD) === 'true';

        if (isPendingDownload && hasRestored) {
            sessionStorage.removeItem(STORAGE_KEY_PENDING_DOWNLOAD);
            showToast('✅ Đã mở khóa tải file Excel! Đang chuẩn bị tải về...', 'success');
            setTimeout(() => {
                executeExcelDownload();
            }, 600);
        }
    }

    // =========================================================================
    // 4. PLATFORM TABS SWITCHER
    // =========================================================================
    tabTikTok.addEventListener('click', () => {
        tabTikTok.classList.add('active');
        tabFacebook.classList.remove('active');
        tiktokPlatformView.classList.remove('hidden');
        facebookPlatformView.classList.add('hidden');
    });

    tabFacebook.addEventListener('click', () => {
        tabFacebook.classList.add('active');
        tabTikTok.classList.remove('active');
        tiktokPlatformView.classList.add('hidden');
        facebookPlatformView.classList.remove('hidden');
        showToast('🚧 Tính năng cào bình luận Facebook đang được hoàn thiện và sẽ sớm ra mắt!', 'info');
    });

    btnBackToTikTok.addEventListener('click', () => {
        tabTikTok.click();
    });

    // =========================================================================
    // 5. INPUT & FORM INTERACTIONS
    // =========================================================================
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                videoUrlInput.value = text.trim();
                videoUrlInput.focus();
                showToast('Đã dán link từ Clipboard', 'info', 2000);
            }
        } catch (err) {
            showToast('Vui lòng cấp quyền đọc Clipboard trên trình duyệt', 'warning');
        }
    });

    clearBtn.addEventListener('click', () => {
        videoUrlInput.value = '';
        videoUrlInput.focus();
    });

    sampleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sampleUrl = btn.getAttribute('data-url');
            if (sampleUrl) {
                videoUrlInput.value = sampleUrl;
                videoUrlInput.focus();
                showToast('Đã điền link video mẫu', 'info', 2000);
            }
        });
    });

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
            const avatarUrl = cmt['Link Avatar'] || 'https://api.dicebear.com/7.x/bottts/svg?seed=user';
            const likes = Number(cmt['Lượt thích (Likes)'] || 0).toLocaleString();
            const replies = Number(cmt['Số câu trả lời'] || 0).toLocaleString();

            row.innerHTML = `
                <td>${previewTbody.children.length + 1}</td>
                <td>
                    <div class="user-cell">
                        <img src="${avatarUrl}" class="user-avatar" onerror="this.src='https://www.tiktok.com/favicon.ico'" alt="avatar">
                        <span>@${escapeHtml(cmt['Username'] || 'user')}</span>
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

    // =========================================================================
    // 6. FORM SUBMIT & LIVE SCRAPING
    // =========================================================================
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

        currentComments = [];
        currentTaskId = null;

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
            // 1. Gọi API tạo tác vụ
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

            // Xử lý khi hết lượt cào (Paywall)
            if (resp.status === 403 && data.code === 'OUT_OF_CREDITS') {
                clearInterval(timerInterval);
                submitBtn.disabled = false;
                btnText.classList.remove('hidden');
                btnSpinner.classList.add('hidden');
                showToast(data.message, 'warning', 6000);
                openTopupModal();
                return;
            }

            if (data.status !== 'ok') {
                throw new Error(data.message || 'Không thể bắt đầu tác vụ');
            }

            currentTaskId = data.task_id;
            currentVideoId = data.video_id;

            if (data.is_guest) {
                showToast('ℹ️ Bạn đang cào ở chế độ dùng thử (Tối đa 50 bình luận)', 'info', 4000);
            }

            addLog(`Tạo tác vụ thành công (Task ID: ${currentTaskId.substring(0, 8)}...)`);

            // 2. Lắng nghe SSE
            if (eventSource) eventSource.close();
            eventSource = new EventSource(`/api/stream/${currentTaskId}`);

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
                            currentComments.push(...msg.new_comments);
                            appendPreviewRows(msg.new_comments);
                            // Lưu state liên tục
                            saveScrapeState(url, currentComments, currentComments.length, currentTaskId);
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

                        if (msg.comments) {
                            currentComments = msg.comments;
                        }

                        // Lưu State hoàn chỉnh
                        saveScrapeState(url, currentComments, currentComments.length, currentTaskId);

                        // Cập nhật số dư credit nếu có
                        if (msg.remaining_credits !== undefined && currentUser) {
                            currentUser.credits = msg.remaining_credits;
                            updateUserUI(true);
                        }

                        downloadSection.classList.remove('hidden');
                        submitBtn.disabled = false;
                        btnText.classList.remove('hidden');
                        btnSpinner.classList.add('hidden');
                        showToast('🎉 Thu thập dữ liệu hoàn tất!', 'success');

                    } else if (msg.type === 'error') {
                        clearInterval(timerInterval);
                        eventSource.close();

                        addLog(msg.message);
                        progressStatus.innerHTML = `<span class="text-danger">${msg.message}</span>`;
                        showToast(msg.message, 'error');

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
            showToast(error.message, 'error');
            submitBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnSpinner.classList.add('hidden');
        }
    });

    // =========================================================================
    // 7. DOWNLOAD EXCEL & AUTH GATE TRIGGER
    // =========================================================================
    downloadBtn.addEventListener('click', handleDownloadClick);
    previewDownloadBtn.addEventListener('click', handleDownloadClick);

    function handleDownloadClick() {
        if (!currentUser) {
            // Lưu cờ Pending Download và mở Auth Modal
            sessionStorage.setItem(STORAGE_KEY_PENDING_DOWNLOAD, 'true');
            openAuthModal();
            showToast('🎁 Đăng nhập để nhận 3 lượt cào miễn phí & tải file Excel ngay!', 'info', 5000);
            return;
        }

        executeExcelDownload();
    }

    async function executeExcelDownload() {
        if (currentTaskId) {
            window.location.href = `/api/download/${currentTaskId}`;
            showToast('📥 Đang tải file Excel...', 'success');
            return;
        }

        // Nếu khôi phục từ State Cache (không có taskId trên server)
        if (currentComments && currentComments.length > 0) {
            try {
                showToast('⏳ Đang tạo file Excel...', 'info', 2000);
                const resp = await fetch('/api/download-cached', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        comments: currentComments,
                        video_id: currentVideoId || 'saved'
                    })
                });

                const data = await resp.json();
                if (data.status === 'ok' && data.download_url) {
                    window.location.href = data.download_url;
                    showToast('📥 Đã tải file Excel thành công!', 'success');
                } else {
                    showToast(data.message || 'Không thể tạo file Excel!', 'error');
                }
            } catch (err) {
                showToast('Lỗi khi xuất file Excel!', 'error');
            }
        } else {
            showToast('Chưa có dữ liệu bình luận để xuất file!', 'warning');
        }
    }

    // =========================================================================
    // 8. PRICING & TOP-UP MODAL
    // =========================================================================
    function openTopupModal() {
        topupModal.classList.remove('hidden');
    }

    btnTopupNav.addEventListener('click', openTopupModal);
    dropdownTopupBtn.addEventListener('click', () => {
        userDropdown.classList.add('hidden');
        openTopupModal();
    });

    closeTopupModal.addEventListener('click', () => {
        topupModal.classList.add('hidden');
    });

    // Package Selection
    const buyBtns = document.querySelectorAll('.btn-buy-package');
    buyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = btn.getAttribute('data-amount');
            const pkg = btn.getAttribute('data-pkg');
            const userEmail = currentUser ? currentUser.email : 'guest';

            qrPkgName.innerHTML = `Gói: <strong>${pkg}</strong> — Giá: <strong style="color: #00f2fe;">${Number(amount).toLocaleString()} VNĐ</strong>`;
            
            // Generate QR Mockup
            const qrContent = encodeURIComponent(`TIKTOK_VIP_${amount}_${userEmail}`);
            qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${qrContent}`;

            qrPaymentSection.classList.remove('hidden');
            qrPaymentSection.scrollIntoView({ behavior: 'smooth' });
            showToast(`Đã chọn gói ${pkg}. Vui lòng quét mã VietQR để thanh toán.`, 'info');
        });
    });

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    checkCurrentUser().then(() => {
        initGoogleAuth();
        restoreScrapeState();
    });
});
