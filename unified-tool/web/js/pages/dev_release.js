/**
 * 版本发布页面
 * 创建版本、提交测试
 */

const DevReleasePage = {
    projects: [],
    currentProject: null,
    versions: [],
    currentVersion: null,
    
    async init() {
        console.log('DevReleasePage init');
        try {
            await this.loadProjects();
        } catch (e) {
            console.error('DevReleasePage初始化失败:', e);
            // 显示错误信息，不跳转
            const versionList = document.getElementById('version-list');
            if (versionList) {
                versionList.innerHTML = '<div class="empty-hint">初始化失败: ' + (e.message || '未知错误') + '</div>';
            }
        }
    },
    
    async loadProjects() {
        const result = await API.call('dev_get_projects');
        if (result.success) {
            this.projects = result.projects || [];
            this.renderProjectSelect();
        }
    },
    
    renderProjectSelect() {
        const select = document.getElementById('project-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- 选择工程 --</option>' +
            this.projects.map(p => 
                `<option value="${p.id}">${p.name} (${p.product_code || p.productCode})</option>`
            ).join('');
    },
    
    async selectProject(projectId) {
        if (!projectId) {
            this.currentProject = null;
            this.versions = [];
            this.currentVersion = null;
            document.getElementById('version-list').innerHTML = '<div class="empty-hint">选择工程查看版本</div>';
            document.getElementById('version-detail').innerHTML = '<div class="empty-hint">选择版本查看详情</div>';
            return;
        }
        
        this.currentProject = this.projects.find(p => p.id === projectId);
        await this.loadVersions();
        await this.loadGitInfo();
    },
    
    async loadVersions() {
        if (!this.currentProject) return;
        
        const result = await API.call('dev_get_versions', this.currentProject.id);
        if (result.success) {
            this.versions = result.versions || [];
            this.renderVersions();
        }
    },
    
    renderVersions() {
        const container = document.getElementById('version-list');
        const countEl = document.getElementById('version-count');
        
        countEl.textContent = this.versions.length;
        
        if (this.versions.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无版本<br><small>在右侧创建新版本</small></div>';
            return;
        }
        
        const stageNames = {
            'dev': '开发中',
            'submitted': '待测试',
            'testing': '测试中',
            'passed': '已通过',
            'rejected': '已退回',
            'released': '已发布'
        };
        
        container.innerHTML = this.versions.map(v => `
            <div class="version-card ${this.currentVersion?.id === v.id ? 'active' : ''}"
                 onclick="DevReleasePage.selectVersion('${v.id}')">
                <div class="header">
                    <span class="ver">v${v.version}</span>
                    <span class="stage ${v.stage}">${stageNames[v.stage] || v.stage}</span>
                </div>
                <div class="meta">
                    ${v.git_commit || v.gitCommit || '--'} · ${v.created_at || v.createdAt || '--'}
                </div>
            </div>
        `).join('');
    },
    
    selectVersion(versionId) {
        this.currentVersion = this.versions.find(v => v.id === versionId);
        this.renderVersions();
        this.renderVersionDetail();
    },
    
    renderVersionDetail() {
        const container = document.getElementById('version-detail');
        
        if (!this.currentVersion) {
            container.innerHTML = '<div class="empty-hint">选择版本查看详情</div>';
            // Hide share actions when no version selected
            const shareActions = document.getElementById('share-actions');
            if (shareActions) shareActions.style.display = 'none';
            return;
        }
        
        // Show share actions when version is selected
        const shareActions = document.getElementById('share-actions');
        if (shareActions) shareActions.style.display = 'block';
        
        const v = this.currentVersion;
        const stageNames = {
            'dev': '开发中',
            'submitted': '待测试',
            'testing': '测试中',
            'passed': '已通过',
            'rejected': '已退回',
            'released': '已发布'
        };
        
        container.innerHTML = `
            <div class="detail-section">
                <div class="title">📦 基本信息</div>
                <div class="content">
                    <div class="detail-row">
                        <span class="label">版本号</span>
                        <span class="value">v${v.version}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">状态</span>
                        <span class="value stage ${v.stage}">${stageNames[v.stage] || v.stage}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">创建时间</span>
                        <span class="value">${v.created_at || v.createdAt || '--'}</span>
                    </div>
                </div>
            </div>
            
            <div class="detail-section">
                <div class="title">📝 源码信息</div>
                <div class="content">
                    <div class="detail-row">
                        <span class="label">Git分支</span>
                        <span class="value">${v.git_branch || v.gitBranch || '--'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">Git提交</span>
                        <span class="value">${v.git_commit || v.gitCommit || '--'}</span>
                    </div>
                </div>
            </div>
            
            <div class="detail-section">
                <div class="title">📄 固件文件</div>
                <div class="content">
                    <div class="detail-row">
                        <span class="label">文件</span>
                        <span class="value">${(v.hex_file || v.hexFile || '').split('\\').pop() || '--'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">大小</span>
                        <span class="value">${v.hex_size || v.hexSize || '--'}</span>
                    </div>
                    ${v.fw_version || v.fwVersion ? `
                    <div class="detail-row">
                        <span class="label">固件版本</span>
                        <span class="value" style="color:var(--accent-color);font-weight:600">${v.fw_version || v.fwVersion}</span>
                    </div>
                    ` : ''}
                    ${v.fw_model || v.fwModel ? `
                    <div class="detail-row">
                        <span class="label">型号</span>
                        <span class="value">${v.fw_model || v.fwModel}</span>
                    </div>
                    ` : ''}
                    ${v.fw_hw_version || v.fwHwVersion ? `
                    <div class="detail-row">
                        <span class="label">硬件版本</span>
                        <span class="value">HW ${v.fw_hw_version || v.fwHwVersion}</span>
                    </div>
                    ` : ''}
                    ${(v.fw_crc32 || v.fwCrc32 || v.fw_crc32_boot || v.fwCrc32Boot) ? `
                    <div class="detail-row">
                        <span class="label">CRC32</span>
                        <span class="value" style="font-family:monospace;font-size:11px">${v.fw_crc32 || v.fwCrc32 || v.fw_crc32_boot || v.fwCrc32Boot}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            
            ${v.release_note || v.releaseNote ? `
            <div class="detail-section">
                <div class="title">📋 发布说明</div>
                <div class="content">${v.release_note || v.releaseNote}</div>
            </div>
            ` : ''}
            
            ${v.stage === 'dev' ? `
                <button class="action-btn primary" onclick="DevReleasePage.submitToTest('${v.id}')">
                    📤 提交到测试
                </button>
            ` : ''}
            
            ${v.stage === 'passed' ? `
                <button class="action-btn primary" onclick="DevReleasePage.releaseToProduction('${v.id}')">
                    🏭 发布到生产
                </button>
            ` : ''}
            
            ${v.stage === 'submitted' || v.stage === 'testing' ? `
                <button class="action-btn" onclick="switchPage('test_queue')">
                    🔍 查看测试进度
                </button>
            ` : ''}

            <button class="action-btn danger" style="margin-top:8px" onclick="DevReleasePage.deleteVersion('${v.id}')">
                🗑 删除版本
            </button>
        `;
    },
    
    async loadGitInfo() {
        if (!this.currentProject) return;
        
        const result = await API.call('dev_git_status', this.currentProject.id);
        
        const branchEl = document.getElementById('current-branch');
        const commitEl = document.getElementById('current-commit');
        
        if (result.success) {
            branchEl.textContent = result.status.branch || '--';
            
            // 获取最新提交
            const logResult = await API.call('dev_git_log', this.currentProject.id, 1);
            if (logResult.success && logResult.commits?.length > 0) {
                const c = logResult.commits[0];
                commitEl.textContent = `${c.short_hash} - ${c.message.substring(0, 30)}`;
            } else {
                commitEl.textContent = '--';
            }
        } else {
            branchEl.textContent = '非Git仓库';
            commitEl.textContent = '--';
        }
    },
    
    async selectHexFile() {
        const result = await API.call('dev_select_hex_file');
        if (result.success && result.path) {
            document.getElementById('new-hex-file').value = result.path;
            
            // 解析固件元数据
            await this.parseFirmwareMeta(result.path);
        }
    },
    
    firmwareMeta: null,  // 当前固件元数据
    
    async parseFirmwareMeta(filepath) {
        try {
            const meta = await API.call('dev_parse_firmware', filepath);
            this.firmwareMeta = meta;
            
            // 更新固件信息显示
            this.renderFirmwareMeta(meta);
            
            // 自动填充版本号
            if (meta.meta && meta.meta.valid) {
                const versionInput = document.getElementById('new-version');
                if (!versionInput.value) {
                    // 从元数据提取版本: V1.2.0.1 -> 1.2.0
                    const verStr = meta.meta.version || '';
                    const match = verStr.match(/V?(\d+)\.(\d+)\.(\d+)/);
                    if (match) {
                        versionInput.value = `${match[1]}.${match[2]}.${match[3]}`;
                    }
                }
            }
        } catch (e) {
            console.error('解析固件元数据失败:', e);
            this.firmwareMeta = null;
            this.renderFirmwareMeta(null);
        }
    },
    
    renderFirmwareMeta(meta) {
        let infoBox = document.getElementById('firmware-meta-box');
        if (!infoBox) {
            // 创建固件信息显示区
            const gitBox = document.getElementById('git-info-box');
            if (gitBox) {
                infoBox = document.createElement('div');
                infoBox.id = 'firmware-meta-box';
                infoBox.className = 'git-info-box';
                infoBox.style.marginTop = '12px';
                infoBox.style.borderColor = 'var(--accent-color)';
                gitBox.parentNode.insertBefore(infoBox, gitBox.nextSibling);
            }
        }
        
        if (!infoBox) return;
        
        if (!meta || meta.error) {
            infoBox.innerHTML = `
                <div class="info-row">
                    <span class="label">⚠️ 固件信息</span>
                    <span style="color:#f39c12">${meta?.error || '无法解析'}</span>
                </div>
            `;
            return;
        }
        
        if (meta.meta && meta.meta.valid) {
            const m = meta.meta;
            const cs = meta.checksum || {};
            infoBox.innerHTML = `
                <div class="info-row">
                    <span class="label">✅ 固件版本</span>
                    <span style="color:var(--accent-color);font-weight:600">${m.version}</span>
                </div>
                <div class="info-row">
                    <span class="label">型号</span>
                    <span>${m.model || '--'}</span>
                </div>
                <div class="info-row">
                    <span class="label">硬件版本</span>
                    <span>HW ${m.hw_version}</span>
                </div>
                <div class="info-row">
                    <span class="label">文件大小</span>
                    <span>${meta.size_str || '--'}</span>
                </div>
                ${cs.crc32 ? `
                <div class="info-row">
                    <span class="label">CRC32</span>
                    <span style="font-family:monospace;font-size:12px">${cs.crc32}</span>
                </div>
                <div class="info-row">
                    <span class="label">校验范围</span>
                    <span style="font-size:11px">${cs.flash_range || cs.range || '-'}</span>
                </div>
                ` : ''}
            `;
        } else {
            infoBox.innerHTML = `
                <div class="info-row">
                    <span class="label">⚠️ 固件信息</span>
                    <span style="color:#e67e22">未找到元数据 (旧版固件)</span>
                </div>
                <div class="info-row">
                    <span class="label">文件大小</span>
                    <span>${meta.size_str || '--'}</span>
                </div>
            `;
        }
    },
    
    async createVersion() {
        if (!this.currentProject) {
            alert('请先选择工程');
            return;
        }
        
        const version = document.getElementById('new-version').value.trim();
        const hexFile = document.getElementById('new-hex-file').value.trim();
        const releaseNote = document.getElementById('new-release-note').value.trim();
        
        if (!version) {
            alert('请输入版本号');
            return;
        }
        
        if (!hexFile) {
            alert('请选择HEX/BIN文件');
            return;
        }
        
        const result = await API.call('dev_create_version', 
            this.currentProject.id, version, hexFile, releaseNote);
        
        if (result.success) {
            alert('版本创建成功！');
            
            // 清空表单
            document.getElementById('new-version').value = '';
            document.getElementById('new-hex-file').value = '';
            document.getElementById('new-release-note').value = '';
            
            // 刷新列表
            await this.loadVersions();
            
            // 选中新版本
            this.selectVersion(result.version.id);
        } else {
            alert('创建失败: ' + (result.error || ''));
        }
    },
    
    async submitToTest(versionId) {
        if (!confirm('确定提交此版本到测试？')) return;
        
        const result = await API.call('dev_submit_to_test', versionId);
        
        if (result.success) {
            alert('已提交测试！');
            await this.loadVersions();
            this.selectVersion(versionId);
        } else {
            alert('提交失败: ' + (result.error || ''));
        }
    },
    
    async releaseToProduction(versionId) {
        alert('发布到生产功能开发中...');
    },

    async deleteVersion(versionId) {
        if (!confirm('确认删除该版本？删除后不可恢复。')) return;
        try {
            const result = await API.call('dev_delete_version', versionId);
            if (result.success) {
                alert('版本已删除');
                this.currentVersion = null;
                await this.loadVersions();
                this.renderVersionDetail();
            } else {
                alert('删除失败: ' + (result.error || '未知错误'));
            }
        } catch (e) {
            alert('删除失败: ' + e.message);
        }
    },
    
    // 共享文件相关
    currentShareData: null,
    currentSharePath: null,
    
    async createShareFile() {
        if (!this.currentVersion) {
            Utils.toast('请先选择版本', 'warning');
            return;
        }
        
        try {
            const result = await API.call('share_create_from_version', this.currentVersion.id);
            
            if (result.success) {
                this.currentShareData = result.share_data;
                
                // 显示分配区域
                document.getElementById('assignment-section').style.display = 'block';
                
                // 加载测试人员列表
                await this.loadTesters();
                
                // 保存文件
                const saveResult = await API.call('share_save_file', this.currentShareData);
                if (saveResult.success) {
                    this.currentSharePath = saveResult.path;
                    document.getElementById('btn-update-share').disabled = false;
                    document.getElementById('share-status').textContent = 
                        `已创建: ${this.currentSharePath.split('\\').pop()}`;
                    Utils.toast('共享文件创建成功', 'success');
                } else {
                    Utils.toast('保存失败: ' + saveResult.error, 'error');
                }
            } else {
                Utils.toast('创建失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async openShareFile() {
        try {
            const result = await API.call('share_load_file');
            
            if (result.success) {
                this.currentShareData = result.share_data;
                this.currentSharePath = result.path;
                
                // 验证版本匹配
                const manifest = this.currentShareData.manifest;
                if (this.currentVersion && manifest.version_id === this.currentVersion.id) {
                    document.getElementById('share-status').textContent = 
                        `已打开: ${result.path.split('\\').pop()} (版本匹配)`;
                } else {
                    document.getElementById('share-status').textContent = 
                        `已打开: ${result.path.split('\\').pop()} (⚠️ 版本不匹配)`;
                }
                
                document.getElementById('btn-update-share').disabled = false;
                Utils.toast('共享文件加载成功', 'success');
            } else {
                Utils.toast('加载失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async updateShareFile() {
        if (!this.currentShareData) {
            Utils.toast('请先创建或打开共享文件', 'warning');
            return;
        }
        
        if (!this.currentVersion) {
            Utils.toast('请先选择版本', 'warning');
            return;
        }
        
        try {
            // 更新共享文件的版本信息
            const result = await API.call('share_create_from_version', this.currentVersion.id);
            
            if (result.success) {
                // 保留原有的测试结果和数据
                const updatedData = result.share_data;
                updatedData.results = this.currentShareData.results;
                updatedData.data = this.currentShareData.data;
                updatedData.workflow = this.currentShareData.workflow;
                
                // 添加更新记录
                updatedData.workflow.history.push({
                    time: new Date().toISOString(),
                    user: 'unknown', // Browser environment cannot get username directly
                    action: 'updated',
                    notes: '更新版本信息'
                });
                
                this.currentShareData = updatedData;
                
                // 保存文件
                const saveResult = await API.call('share_save_file', this.currentShareData, this.currentSharePath);
                if (saveResult.success) {
                    document.getElementById('share-status').textContent = 
                        `已更新: ${saveResult.path.split('\\').pop()}`;
                    Utils.toast('共享文件更新成功', 'success');
                } else {
                    Utils.toast('保存失败: ' + saveResult.error, 'error');
                }
            } else {
                Utils.toast('更新失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    },
    
    async loadTesters() {
        try {
            const result = await API.call('user_get_testers');
            if (result.success) {
                const select = document.getElementById('assign-tester-select');
                select.innerHTML = '<option value="">选择测试人员</option>';
                result.testers.forEach(tester => {
                    select.innerHTML += `<option value="${tester.id}">${tester.name}</option>`;
                });
            }
        } catch (e) {
            console.error('加载测试人员失败:', e);
        }
    },
    
    async assignTask() {
        if (!this.currentShareData) {
            Utils.toast('请先创建共享文件', 'warning');
            return;
        }
        
        const assignedTo = document.getElementById('assign-tester-select').value;
        const dueDate = document.getElementById('assign-due-date').value;
        const priority = document.getElementById('assign-priority').value;
        
        if (!assignedTo) {
            Utils.toast('请选择测试人员', 'warning');
            return;
        }
        
        try {
            const result = await API.call('share_assign_task', 
                this.currentShareData, assignedTo, dueDate, priority);
            
            if (result.success) {
                this.currentShareData = result.share_data;
                
                // 保存文件
                const saveResult = await API.call('share_save_file', this.currentShareData, this.currentSharePath);
                if (saveResult.success) {
                    document.getElementById('share-status').textContent = 
                        `已分配并保存: ${saveResult.path.split('\\').pop()}`;
                    Utils.toast('任务分配成功', 'success');
                } else {
                    Utils.toast('保存失败: ' + saveResult.error, 'error');
                }
            } else {
                Utils.toast('分配失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('操作失败: ' + e.message, 'error');
        }
    }
};
