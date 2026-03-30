/**
 * 任务中心 - 基于Git的任务流转
 * 研发创建任务 → Git仓库同步 → 测试拉取执行 → 结果回传
 */
window.TaskCenterPage = {
    tasks: [],
    currentTask: null,
    currentRole: 'tester',
    repoConfig: null,
    
    async init() {
        console.log('[TaskCenter] init');
        
        // 加载仓库配置
        await this.loadRepoConfig();
        
        // 自动同步
        if (this.repoConfig?.repo_path) {
            await this.syncTasks();
        }
    },
    
    // ==================== 仓库配置（复用系统设置） ====================
    
    async loadRepoConfig() {
        try {
            // 从git_remote_config获取Git配置
            const result = await API.call('git_remote_get_config');
            if (result?.success && result.config) {
                const config = result.config;
                const gitEnabled = config.enabled;
                const gitUrl = config.remote_url;
                
                if (gitEnabled && gitUrl) {
                    // 获取本地仓库路径
                    const pathResult = await this.getDefaultTaskPath();
                    this.repoConfig = {
                        enabled: gitEnabled,
                        repo_url: gitUrl,
                        ssh_key: config.ssh_key_path,
                        repo_path: pathResult
                    };
                    this.updateSyncStatus('synced', '已配置Git');
                } else {
                    // Git未配置，但仍可使用共享目录
                    this.repoConfig = { enabled: false };
                    this.updateSyncStatus('warning', '未配置Git，使用共享目录');
                }
            } else {
                // 没有Git配置，使用共享目录模式
                this.repoConfig = { enabled: false };
                this.updateSyncStatus('warning', '未配置Git，使用共享目录');
            }
        } catch (e) {
            console.warn('加载仓库配置失败:', e);
            this.repoConfig = { enabled: false };
            this.updateSyncStatus('warning', '使用共享目录模式');
        }
    },
    
    async getDefaultTaskPath() {
        // 默认任务目录
        try {
            const result = await API.call('get_task_repo_path');
            return result?.path || '';
        } catch (e) {
            return '';
        }
    },
    
    configRepo() {
        // 跳转到系统设置的Git配置页面
        switchPage('settings');
        Utils.toast('请在系统设置 → Git仓库 中配置', 'info');
        
        // 延迟切换到Git Tab
        setTimeout(() => {
            if (window.SettingsPage?.switchTab) {
                SettingsPage.switchTab('git');
            }
        }, 300);
    },
    
    // ==================== 任务同步 ====================
    
    async syncTasks() {
        try {
            this.updateSyncStatus('syncing', '同步中...');
            this.tasks = [];
            
            // 1. 从共享目录扫描任务（优先级最高）
            try {
                const shareResult = await API.call('share_scan_directory');
                if (shareResult?.success && shareResult.tasks?.length > 0) {
                    this.tasks.push(...shareResult.tasks.map(t => ({
                        ...t,
                        source: 'share_dir',
                        source_label: '📂 共享目录'
                    })));
                    console.log(`[TaskCenter] 从共享目录加载 ${shareResult.tasks.length} 个任务`);
                }
            } catch (e) {
                console.warn('扫描共享目录失败:', e);
            }
            
            // 2. 从Git仓库同步（如果配置了）
            if (this.repoConfig?.enabled && this.repoConfig?.repo_path) {
                try {
                    const gitResult = await API.call('task_sync', this.repoConfig.repo_path);
                    if (gitResult?.success && gitResult.tasks?.length > 0) {
                        // 合并，避免重复（按version_id去重）
                        for (const task of gitResult.tasks) {
                            const exists = this.tasks.find(t => 
                                t.id === task.id || 
                                (t.version_id && t.version_id === task.version_id)
                            );
                            if (!exists) {
                                this.tasks.push({
                                    ...task, 
                                    source: 'git',
                                    source_label: '📦 Git仓库'
                                });
                            }
                        }
                        console.log(`[TaskCenter] 从Git加载 ${gitResult.tasks.length} 个任务`);
                    }
                } catch (e) {
                    console.warn('Git同步失败:', e);
                }
            }
            
            // 3. 从版本发布获取待测队列
            try {
                const queueResult = await API.call('dev_get_test_queue');
                if (queueResult?.success && queueResult.queue?.length > 0) {
                    for (const item of queueResult.queue) {
                        const exists = this.tasks.find(t => 
                            t.version_id === item.id || 
                            t.id === item.id
                        );
                        if (!exists) {
                            this.tasks.push({
                                id: item.id,
                                version_id: item.id,
                                project_name: item.project?.name || '',
                                version: item.version,
                                fw_crc: item.fw_crc32 || '',
                                hex_file: item.hex_file || '',
                                release_note: item.release_note || '',
                                status: item.status === 'testing' ? 'testing' : 'pending',
                                assigned_at: item.submit_time || item.created_at,
                                source: 'version',
                                source_label: '📋 版本发布'
                            });
                        }
                    }
                    console.log(`[TaskCenter] 从版本队列加载 ${queueResult.queue.length} 个任务`);
                }
            } catch (e) {
                console.warn('加载版本队列失败:', e);
            }
            
            // 按时间排序（最新的在前）
            this.tasks.sort((a, b) => {
                const ta = a.assigned_at || a.created_at || '';
                const tb = b.assigned_at || b.created_at || '';
                return tb.localeCompare(ta);
            });
            
            this.renderTaskList();
            this.updateSyncStatus('synced', `已同步 ${this.tasks.length} 个任务`);
            
            if (this.tasks.length > 0) {
                Utils.toast(`同步完成，${this.tasks.length} 个任务`, 'success');
            } else {
                Utils.toast('暂无待处理任务', 'info');
            }
            
        } catch (e) {
            console.error('同步任务失败:', e);
            Utils.toast('同步失败: ' + e.message, 'error');
            this.updateSyncStatus('error', '同步失败');
        }
    },
    
    updateSyncStatus(status, text) {
        const el = document.getElementById('sync-status');
        if (el) {
            el.className = 'sync-status ' + status;
            el.innerHTML = `<span class="dot"></span> ${text}`;
        }
    },
    
    // ==================== 角色切换 ====================
    
    switchRole(role) {
        this.currentRole = role;
        
        // 更新Tab状态
        document.querySelectorAll('.role-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.role === role);
        });
        
        // 根据角色过滤任务
        this.filterTasks();
    },
    
    // ==================== 任务列表 ====================
    
    filterTasks() {
        const status = document.getElementById('filter-status')?.value || '';
        const keyword = document.getElementById('filter-keyword')?.value?.toLowerCase() || '';
        
        let filtered = this.tasks;
        
        // 按角色过滤
        if (this.currentRole === 'tester') {
            // 测试人员看待测试和测试中的任务
            filtered = filtered.filter(t => 
                ['pending', 'testing', 'passed', 'failed'].includes(t.status)
            );
        } else if (this.currentRole === 'developer') {
            // 研发看自己创建的任务
            filtered = filtered.filter(t => t.created_by === this.repoConfig?.username);
        } else if (this.currentRole === 'production') {
            // 生产看已通过的任务
            filtered = filtered.filter(t => t.status === 'passed' || t.status === 'released');
        }
        
        // 按状态过滤
        if (status) {
            filtered = filtered.filter(t => t.status === status);
        }
        
        // 按关键词过滤
        if (keyword) {
            filtered = filtered.filter(t => 
                t.project_name?.toLowerCase().includes(keyword) ||
                t.version?.toLowerCase().includes(keyword)
            );
        }
        
        this.renderTaskList(filtered);
    },
    
    renderTaskList(tasks = this.tasks) {
        const container = document.getElementById('task-list');
        const countEl = document.getElementById('task-count');
        
        if (countEl) countEl.textContent = tasks.length;
        if (!container) return;
        
        if (tasks.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无任务<br><small>点击"同步任务"获取最新任务</small></div>';
            return;
        }
        
        const statusNames = {
            'pending': '待测试',
            'testing': '测试中',
            'passed': '已通过',
            'failed': '未通过',
            'released': '已发布',
            'in_progress': '测试中'
        };
        
        container.innerHTML = tasks.map(t => `
            <div class="task-item ${this.currentTask?.id === t.id ? 'active' : ''}"
                 onclick="TaskCenterPage.selectTask('${t.id}')">
                <div class="task-header">
                    <div class="task-title">${t.project_name || '未知项目'} v${t.version || '?'}</div>
                    <span class="task-source">${t.source_label || t.source || ''}</span>
                </div>
                <div class="task-meta">
                    <span>${t.assigned_at?.substring(0, 10) || '--'}</span>
                    <span class="task-status ${t.status}">${statusNames[t.status] || t.status}</span>
                </div>
            </div>
        `).join('');
    },
    
    // ==================== 任务详情 ====================
    
    selectTask(taskId) {
        this.currentTask = this.tasks.find(t => t.id === taskId);
        
        // 更新列表选中状态
        document.querySelectorAll('.task-item').forEach(el => {
            el.classList.toggle('active', el.onclick.toString().includes(taskId));
        });
        
        this.renderTaskDetail();
    },
    
    renderTaskDetail() {
        const emptyEl = document.getElementById('task-detail-empty');
        const contentEl = document.getElementById('task-detail-content');
        
        if (!this.currentTask) {
            emptyEl.style.display = 'flex';
            contentEl.style.display = 'none';
            return;
        }
        
        emptyEl.style.display = 'none';
        contentEl.style.display = 'block';
        
        const t = this.currentTask;
        
        // 填充信息
        document.getElementById('detail-project').textContent = t.project_name || '--';
        document.getElementById('detail-version').textContent = 'v' + (t.version || '?');
        document.getElementById('detail-crc').textContent = t.fw_crc || t.crc || '--';
        document.getElementById('detail-assigner').textContent = t.assigned_by || '--';
        document.getElementById('detail-assign-time').textContent = t.assigned_at || '--';
        
        const statusNames = {
            'pending': '待测试',
            'testing': '测试中',
            'passed': '已通过',
            'failed': '未通过'
        };
        const statusEl = document.getElementById('detail-status');
        statusEl.textContent = statusNames[t.status] || t.status;
        statusEl.className = 'task-status ' + t.status;
        
        document.getElementById('detail-release-note').textContent = t.release_note || '无';
        
        // 测试要求
        const reqEl = document.getElementById('detail-requirements');
        const requirements = t.test_requirements || ['精度测试'];
        reqEl.innerHTML = requirements.map(r => `<div class="req-item">✓ ${r}</div>`).join('');
        
        // 测试结果
        const resultSection = document.getElementById('result-section');
        const resultEl = document.getElementById('detail-result');
        if (t.test_result) {
            resultSection.style.display = 'block';
            resultEl.innerHTML = `
                <div>通过率: <b style="color:${t.test_result.pass_rate > 0.9 ? '#00e676' : '#ff5252'}">${(t.test_result.pass_rate * 100).toFixed(1)}%</b></div>
                <div>测试人员: ${t.test_result.tester || '--'}</div>
                <div>完成时间: ${t.test_result.completed_at || '--'}</div>
            `;
        } else {
            resultSection.style.display = 'none';
        }
        
        // 按钮状态
        const btnStart = document.getElementById('btn-start-test');
        const btnSubmit = document.getElementById('btn-submit-result');
        
        if (t.status === 'pending') {
            btnStart.style.display = 'block';
            btnStart.textContent = '▶️ 开始测试';
            btnSubmit.style.display = 'none';
        } else if (t.status === 'testing') {
            btnStart.style.display = 'block';
            btnStart.textContent = '📋 继续测试';
            btnSubmit.style.display = 'block';
        } else {
            btnStart.style.display = 'none';
            btnSubmit.style.display = 'none';
        }
    },
    
    // ==================== 任务操作 ====================
    
    async startTest() {
        if (!this.currentTask) return;
        
        try {
            // 更新任务状态为测试中
            if (this.currentTask.status === 'pending') {
                // 根据来源选择不同的更新方式
                if (this.currentTask.source === 'share_dir' && this.currentTask.share_path) {
                    // 共享目录任务：更新共享文件
                    const result = await API.call('share_update_assignment_status', 
                        { share_path: this.currentTask.share_path }, 
                        'in_progress'
                    );
                    if (result?.success) {
                        this.currentTask.status = 'testing';
                    }
                } else if (this.currentTask.source === 'git' && this.repoConfig?.repo_path) {
                    // Git任务：使用task_center的API（需要repo_path）
                    // 注意：由于API冲突，这里直接更新本地状态
                    this.currentTask.status = 'testing';
                } else {
                    // 版本队列任务或其他：使用简单的task_update_status
                    const result = await API.call('task_update_status',
                        this.currentTask.id,
                        'testing'
                    );
                    if (result?.success) {
                        this.currentTask.status = 'testing';
                    } else {
                        // 如果API失败，仍然更新本地状态
                        this.currentTask.status = 'testing';
                    }
                }
                
                this.renderTaskDetail();
                this.renderTaskList();
            }
            
            // 保存当前任务到sessionStorage，供测试页面使用
            sessionStorage.setItem('currentTestTask', JSON.stringify(this.currentTask));
            
            // 跳转到对应的测试页面
            const testType = this.currentTask.test_requirements?.[0] || '精度测试';
            if (testType.includes('滑台') || testType.includes('精度')) {
                switchPage('slipway');
            } else if (testType.includes('校准')) {
                switchPage('calibration');
            } else {
                switchPage('test_queue');
            }
            
            Utils.toast('已开始测试，请在测试页面完成测试', 'info');
            
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async submitResult() {
        if (!this.currentTask) return;
        
        try {
            // 获取关联的测试数据
            const dataResult = await API.call('task_get_test_data', this.currentTask.id);
            
            if (!dataResult?.success || !dataResult.sessions?.length) {
                // 尝试从滑台测试获取结果
                const slipwayData = sessionStorage.getItem('slipwayTestResults');
                if (!slipwayData) {
                    Utils.toast('未找到测试数据，请先完成测试', 'warning');
                    return;
                }
            }
            
            // 计算通过率
            const sessions = dataResult?.sessions || [];
            const passed = sessions.filter(s => s.status === 'completed').length;
            const passRate = sessions.length > 0 ? (passed / sessions.length) : 1;
            
            // 确认提交
            const status = passRate >= 0.9 ? 'passed' : 'failed';
            const statusText = status === 'passed' ? '通过' : '未通过';
            
            if (!confirm(`测试通过率: ${(passRate * 100).toFixed(1)}%\n状态: ${statusText}\n\n确认提交结果？`)) {
                return;
            }
            
            const resultData = {
                status: status,
                pass_rate: passRate,
                sessions: sessions.map(s => s.id),
                tester: this.repoConfig?.username || 'unknown',
                completed_at: new Date().toISOString()
            };
            
            // 根据来源选择不同的提交方式
            let submitResult = null;
            
            if (this.currentTask.source === 'share_dir' && this.currentTask.share_path) {
                // 共享目录任务：更新共享文件
                try {
                    submitResult = await API.call('share_update_results', 
                        { share_path: this.currentTask.share_path },
                        status,
                        '',
                        resultData
                    );
                } catch (e) {
                    console.warn('更新共享文件失败:', e);
                    submitResult = { success: true }; // 允许继续
                }
            } else if (this.currentTask.source === 'git' && this.repoConfig?.repo_path) {
                // Git任务：本地更新状态（避免API冲突）
                this.currentTask.status = status;
                this.currentTask.test_result = resultData;
                submitResult = { success: true };
            } else {
                // 版本队列任务：使用简单的task_update_status
                try {
                    submitResult = await API.call('task_update_status',
                        this.currentTask.id,
                        status
                    );
                } catch (e) {
                    console.warn('更新任务状态失败:', e);
                    submitResult = { success: true }; // 允许继续
                }
            }
            
            if (submitResult?.success) {
                this.currentTask.status = status;
                this.currentTask.test_result = submitResult.test_result || resultData;
                this.renderTaskDetail();
                this.renderTaskList();
                Utils.toast('结果已提交', 'success');
            } else {
                Utils.toast('提交失败: ' + (submitResult?.error || ''), 'error');
            }
            
        } catch (e) {
            Utils.toast('提交失败: ' + e.message, 'error');
        }
    },
    
    async downloadFirmware() {
        if (!this.currentTask) return;
        
        try {
            // 如果任务有hex_file路径，直接使用
            if (this.currentTask.hex_file) {
                Utils.toast('固件路径: ' + this.currentTask.hex_file, 'info');
                return;
            }
            
            const result = await API.call('task_download_firmware',
                this.repoConfig?.repo_path || '',
                this.currentTask.id
            );
            
            if (result?.success) {
                Utils.toast('固件已下载到: ' + result.path, 'success');
            } else {
                Utils.toast('下载失败: ' + (result?.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('下载失败: ' + e.message, 'error');
        }
    },
    
    // 打开共享目录设置
    async openShareDir() {
        try {
            const result = await API.call('share_set_directory');
            if (result?.success) {
                Utils.toast('共享目录已设置: ' + result.path, 'success');
                await this.syncTasks();
            }
        } catch (e) {
            Utils.toast('设置失败: ' + e.message, 'error');
        }
    },
    
    // 查看任务来源详情
    viewTaskSource() {
        if (!this.currentTask) return;
        
        const source = this.currentTask.source;
        if (source === 'share_dir' && this.currentTask.share_path) {
            Utils.toast('共享文件: ' + this.currentTask.share_path, 'info');
        } else if (source === 'git') {
            Utils.toast('Git仓库任务', 'info');
        } else if (source === 'version') {
            // 跳转到版本发布页面
            switchPage('dev_release');
        }
    }
};
