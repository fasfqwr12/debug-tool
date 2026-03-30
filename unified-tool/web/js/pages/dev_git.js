/**
 * 代码管理页面
 * Git操作：pull, push, commit, log
 */

const DevGitPage = {
    projects: [],
    currentProject: null,
    gitStatus: null,
    commits: [],
    gitConfigured: false,
    _wsSubscribed: false,
    _destroyed: false,  // 页面销毁标志
    
    destroy() {
        // 标记页面已销毁，阻止后续异步操作更新UI
        this._destroyed = true;
        console.log('DevGitPage destroyed');
    },
    
    async init() {
        // 重置销毁标志
        this._destroyed = false;
        console.log('DevGitPage init');
        try {
            await this.loadProjects();
            
            // 检查Git安装
            const result = await API.call('dev_check_git');
            if (!result || !result.success) {
                console.warn('Git检查失败:', result?.error || '未知错误');
                // Git未安装时，在状态区域显示提示，不覆盖工程列表
                const statusArea = document.getElementById('git-status-area');
                const notGitArea = document.getElementById('not-git-area');
                if (statusArea) statusArea.style.display = 'none';
                if (notGitArea) {
                    notGitArea.style.display = 'flex';
                    notGitArea.innerHTML = '<div class="empty-hint">Git未安装或配置错误<br>请先安装Git: <a href="https://git-scm.com/downloads" target="_blank">https://git-scm.com/downloads</a></div>';
                }
                return;
            }
            this.gitConfigured = result.configured;
            
            // 订阅WebSocket事件
            this.subscribeWS();
        } catch (e) {
            console.error('DevGitPage初始化失败:', e);
            // 显示错误信息在状态区域，不覆盖工程列表
            const statusArea = document.getElementById('git-status-area');
            const notGitArea = document.getElementById('not-git-area');
            if (statusArea) statusArea.style.display = 'none';
            if (notGitArea) {
                notGitArea.style.display = 'flex';
                notGitArea.innerHTML = '<div class="empty-hint">初始化失败: ' + (e.message || '未知错误') + '</div>';
            }
        }
    },
    
    subscribeWS() {
        if (this._wsSubscribed || !window.WS) return;
        this._wsSubscribed = true;
        
        WS.subscribe(['git_progress', 'git_result']);
        WS.on('git_progress', (data) => {
            if (data.project_id !== this.currentProject?.id) return;
            Utils.toast(`⏳ ${data.message}`, 'info');
        });
        WS.on('git_result', (data) => {
            if (data.project_id !== this.currentProject?.id) return;
            
            // 隐藏loading
            this.hideGitLoading();
            
            if (data.success) {
                Utils.toast(`✓ ${data.action === 'pull' ? '拉取' : '推送'}成功`, 'success');
                this.refresh();
            } else {
                Utils.toast(`${data.action === 'pull' ? '拉取' : '推送'}失败: ${data.error}`, 'error');
            }
        });
    },
    
    showGitLoading(action) {
        const btn = document.getElementById(action === 'pull' ? 'btn-pull' : 'btn-push');
        if (btn) {
            btn.disabled = true;
            btn._originalHTML = btn.innerHTML;
            btn.innerHTML = `<span class="btn-spinner"></span> ${action === 'pull' ? '拉取中' : '推送中'}...`;
        }
    },
    
    hideGitLoading() {
        ['btn-pull', 'btn-push'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn && btn._originalHTML) {
                btn.disabled = false;
                btn.innerHTML = btn._originalHTML;
            }
        });
    },
    
    async showConfigDialog() {
        // 加载当前配置
        const result = await API.call('dev_check_git');
        if (result.success) {
            document.getElementById('git-config-name').value = result.user_name || '';
            document.getElementById('git-config-email').value = result.user_email || '';
        }
        document.getElementById('git-config-modal').style.display = 'flex';
    },
    
    hideConfigDialog() {
        document.getElementById('git-config-modal').style.display = 'none';
    },
    
    async saveGitConfig() {
        const name = document.getElementById('git-config-name').value.trim();
        const email = document.getElementById('git-config-email').value.trim();
        
        if (!name || !email) {
            alert('请填写用户名和邮箱');
            return;
        }
        
        const result = await API.call('dev_config_git', name, email);
        if (result.success) {
            this.gitConfigured = true;
            this.hideConfigDialog();
            alert('Git配置成功！');
        } else {
            alert('配置失败: ' + (result.error || ''));
        }
    },
    
    async loadProjects() {
        console.log('[DevGitPage] loadProjects 开始');
        const result = await API.call('dev_get_projects');
        if (this._destroyed) return;  // 页面已销毁，不更新UI
        console.log('[DevGitPage] dev_get_projects 结果:', result);
        if (result.success) {
            this.projects = result.projects || [];
            console.log('[DevGitPage] 加载了', this.projects.length, '个工程');
            this.renderProjects();
            
            // 自动选择第一个
            if (this.projects.length > 0 && !this.currentProject) {
                this.selectProject(this.projects[0].id);
            }
        } else {
            console.error('[DevGitPage] loadProjects 失败:', result.error);
        }
    },
    
    renderProjects() {
        const container = document.getElementById('project-list');
        if (!container) return;
        
        if (this.projects.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无工程，点击添加</div>';
            return;
        }
        
        container.innerHTML = this.projects.map(p => `
            <div class="project-card ${this.currentProject?.id === p.id ? 'active' : ''}"
                 onclick="DevGitPage.selectProject('${p.id}')">
                <span class="icon">📦</span>
                <div class="info">
                    <div class="name">${p.name}</div>
                    <div class="path">${p.source_dir || p.sourceDir || '--'}</div>
                </div>
                <button class="project-remove" title="从列表移除（不删除磁盘目录）"
                        onclick="event.stopPropagation();DevGitPage.removeProject('${p.id}')">×</button>
            </div>
        `).join('');
    },

    async removeProject(projectId) {
        const p = this.projects.find(x => x.id === projectId);
        if (!p) return;
        if (!confirm(`从工程列表移除：${p.name}\n\n仅移除列表记录，不会删除磁盘目录。\n确定继续？`)) return;

        const res = await API.call('dev_delete_project', projectId);
        if (!res.success) {
            alert('移除失败: ' + (res.error || ''));
            return;
        }

        // 如果移除的是当前工程，清空当前选择，后续自动选第一个
        if (this.currentProject?.id === projectId) {
            this.currentProject = null;
            this.gitStatus = null;
            this.commits = [];
            const title = document.getElementById('git-title');
            if (title) title.textContent = '选择工程';
            const openBtn = document.getElementById('btn-open-folder');
            if (openBtn) openBtn.style.display = 'none';
            const statusArea = document.getElementById('git-status-area');
            const notGitArea = document.getElementById('not-git-area');
            if (statusArea) statusArea.style.display = 'none';
            if (notGitArea) notGitArea.style.display = 'none';
            const changes = document.getElementById('changes-list');
            if (changes) changes.innerHTML = '<div class="empty-hint">选择工程查看变更</div>';
            const commits = document.getElementById('commit-list');
            if (commits) commits.innerHTML = '<div class="empty-hint">选择工程查看历史</div>';
        }

        await this.loadProjects();
        Utils.toast('已从列表移除', 'success');
    },
    
    async selectProject(projectId) {
        this.currentProject = this.projects.find(p => p.id === projectId);
        this.renderProjects();
        
        if (!this.currentProject) return;
        
        // 更新标题
        document.getElementById('git-title').textContent = this.currentProject.name;
        document.getElementById('btn-open-folder').style.display = 'block';
        
        // 先加载Git状态和分支（设置_lastBranch），再加载提交历史
        await this.loadGitStatus();
        await this.loadCommits();
    },
    
    async loadGitStatus() {
        if (this._destroyed) return;  // 页面已销毁，不更新UI
        const statusArea = document.getElementById('git-status-area');
        const notGitArea = document.getElementById('not-git-area');
        
        const result = await API.call('dev_git_status', this.currentProject.id);
        
        if (!result.success) {
            // 不是Git仓库
            statusArea.style.display = 'none';
            notGitArea.style.display = 'flex';
            return;
        }
        
        statusArea.style.display = 'flex';
        notGitArea.style.display = 'none';
        
        this.gitStatus = result.status;
        
        // 更新分支选择
        await this.loadBranches();
        
        // 更新状态徽章
        const badge = document.getElementById('git-status-badge');
        if (this.gitStatus.is_clean) {
            badge.className = 'status-badge clean';
            badge.textContent = '✓ 干净';
        } else {
            badge.className = 'status-badge dirty';
            const count = (this.gitStatus.staged?.length || 0) + 
                         (this.gitStatus.modified?.length || 0) + 
                         (this.gitStatus.untracked?.length || 0);
            badge.textContent = `● ${count} 变更`;
        }
        
        // 更新同步信息
        const syncInfo = document.getElementById('git-sync-info');
        if (this.gitStatus.ahead > 0 && this.gitStatus.behind > 0) {
            syncInfo.textContent = `↑${this.gitStatus.ahead} ↓${this.gitStatus.behind}`;
        } else if (this.gitStatus.ahead > 0) {
            syncInfo.textContent = `↑${this.gitStatus.ahead} 待推送`;
        } else if (this.gitStatus.behind > 0) {
            syncInfo.textContent = `↓${this.gitStatus.behind} 待拉取`;
        } else {
            syncInfo.textContent = '已同步';
        }
        
        // 渲染变更文件
        this.renderChanges();
    },
    
    async loadBranches() {
        const result = await API.call('dev_git_branches', this.currentProject.id);
        if (this._destroyed) return;  // 页面已销毁，不更新UI
        console.log('[loadBranches] result:', result);
        if (!result.success) return;
        
        const select = document.getElementById('git-branch-select');
        
        // 获取所有有效分支
        const branches = result.branches.filter(b => b && !b.includes('HEAD') && !b.includes('detached'));
        
        // 获取实际所在分支（detached时用containing_branch）
        const actualBranch = result.current !== 'HEAD' ? result.current : result.containing_branch;
        console.log('[loadBranches] actualBranch:', actualBranch, 'current:', result.current, 'containing_branch:', result.containing_branch);
        
        // 优先使用实际分支，只有在无法确定时才用localStorage
        const storageKey = `git_branch_${this.currentProject.id}`;
        const currentBranch = actualBranch || this._lastBranch || localStorage.getItem(storageKey) || branches[0] || '';
        
        // 更新内存和localStorage
        if (currentBranch) {
            this._lastBranch = currentBranch;
            localStorage.setItem(storageKey, currentBranch);
        }
        
        // 直接显示所有分支
        select.innerHTML = branches.map(b => {
            const selected = b === currentBranch ? 'selected' : '';
            return `<option value="${b}" ${selected}>${b}</option>`;
        }).join('');
    },
    
    // 保存分支选择到localStorage
    saveBranchSelection(branch) {
        if (this.currentProject && branch) {
            const storageKey = `git_branch_${this.currentProject.id}`;
            localStorage.setItem(storageKey, branch);
            this._lastBranch = branch;
        }
    },
    
    renderChanges() {
        const container = document.getElementById('changes-list');
        const countEl = document.getElementById('changes-count');
        
        const changes = [];
        
        // 已暂存
        (this.gitStatus.staged || []).forEach(f => {
            changes.push({ type: 'A', file: f, staged: true });
        });
        
        // 已修改
        (this.gitStatus.modified || []).forEach(f => {
            changes.push({ type: 'M', file: f, staged: false });
        });
        
        // 未跟踪
        (this.gitStatus.untracked || []).forEach(f => {
            changes.push({ type: 'U', file: f, staged: false });
        });
        
        countEl.textContent = changes.length;
        
        if (changes.length === 0) {
            container.innerHTML = '<div class="empty-hint">无变更</div>';
            return;
        }
        
        container.innerHTML = changes.map(c => {
            const safeFile = c.file.replace(/\\/g, '/').replace(/'/g, "\\'");
            return `
            <div class="change-item" onclick="DevGitPage.showDiff('${safeFile}', '${c.type}', ${c.staged})">
                <span class="type ${c.type}">${c.type}</span>
                <span class="file">${c.file}</span>
            </div>
        `}).join('');
    },
    
    async showDiff(filePath, type, staged) {
        if (type === 'U') {
            // 未跟踪文件，显示完整内容
            const result = await API.call('dev_git_file_content', this.currentProject.id, filePath);
            if (result.success) {
                this.showDiffDialog(filePath, result.content, true);
            }
        } else {
            // 已修改/已暂存文件，显示diff
            const result = await API.call('dev_git_diff', this.currentProject.id, filePath, staged);
            if (result.success) {
                this.showDiffDialog(filePath, result.diff, false);
            }
        }
    },
    
    showDiffDialog(filePath, content, isNewFile) {
        // 创建或获取diff弹窗
        let modal = document.getElementById('diff-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'diff-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-card xlarge">
                    <div class="modal-header">
                        <span id="diff-title">文件差异</span>
                        <button class="close-btn" onclick="DevGitPage.closeDiffDialog()">×</button>
                    </div>
                    <div class="modal-body" style="padding:0">
                        <pre id="diff-content" class="diff-view"></pre>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        document.getElementById('diff-title').textContent = isNewFile ? `📄 新文件: ${filePath}` : `📝 差异: ${filePath}`;
        
        // 格式化diff内容
        const diffEl = document.getElementById('diff-content');
        if (isNewFile) {
            // 新文件，显示带行号的内容
            const lines = content.split('\n');
            diffEl.innerHTML = lines.map((line, i) => 
                `<div class="diff-line add"><span class="line-num">${i+1}</span><span class="line-content">+ ${this.escapeHtml(line)}</span></div>`
            ).join('');
        } else if (!content.trim()) {
            diffEl.innerHTML = '<div class="empty-hint">无差异（可能是二进制文件或空修改）</div>';
        } else {
            // diff格式化
            const lines = content.split('\n');
            diffEl.innerHTML = lines.map(line => {
                let cls = 'diff-line';
                if (line.startsWith('+') && !line.startsWith('+++')) cls += ' add';
                else if (line.startsWith('-') && !line.startsWith('---')) cls += ' del';
                else if (line.startsWith('@@')) cls += ' info';
                else if (line.startsWith('diff') || line.startsWith('index')) cls += ' header';
                return `<div class="${cls}"><span class="line-content">${this.escapeHtml(line)}</span></div>`;
            }).join('');
        }
        
        modal.style.display = 'flex';
    },
    
    closeDiffDialog() {
        const modal = document.getElementById('diff-modal');
        if (modal) modal.style.display = 'none';
    },
    
    async loadCommits() {
        const container = document.getElementById('commit-list');
        if (this._destroyed || !container) return;  // 页面已销毁，不更新UI
        
        // 传入当前分支名，确保能看到该分支的完整历史
        const branch = this._lastBranch || document.getElementById('git-branch-select')?.value || '';
        console.log('[loadCommits] branch:', branch, '_lastBranch:', this._lastBranch);
        const result = await API.call('dev_git_log', this.currentProject.id, 50, branch);
        console.log('[loadCommits] result:', result.commits?.length, 'commits, head_hash:', result.head_hash);
        
        if (!result.success || !result.commits?.length) {
            container.innerHTML = '<div class="empty-hint">无提交历史</div>';
            return;
        }
        
        this.commits = result.commits;
        // 优先使用log返回的head_hash，更准确
        const currentHash = result.head_hash || this.gitStatus?.head_hash || '';
        const isDetached = this.gitStatus?.detached || false;
        
        // 清空
        container.innerHTML = '';
        
        // 使用增量渲染避免长列表卡顿
        const self = this;
        Utils.renderInChunks(container, this.commits, (c) => {
            const isCurrent = currentHash.startsWith(c.hash) || c.hash.startsWith(currentHash);
            return `
                <div class="commit-item ${isCurrent ? 'current' : ''}">
                    <div class="header">
                        <span class="hash">${c.short_hash}</span>
                        <span class="date">${c.date}</span>
                        ${isCurrent ? '<span class="current-badge">当前</span>' : ''}
                        <button class="diff-btn" onclick="DevGitPage.showCommitDiff('${c.hash}')" title="查看此版本改动">📄</button>
                        ${!isCurrent ? `<button class="revert-btn" onclick="DevGitPage.revertToCommit('${c.hash}')" title="切换到此版本">📍</button>` : ''}
                    </div>
                    <div class="message">${self.escapeHtml(c.message)}</div>
                    <div class="author">👤 ${c.author}</div>
                </div>
            `;
        }, 15);
    },
    
    // 查看某个提交的改动内容
    async showCommitDiff(commitHash) {
        Utils.toast('正在加载改动...', 'info');
        const result = await API.call('dev_git_show_commit', this.currentProject.id, commitHash);
        if (result.success) {
            this.showCommitDiffDialog(commitHash, result.diff, result.files || []);
        } else {
            Utils.toast('加载失败: ' + (result.error || ''), 'error');
        }
    },
    
    // 显示提交改动对话框（带文件列表）
    showCommitDiffDialog(commitHash, diffContent, files) {
        let modal = document.getElementById('commit-diff-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'commit-diff-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-card xlarge" style="width:90%;max-width:1200px;height:80vh;display:flex;flex-direction:column">
                    <div class="modal-header">
                        <span id="commit-diff-title">提交改动</span>
                        <button class="close-btn" onclick="document.getElementById('commit-diff-modal').style.display='none'">×</button>
                    </div>
                    <div class="modal-body" style="flex:1;display:flex;gap:12px;overflow:hidden;padding:12px">
                        <div id="commit-files-list" style="width:250px;overflow-y:auto;border-right:1px solid var(--border-color);padding-right:12px"></div>
                        <pre id="commit-diff-content" class="diff-view" style="flex:1;overflow:auto;margin:0"></pre>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        
        document.getElementById('commit-diff-title').textContent = `提交 ${commitHash.substring(0,7)} 的改动`;
        
        // 解析文件列表（从diff内容中提取）
        const fileMatches = diffContent.match(/diff --git a\/(.+?) b\//g) || [];
        const fileList = fileMatches.map(m => m.replace('diff --git a/', '').replace(' b/', ''));
        
        // 渲染文件列表
        const filesEl = document.getElementById('commit-files-list');
        if (fileList.length > 0) {
            filesEl.innerHTML = `<div style="font-weight:bold;margin-bottom:8px">📁 变更文件 (${fileList.length})</div>` +
                fileList.map((f, i) => `<div class="file-item" style="padding:6px 8px;cursor:pointer;border-radius:4px" 
                    onclick="DevGitPage.scrollToDiffFile(${i})">${f}</div>`).join('');
        } else {
            filesEl.innerHTML = '<div class="empty-hint">无文件变更</div>';
        }
        
        // 渲染diff内容（带语法高亮）
        const diffEl = document.getElementById('commit-diff-content');
        if (!diffContent.trim()) {
            diffEl.innerHTML = '<div class="empty-hint">无改动内容</div>';
        } else {
            const lines = diffContent.split('\n');
            diffEl.innerHTML = lines.map((line, idx) => {
                let cls = 'diff-line';
                if (line.startsWith('+') && !line.startsWith('+++')) cls += ' add';
                else if (line.startsWith('-') && !line.startsWith('---')) cls += ' del';
                else if (line.startsWith('@@')) cls += ' info';
                else if (line.startsWith('diff --git')) cls += ' header" data-file-idx="' + fileList.findIndex(f => line.includes(f));
                return `<div class="${cls}"><span class="line-content">${this.escapeHtml(line)}</span></div>`;
            }).join('');
        }
        
        modal.style.display = 'flex';
    },
    
    // 滚动到指定文件的diff
    scrollToDiffFile(idx) {
        const diffEl = document.getElementById('commit-diff-content');
        const headers = diffEl.querySelectorAll('.diff-line.header');
        if (headers[idx]) {
            headers[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
            headers[idx].style.background = 'rgba(0,255,136,0.3)';
            setTimeout(() => headers[idx].style.background = '', 1500);
        }
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    async switchBranch(branch) {
        if (!this.currentProject) return;
        if (!branch) return;  // 空值不处理
        
        // 保存分支选择
        this.saveBranchSelection(branch);
        
        Utils.toast(`正在切换到 ${branch}...`, 'info');
        const result = await API.call('dev_git_checkout', this.currentProject.id, branch);
        if (result.success) {
            Utils.toast(`✓ 已切换到 ${branch}`, 'success');
            await this.refresh();
        } else {
            Utils.toast('切换分支失败: ' + (result.error || ''), 'error');
        }
    },
    
    async gitPull() {
        if (!this.currentProject) return;
        
        // 使用异步API + WebSocket推送结果
        this.showGitLoading('pull');
        const result = await API.call('dev_git_pull_async', this.currentProject.id);
        
        if (!result.success) {
            this.hideGitLoading();
            if (result.error && result.error.includes('no tracking')) {
                if (confirm('尚未关联远程仓库，是否现在设置？')) {
                    this.showRemoteDialog();
                }
            } else {
                Utils.toast('拉取失败: ' + (result.error || ''), 'error');
            }
        }
        // 成功时等待WebSocket推送结果
    },
    
    async gitPush() {
        if (!this.currentProject) return;
        
        // 使用异步API + WebSocket推送结果
        this.showGitLoading('push');
        const result = await API.call('dev_git_push_async', this.currentProject.id);
        
        if (!result.success) {
            this.hideGitLoading();
            Utils.toast('推送失败: ' + (result.error || ''), 'error');
        }
        // 成功时等待WebSocket推送结果
    },
    
    showCommitDialog() {
        document.getElementById('commit-modal').style.display = 'flex';
        document.getElementById('commit-message').value = '';
        document.getElementById('commit-message').focus();
    },
    
    hideCommitDialog() {
        document.getElementById('commit-modal').style.display = 'none';
    },
    
    async doCommit() {
        const message = document.getElementById('commit-message').value.trim();
        if (!message) {
            Utils.toast('请输入提交信息', 'warning');
            return;
        }
        
        // 防止重复提交
        const confirmBtn = document.querySelector('.btn-confirm');
        if (confirmBtn.disabled) return;
        
        const addAll = document.getElementById('commit-add-all').checked;
        
        // 显示loading状态
        confirmBtn.disabled = true;
        const originalText = confirmBtn.textContent;
        confirmBtn.innerHTML = '<span class="btn-spinner"></span> 提交中...';
        
        try {
            const result = await API.call('dev_git_commit', this.currentProject.id, message, addAll);
            if (result.success) {
                this.hideCommitDialog();
                Utils.toast('✓ 提交成功', 'success');
                await this.refresh();
            } else {
                Utils.toast('提交失败: ' + (result.error || result.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('提交出错: ' + e.message, 'error');
        } finally {
            // 恢复按钮状态
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalText;
        }
    },
    
    async refresh() {
        if (this.currentProject) {
            await this.loadGitStatus();
            await this.loadCommits();
        }
    },
    
    async addProject() {
        // 选择文件夹
        const result = await API.call('dev_select_folder');
        if (!result.success) return;
        
        const path = result.path;
        const name = prompt('请输入工程名称:', path.split('\\').pop());
        if (!name) return;
        
        const productCode = prompt('请输入产品代号 (如GL100):', name.toUpperCase().replace(/\s+/g, ''));
        if (!productCode) return;
        
        const addResult = await API.call('dev_add_project', name, productCode, path);
        if (addResult.success) {
            await this.loadProjects();
            this.selectProject(addResult.project.id);
        } else {
            alert('添加失败: ' + (addResult.error || ''));
        }
    },
    
    async openFolder() {
        if (!this.currentProject) return;
        await API.call('dev_open_folder', this.currentProject.source_dir || this.currentProject.sourceDir);
    },
    
    // Git初始化
    async gitInit() {
        if (!this.currentProject) return;
        
        if (!confirm('确定初始化Git仓库？这将在该目录创建.git文件夹')) return;
        
        const result = await API.call('dev_git_init', this.currentProject.id);
        if (result.success) {
            alert('Git仓库初始化成功！');
            await this.refresh();
        } else {
            alert('初始化失败: ' + (result.error || ''));
        }
    },
    
    // 显示远程仓库对话框
    showRemoteDialog() {
        document.getElementById('remote-modal').style.display = 'flex';
        document.getElementById('remote-url').value = '';
        document.getElementById('remote-url').focus();
    },
    
    hideRemoteDialog() {
        document.getElementById('remote-modal').style.display = 'none';
    },
    
    // 设置远程仓库（带凭据）
    async saveRemoteWithCredentials() {
        const url = document.getElementById('remote-url').value.trim();
        const username = document.getElementById('git-username').value.trim();
        const password = document.getElementById('git-password').value.trim();
        
        if (!url) {
            alert('请输入仓库地址');
            return;
        }
        if (!username || !password) {
            alert('请输入用户名和密码/Token');
            return;
        }
        
        // 先初始化（如果还不是Git仓库）
        if (!this.gitStatus) {
            const initResult = await API.call('dev_git_init', this.currentProject.id);
            if (!initResult.success && !initResult.error?.includes('已经是')) {
                alert('初始化失败: ' + (initResult.error || ''));
                return;
            }
        }
        
        // 设置远程仓库和凭据
        const result = await API.call('dev_git_set_credentials', 
            this.currentProject.id, url, username, password);
        
        if (result.success) {
            this.hideRemoteDialog();
            alert('✅ 远程仓库设置成功！\n现在可以使用 Pull/Push 了');
            await this.refresh();
        } else {
            alert('设置失败: ' + (result.error || ''));
        }
    },
    
    // 旧方法保留
    async setRemote() {
        await this.saveRemoteWithCredentials();
    },
    
    // 忽略文件
    async ignorePattern() {
        const pattern = prompt('输入要忽略的文件模式（多个用换行分隔）：\n\n常用：\n*.o - 编译产物\n*.d - 依赖文件\n*.hex - HEX文件\n*.bin - BIN文件\nObjects/ - Keil输出目录\noutput/ - 输出目录', '*.o\n*.d\n*.lst\n*.htm\n*.dep\n*.crf\n*.lnp\n*.map\noutput/');
        
        if (!pattern) return;
        
        // 后端会自动添加忽略规则并取消跟踪匹配文件
        const result = await API.call('dev_git_add_gitignore', this.currentProject.id, pattern);
        if (result.success) {
            const msg = ['已添加忽略规则：', result.added?.join('\n') || '无新增'];
            if (result.removed?.length) {
                msg.push('\n\n已取消跟踪：', result.removed.join('\n'));
            }
            Utils.toast(msg.join(''), 'success');
            await this.refresh();
        } else {
            Utils.toast('添加失败: ' + (result.error || ''), 'error');
        }
    },
    
    // 撤销所有修改
    async resetAll() {
        if (!confirm('⚠️ 确定撤销所有未提交的修改？\n\n此操作不可恢复！')) return;
        
        const result = await API.call('dev_git_reset_all', this.currentProject.id);
        if (result.success) {
            alert('已撤销所有修改');
            await this.refresh();
        } else {
            alert('撤销失败: ' + (result.error || ''));
        }
    },
    
    // 切换到指定提交（在当前分支内来回切换）
    async revertToCommit(commitHash) {
        if (!confirm(`切换到提交 ${commitHash.substring(0,7)}？`)) return;
        
        // 记住当前分支（切换前）
        const select = document.getElementById('git-branch-select');
        const savedBranch = select?.value || this._lastBranch;
        if (savedBranch) {
            this._lastBranch = savedBranch;
        }
        
        Utils.toast('正在切换...', 'info');
        const result = await API.call('dev_git_revert_commit', this.currentProject.id, commitHash);
        if (result.success) {
            Utils.toast(`✓ 已切换到 ${commitHash.substring(0,7)}`, 'success');
            // 只刷新状态和提交历史，不重新加载分支
            const statusResult = await API.call('dev_git_status', this.currentProject.id);
            if (statusResult.success) {
                this.gitStatus = statusResult.status;
                this.renderChanges();
            }
            await this.loadCommits();
            // 确保分支选择保持不变
            if (this._lastBranch && select) {
                select.value = this._lastBranch;
            }
        } else {
            Utils.toast('切换失败: ' + (result.error || ''), 'error');
        }
    },
    
    // 返回最新版本
    async backToLatest() {
        // 获取真实分支名，排除detached HEAD状态的显示
        let branch = 'master';
        const select = document.getElementById('git-branch-select');
        if (select) {
            const val = select.value;
            // 如果不是detached状态的显示，使用选择的值
            if (val && !val.includes('HEAD detached') && !val.includes('(')) {
                branch = val;
            }
        }
        
        Utils.toast('正在返回最新版本...', 'info');
        const result = await API.call('dev_git_checkout_branch', this.currentProject.id, branch);
        if (result.success) {
            let msg = '✓ 已返回最新版本';
            if (result.stash_saved) msg += '（历史版本修改已暂存）';
            if (result.stash_restored) msg += '（已恢复之前的修改）';
            Utils.toast(msg, 'success');
            await this.refresh();
        } else {
            Utils.toast('返回失败: ' + (result.error || ''), 'error');
        }
    },
    
    // 清理所有自动暂存的stash
    async clearAutoStash() {
        if (!confirm('确定清理所有自动暂存的修改？\n\n这将删除切换版本时自动保存的所有修改，不可恢复！')) return;
        
        const result = await API.call('dev_git_clear_auto_stash', this.currentProject.id);
        if (result.success) {
            Utils.toast(`✓ 已清理 ${result.cleared || 0} 个自动暂存`, 'success');
        } else {
            Utils.toast('清理失败: ' + (result.error || ''), 'error');
        }
    }
};
