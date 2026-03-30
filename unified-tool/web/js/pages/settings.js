/**
 * 系统设置页面模块
 */

const SettingsPage = {
    settings: {},
    stationState: {
        currentStationId: null,
        stations: {},
        toolProfileId: null,
        toolProfile: null
    },
    
    async init() {
        await this.load();
        this.initUiFromSettings();
        await this.loadSystemInfo();
        await this.loadSerialPorts();
        await this.loadStations();
        await this.loadCompetitorProtocols();
    },
    
    destroy() {},
    
    async load() {
        try {
            this.settings = await API.settings.getAll();
            // settings.html 已经是静态结构，这里只做数据同步
            this.initUiFromSettings();
            
            // 加载各种配置
            await this.loadStations();
            await this.loadCompetitorProtocols();
            await this.loadUsers();
            await this.loadEmailConfig();
            await this.loadGitConfig();
            await this.loadSystemInfo();
        } catch (e) {
            console.error('加载设置失败:', e);
        }
    },

    // ========== 竞品协议库（本机） ==========

    _getCompetitorSelectedId() {
        const sel = document.getElementById('competitor-proto-select');
        return sel ? String(sel.value || '').trim() : '';
    },

    async loadCompetitorProtocols() {
        const sel = document.getElementById('competitor-proto-select');
        const ta = document.getElementById('competitor-proto-json');
        if (!sel || !ta) return; // 当前tab未加载

        try {
            const res = await API.settings.competitorProtoList();
            const items = (res && res.success) ? (res.items || []) : [];
            if (!items.length) {
                sel.innerHTML = `<option value="l1_ascii_default">l1_ascii_default (内置)</option>`;
            } else {
                sel.innerHTML = items.map(it => {
                    const id = it.id || '';
                    const kind = it.kind ? ` [${it.kind}]` : '';
                    const name = it.name ? ` - ${it.name}` : '';
                    return `<option value="${id}">${id}${kind}${name}</option>`;
                }).join('');
            }

            sel.onchange = async () => {
                await this.reloadCompetitorProto();
            };

            // 默认加载第一个
            if (!sel.value && items.length) sel.value = items[0].id;
            await this.reloadCompetitorProto();
        } catch (e) {
            console.error('加载竞品协议库失败:', e);
        }
    },

    async reloadCompetitorProto() {
        const id = this._getCompetitorSelectedId();
        const ta = document.getElementById('competitor-proto-json');
        if (!id || !ta) return;
        try {
            const res = await API.settings.competitorProtoGet(id);
            if (!res || !res.success) throw new Error(res?.message || '加载失败');
            const proto = res.proto || {};
            ta.value = JSON.stringify(proto, null, 2);
        } catch (e) {
            ta.value = `{\n  \"id\": \"${id}\",\n  \"name\": \"\",\n  \"kind\": \"custom_ascii\",\n  \"params\": {},\n  \"controls\": {}\n}`;
        }
    },

    async createCompetitorProto() {
        const sel = document.getElementById('competitor-proto-select');
        const ta = document.getElementById('competitor-proto-json');
        if (!sel || !ta) return;
        const protoId = prompt('请输入新协议ID（例如: comp_xx_v1）');
        if (!protoId) return;
        const id = String(protoId).trim();
        if (!id) return;

        const tpl = {
            id,
            name: id,
            kind: 'custom_ascii',
            params: {
                tx: '',
                timeout_ms: 400,
                send_cmd: true,
                dist_regex: 'D\\\\s*=\\\\s*(?P<v>\\\\d+(?:\\\\.\\\\d+)?)',
                dist_group: 'v',
                unit: 'm'
            },
            controls: {}
        };

        try {
            const res = await API.settings.competitorProtoSave(id, tpl);
            if (res && res.success) {
                Utils.toast('已创建', 'success');
                await this.loadCompetitorProtocols();
                sel.value = id;
                ta.value = JSON.stringify(tpl, null, 2);
            } else {
                Utils.toast(res?.message || '创建失败', 'error');
            }
        } catch (e) {
            Utils.toast('创建失败: ' + (e.message || e), 'error');
        }
    },

    async saveCompetitorProto() {
        const id = this._getCompetitorSelectedId();
        const ta = document.getElementById('competitor-proto-json');
        if (!id || !ta) return;
        try {
            const obj = JSON.parse(ta.value || '{}');
            const res = await API.settings.competitorProtoSave(id, obj);
            if (res && res.success) {
                Utils.toast('已保存', 'success');
                await this.loadCompetitorProtocols();
            } else {
                Utils.toast(res?.message || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + (e.message || e), 'error');
        }
    },

    async deleteCompetitorProto() {
        const sel = document.getElementById('competitor-proto-select');
        if (!sel) return;
        const id = this._getCompetitorSelectedId();
        if (!id) return;
        if (!await Utils.confirm(`确定删除竞品协议 "${id}" 吗？`)) return;
        try {
            const res = await API.settings.competitorProtoDelete(id);
            if (res && res.success) {
                Utils.toast('已删除', 'success');
                await this.loadCompetitorProtocols();
            } else {
                Utils.toast(res?.message || '删除失败', 'error');
            }
        } catch (e) {
            Utils.toast('删除失败: ' + (e.message || e), 'error');
        }
    },

    async loadStations() {
        const stationSel = document.getElementById('station-select');
        if (!stationSel) return; // 页面未加载到该tab

        try {
            const res = await API.settings.stationList();
            if (!res || !res.success) throw new Error(res?.message || '加载工位失败');

            this.stationState.currentStationId = res.current_station_id || null;
            this.stationState.stations = res.stations || {};

            const ids = Object.keys(this.stationState.stations);
            stationSel.innerHTML = ids.map(id => {
                const s = this.stationState.stations[id] || {};
                const label = s.name ? `${s.name}` : id;
                const selected = (id === this.stationState.currentStationId) ? 'selected' : '';
                return `<option value="${id}" ${selected}>${label}</option>`;
            }).join('');

            stationSel.onchange = async () => {
                const id = stationSel.value;
                const setRes = await API.settings.stationSetCurrent(id);
                if (setRes && setRes.success) {
                    this.stationState.currentStationId = id;
                    await this.loadToolProfileForCurrentStation();
                    Utils.toast(`已切换工位: ${id}`, 'success');
                } else {
                    Utils.toast(setRes?.message || '切换工位失败', 'error');
                }
            };

            await this.loadToolProfileForCurrentStation();
        } catch (e) {
            console.error('加载工位失败:', e);
            stationSel.innerHTML = '<option value="">(加载失败)</option>';
        }
    },

    async loadToolProfileForCurrentStation() {
        // 后端 tool_profile_get() 不传 profile_id 时，会根据当前工位返回绑定profile
        try {
            const res = await API.settings.toolProfileGet(null);
            if (!res || !res.success) throw new Error(res?.message || '加载工装配置失败');

            this.stationState.toolProfileId = res.profile_id;
            this.stationState.toolProfile = res.profile || {};

            const slipway = this.stationState.toolProfile.slipway || {};
            const ip = slipway.ip ?? '';
            const port = slipway.port ?? '';
            const timeout = slipway.timeout_ms ?? '';
            const retry = slipway.retry ?? '';

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = (val === undefined || val === null) ? '' : String(val);
            };

            setVal('tool-ip', ip);
            setVal('tool-port', port);
            setVal('tool-timeout', timeout);
            setVal('tool-retry', retry);
        } catch (e) {
            console.error('加载工装配置失败:', e);
        }
    },

    async createStation() {
        const idEl = document.getElementById('station-new-id');
        const stationId = (idEl?.value || '').trim();
        if (!stationId) return Utils.toast('请输入工位ID', 'warning');

        try {
            const res = await API.settings.stationCreate(stationId, stationId, 'tool_default');
            if (res && res.success) {
                if (idEl) idEl.value = '';
                Utils.toast('工位已创建', 'success');
                await this.loadStations();
                // 切到工位tab
                this.switchTab('station');
            } else {
                Utils.toast(res?.message || '创建失败', 'error');
            }
        } catch (e) {
            Utils.toast('创建失败: ' + (e.message || e), 'error');
        }
    },

    async deleteCurrentStation() {
        const stationId = this.stationState.currentStationId;
        if (!stationId) return;
        if (!await Utils.confirm(`确定删除工位 "${stationId}" 吗？`)) return;
        try {
            const res = await API.settings.stationDelete(stationId);
            if (res && res.success) {
                Utils.toast('工位已删除', 'success');
                await this.loadStations();
            } else {
                Utils.toast(res?.message || '删除失败', 'error');
            }
        } catch (e) {
            Utils.toast('删除失败: ' + (e.message || e), 'error');
        }
    },

    async saveToolProfile() {
        const profileId = this.stationState.toolProfileId;
        if (!profileId) return Utils.toast('未加载到工装配置', 'warning');

        const getVal = (id) => document.getElementById(id)?.value;
        const ip = (getVal('tool-ip') || '').trim();
        const port = parseInt(getVal('tool-port') || '0', 10);
        const timeoutMs = parseInt(getVal('tool-timeout') || '0', 10);
        const retry = parseInt(getVal('tool-retry') || '0', 10);

        if (!ip) return Utils.toast('控制器IP不能为空', 'warning');
        if (!port || port <= 0) return Utils.toast('端口无效', 'warning');

        const profile = this.stationState.toolProfile || {};
        profile.slipway = {
            ...(profile.slipway || {}),
            ip,
            port,
            timeout_ms: timeoutMs || 1500,
            retry: (retry || retry === 0) ? retry : 2
        };
        profile.rotary = {
            ...(profile.rotary || {}),
            // 默认跟随滑台同一控制器
            ip,
            port,
            timeout_ms: timeoutMs || 1500,
            retry: (retry || retry === 0) ? retry : 2
        };

        try {
            const res = await API.settings.toolProfileUpdate(profileId, profile);
            if (res && res.success) {
                Utils.toast('工装配置已保存（本机）', 'success');
                await this.loadToolProfileForCurrentStation();
            } else {
                Utils.toast(res?.message || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + (e.message || e), 'error');
        }
    },

    initUiFromSettings() {
        // 字体大小（兼容旧的 small/medium/large）
        const fontSize = this.settings.ui_font_size || localStorage.getItem('ui_font_size') || 'medium';
        this.applyFontSize(fontSize);

        // 字体缩放（新：滑块百分比）
        const scaleRange = document.getElementById('font-scale-range');
        const scaleLabel = document.getElementById('font-scale-label');
        const savedScale = this.settings.ui_font_scale || localStorage.getItem('ui_font_scale') || '100';
        const scale = parseInt(savedScale, 10);
        if (scaleRange) {
            scaleRange.value = String(Number.isFinite(scale) ? scale : 100);
        }
        if (scaleLabel) {
            scaleLabel.textContent = `${Number.isFinite(scale) ? scale : 100}%`;
        }
        this.applyFontScale(Number.isFinite(scale) ? scale : 100);

        // 字体主题（已默认化：不在界面暴露选择器时仍保持默认）
        const fontFamilySel = document.getElementById('font-family-select');
        const fontFamily = this.settings.ui_font_family || localStorage.getItem('ui_font_family') || 'default';
        this.applyFontFamily(fontFamily);
        if (fontFamilySel) {
            fontFamilySel.value = fontFamily;
        }

        // 减少动效
        const reduceMotionEl = document.getElementById('reduce-motion');
        const reduceMotion = !!(this.settings.reduce_motion ?? (localStorage.getItem('reduce_motion') === 'true'));
        if (reduceMotionEl) {
            reduceMotionEl.checked = reduceMotion;
            this.applyReduceMotion(reduceMotion);
        }

        // 波特率
        const baudSel = document.getElementById('baudrate-select');
        if (baudSel && this.settings.default_baudrate) {
            baudSel.value = String(this.settings.default_baudrate);
        }
    },

    // Tab 切换
    switchTab(tab) {
        document.querySelectorAll('.settings-tabs .tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tab}`);
        });
        
        // 切换到用户管理标签时加载用户列表
        if (tab === 'users') {
            this.loadUsers();
        }
        // 切换到邮件配置标签时加载配置
        if (tab === 'email') {
            this.loadEmailConfig();
        }
        // 切换到Git配置标签时加载配置
        if (tab === 'git') {
            this.loadGitConfig();
        }
        // 切换到系统信息标签时刷新内存状态
        if (tab === 'info') {
            this.refreshMemoryStatus();
        }
    },

    setSaveStatus(state, text) {
        const el = document.getElementById('save-status');
        if (!el) return;
        el.classList.remove('saving', 'saved');
        if (state) el.classList.add(state);
        el.textContent = text || '';
    },

    async save(key, value) {
        this.setSaveStatus('saving', '保存中...');
        try {
            await API.settings.set(key, value);
            this.settings[key] = value;
            this.setSaveStatus('saved', '已保存');
            setTimeout(() => this.setSaveStatus('', ''), 1200);
        } catch (e) {
            this.setSaveStatus('', '保存失败');
            Utils.toast('保存失败', 'error');
        }
    },

    applyFontSize(size) {
        // 仅做轻量缩放：避免动太多 CSS
        const map = {
            small: { sm: '11px', base: '12px', lg: '13px', xl: '15px' },
            medium: { sm: '12px', base: '13px', lg: '14px', xl: '16px' },
            large: { sm: '13px', base: '14px', lg: '15px', xl: '17px' },
        };
        const v = map[size] || map.medium;
        const root = document.documentElement;
        root.style.setProperty('--font-size-sm', v.sm);
        root.style.setProperty('--font-size-base', v.base);
        root.style.setProperty('--font-size-lg', v.lg);
        root.style.setProperty('--font-size-xl', v.xl);
    },

    applyFontScale(scalePercent) {
        const p = Math.max(70, Math.min(160, parseInt(scalePercent, 10) || 100));
        const root = document.documentElement;

        // 基于当前 CSS 变量做缩放（默认 aurora: 12/13/14/16）
        const base = {
            sm: 12,
            base: 13,
            lg: 14,
            xl: 16,
        };
        const s = p / 100;
        const px = (n) => `${Math.round(n * s)}px`;

        root.style.setProperty('--font-size-sm', px(base.sm));
        root.style.setProperty('--font-size-base', px(base.base));
        root.style.setProperty('--font-size-lg', px(base.lg));
        root.style.setProperty('--font-size-xl', px(base.xl));
    },

    onFontScaleInput(value) {
        const scaleLabel = document.getElementById('font-scale-label');
        if (scaleLabel) scaleLabel.textContent = `${value}%`;
        this.applyFontScale(value);
    },

    async setFontScale(value) {
        const v = String(parseInt(value, 10) || 100);
        localStorage.setItem('ui_font_scale', v);
        this.applyFontScale(v);
        await this.save('ui_font_scale', parseInt(v, 10));
    },

    applyFontFamily(family) {
        const root = document.documentElement;
        root.dataset.fontFamily = family || 'default';

        // 通过 CSS 变量统一控制
        const map = {
            'default': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif",
            'source-han': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif",
            'zcool': '"ZCOOL KuaiLe", "Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'lxgw': '"LXGW WenKai", "Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'system': '"Microsoft YaHei UI", "Segoe UI", "PingFang SC", "Hiragino Sans GB", Arial, sans-serif',
            'cn': "'Source Han Sans SC VF', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', system-ui, sans-serif",
            'mono': "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
        };
        
        // 设置两个CSS变量以确保兼容性
        const fontStack = map[family] || map.default;
        root.style.setProperty('--font-family-base', fontStack);
        root.style.setProperty('--font-ui', fontStack);
        
        // 强制刷新样式
        root.style.display = 'none';
        root.offsetHeight; // 触发重排
        root.style.display = '';
    },

    async setFontFamily(family) {
        localStorage.setItem('ui_font_family', family);
        this.applyFontFamily(family);
        await this.save('ui_font_family', family);
    },

    async setFontSize(size) {
        localStorage.setItem('ui_font_size', size);
        this.applyFontSize(size);
        await this.save('ui_font_size', size);
    },

    applyReduceMotion(enabled) {
        document.documentElement.dataset.reduceMotion = enabled ? '1' : '0';
    },

    async setReduceMotion(enabled) {
        localStorage.setItem('reduce_motion', enabled ? 'true' : 'false');
        this.applyReduceMotion(enabled);
        await this.save('reduce_motion', !!enabled);
    },

    async loadSerialPorts() {
        const sel = document.getElementById('default-port');
        if (!sel) return;

        try {
            // 复用 debug_api 的串口枚举
            const ports = await API.debug.getPorts();
            const current = this.settings.default_port || localStorage.getItem('default_port') || '';
            sel.innerHTML = ports.map(p => {
                const label = p.description ? `${p.device} (${p.description})` : p.device;
                const selected = current && current === p.device ? 'selected' : '';
                return `<option value="${p.device}" ${selected}>${label}</option>`;
            }).join('');

            sel.onchange = async () => {
                const v = sel.value;
                localStorage.setItem('default_port', v);
                await this.save('default_port', v);
            };
        } catch (e) {
            sel.innerHTML = '<option value="">(加载失败)</option>';
        }

        // 波特率保存
        const baudSel = document.getElementById('baudrate-select');
        if (baudSel) {
            baudSel.onchange = async () => {
                const v = parseInt(baudSel.value);
                await this.save('default_baudrate', v);
            };
        }
    },
    
        
    async loadSystemInfo() {
        try {
            const info = await API.settings.getSystemInfo();

            const setText = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.textContent = val ?? '-';
            };

            setText('app-version', `v${info.app_version || '2.0.0'}`);
            setText('python-version', (info.python_version || '').split(' ')[0] || '-');
            setText('work-dir', info.work_dir || '-');

            // uptime 暂无后端字段：占位
            if (document.getElementById('uptime')) {
                setText('uptime', '-');
            }
        } catch (e) {
            // 静态结构：不替换 DOM，只提示
            Utils.toast('系统信息加载失败', 'error');
        }
    },
    
    // ==================== 用户管理 ====================
    editingUserId: null,
    
    async loadUsers() {
        try {
            const result = await API.call('user_list');
            if (result.success) {
                this.renderUserList(result.users);
            } else {
                Utils.toast('加载用户列表失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('加载用户列表失败', 'error');
        }
    },
    
    renderUserList(users) {
        const container = document.getElementById('user-list');
        if (!container) return;
        
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无用户</div>';
            return;
        }
        
        const roleNames = {
            'developer': '开发人员',
            'tester': '测试人员',
            'manager': '管理人员'
        };
        
        container.innerHTML = users.map(user => `
            <div class="user-item">
                <div class="user-avatar">${user.name.charAt(0)}</div>
                <div class="user-info">
                    <div class="user-name">${user.name}</div>
                    <div class="user-role">${roleNames[user.role] || user.role} · ${user.department || '未设置部门'}</div>
                </div>
                <div class="user-actions">
                    <button onclick="SettingsPage.editUser('${user.id}')">编辑</button>
                    ${user.id !== 'admin' ? `<button class="danger" onclick="SettingsPage.deleteUser('${user.id}')">删除</button>` : ''}
                </div>
            </div>
        `).join('');
    },
    
    showAddUserDialog() {
        this.editingUserId = null;
        document.getElementById('user-dialog-title').textContent = '添加用户';
        document.getElementById('user-id-input').value = '';
        document.getElementById('user-name-input').value = '';
        document.getElementById('user-role-select').value = 'tester';
        document.getElementById('user-email-input').value = '';
        document.getElementById('user-dept-input').value = '';
        document.getElementById('user-id-input').disabled = false;
        document.getElementById('user-dialog').style.display = 'flex';
    },
    
    editUser(userId) {
        this.editingUserId = userId;
        API.call('user_get', userId).then(result => {
            if (result.success) {
                const user = result.user;
                document.getElementById('user-dialog-title').textContent = '编辑用户';
                document.getElementById('user-id-input').value = user.id;
                document.getElementById('user-name-input').value = user.name;
                document.getElementById('user-role-select').value = user.role;
                document.getElementById('user-email-input').value = user.email || '';
                document.getElementById('user-dept-input').value = user.department || '';
                document.getElementById('user-id-input').disabled = true;
                document.getElementById('user-dialog').style.display = 'flex';
            }
        });
    },
    
    hideUserDialog() {
        document.getElementById('user-dialog').style.display = 'none';
    },
    
    saveUser() {
        const userId = document.getElementById('user-id-input').value.trim();
        const name = document.getElementById('user-name-input').value.trim();
        const role = document.getElementById('user-role-select').value;
        const email = document.getElementById('user-email-input').value.trim();
        const department = document.getElementById('user-dept-input').value.trim();
        
        if (!userId || !name) {
            Utils.toast('请填写必填项', 'warning');
            return;
        }
        
        if (this.editingUserId) {
            // 更新用户
            API.call('user_update', userId, {
                name: name,
                role: role,
                email: email,
                department: department
            }).then(result => {
                if (result.success) {
                    Utils.toast('用户更新成功', 'success');
                    this.hideUserDialog();
                    this.loadUsers();
                } else {
                    Utils.toast('更新失败: ' + result.error, 'error');
                }
            });
        } else {
            // 添加用户
            API.call('user_add', userId, name, role, email, department).then(result => {
                if (result.success) {
                    Utils.toast('用户添加成功', 'success');
                    this.hideUserDialog();
                    this.loadUsers();
                } else {
                    Utils.toast('添加失败: ' + result.error, 'error');
                }
            });
        }
    },
    
    deleteUser(userId) {
        if (!confirm('确定删除该用户？')) return;
        
        API.call('user_delete', userId).then(result => {
            if (result.success) {
                Utils.toast('用户删除成功', 'success');
                this.loadUsers();
            } else {
                Utils.toast('删除失败: ' + result.error, 'error');
            }
        });
    },
    
    // ==================== 邮件配置 ====================
    
    async loadEmailConfig() {
        try {
            const result = await API.call('email_get_config');
            if (result && result.success) {
                const config = result.config || {};
                document.getElementById('email-enabled').checked = config.enabled || false;
                document.getElementById('email-smtp-server').value = config.smtp_server || '';
                document.getElementById('email-smtp-port').value = config.smtp_port || 587;
                document.getElementById('email-use-tls').checked = config.use_tls !== false;
                document.getElementById('email-username').value = config.username || '';
                document.getElementById('email-password').value = config.password || '';
                document.getElementById('email-sender-name').value = config.sender_name || 'GreenLaser任务系统';
            }
        } catch (e) {
            console.error('加载邮件配置失败:', e);
        }
    },
    
    onEmailConfigChange() {
        // 可选：标记配置已修改
    },
    
    async saveEmailConfig() {
        const config = {
            enabled: document.getElementById('email-enabled').checked,
            smtp_server: document.getElementById('email-smtp-server').value,
            smtp_port: parseInt(document.getElementById('email-smtp-port').value) || 587,
            use_tls: document.getElementById('email-use-tls').checked,
            username: document.getElementById('email-username').value,
            password: document.getElementById('email-password').value,
            sender_name: document.getElementById('email-sender-name').value,
            sender_email: document.getElementById('email-username').value
        };
        
        try {
            const result = await API.call('email_save_config', config);
            if (result && result.success) {
                Utils.toast('邮件配置已保存', 'success');
            } else {
                Utils.toast('保存失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e.message, 'error');
        }
    },
    
    async testEmailConnection() {
        Utils.toast('正在测试连接...', 'info');
        try {
            const result = await API.call('email_test_connection');
            if (result && result.success) {
                Utils.toast('SMTP连接成功！', 'success');
            } else {
                Utils.toast('连接失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            Utils.toast('测试失败: ' + e.message, 'error');
        }
    },
    
    // ==================== Git仓库配置 ====================
    
    async loadGitConfig() {
        try {
            const result = await API.call('git_remote_get_config');
            if (result && result.success && result.config) {
                const config = result.config;
                document.getElementById('git-enabled').checked = config.enabled || false;
                document.getElementById('git-remote-url').value = config.remote_url || '';
                document.getElementById('git-ssh-key').value = config.ssh_key_path || '';
            }
        } catch (e) {
            console.error('加载Git配置失败:', e);
        }
    },
    
    async saveGitConfig() {
        const config = {
            remote_url: document.getElementById('git-remote-url').value,
            ssh_key_path: document.getElementById('git-ssh-key').value,
            enabled: document.getElementById('git-enabled').checked
        };
        
        if (!config.remote_url) {
            Utils.toast('请输入远程仓库URL', 'error');
            return;
        }
        
        if (!config.ssh_key_path) {
            Utils.toast('请选择SSH私钥文件', 'error');
            return;
        }
        
        Utils.toast('正在保存Git配置...', 'info');
        
        try {
            const result = await API.call('git_remote_config', config.remote_url, config.ssh_key_path);
            if (result && result.success) {
                Utils.toast('Git配置已保存', 'success');
                config.enabled = true;
                document.getElementById('git-enabled').checked = true;
            } else {
                Utils.toast('保存失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e.message, 'error');
        }
    },
    
    async testGitConnection() {
        Utils.toast('正在测试Git连接...', 'info');
        try {
            const result = await API.call('git_remote_test_connection');
            if (result && result.success) {
                Utils.toast('Git连接成功！', 'success');
                Utils.toast(`本地仓库: ${result.local_path}`, 'info');
            } else {
                Utils.toast('连接失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            Utils.toast('测试失败: ' + e.message, 'error');
        }
    },
    
    async selectSshKey() {
        try {
            const result = await API.call('git_remote_select_ssh_key');
            if (result && result.success && result.path) {
                document.getElementById('git-ssh-key').value = result.path;
            } else if (result && result.error) {
                Utils.toast('选择文件失败: ' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('选择文件失败: ' + e.message, 'error');
        }
    },
    
    async startGitWebServer() {
        Utils.toast('正在启动Web服务器...', 'info');
        try {
            const result = await API.call('git_remote_start_web_server');
            if (result && result.success) {
                Utils.toast('Web服务器已启动', 'success');
                document.getElementById('git-web-url').textContent = result.url;
                document.getElementById('git-web-url').style.cursor = 'pointer';
                document.getElementById('git-web-url').onclick = () => {
                    window.open(result.url, '_blank');
                };
            } else {
                Utils.toast('启动失败: ' + (result?.error || '未知错误'), 'error');
            }
        } catch (e) {
            Utils.toast('启动失败: ' + e.message, 'error');
        }
    },
    
    // ========== 内存管理 ==========
    
    async refreshMemoryStatus() {
        try {
            const result = await API.call('get_memory_status');
            if (result && result.success) {
                const memEl = document.getElementById('memory-usage');
                const gcEl = document.getElementById('gc-status');
                
                if (memEl) {
                    const mb = result.memory_mb || 0;
                    const warningMb = result.config?.memory_warning_mb || 500;
                    const color = mb > warningMb ? '#ff6b6b' : '#84fab0';
                    memEl.innerHTML = `<span style="color:${color}">${mb.toFixed(1)} MB</span>`;
                }
                
                if (gcEl) {
                    gcEl.textContent = result.gc_running ? '运行中' : '已停止';
                }
                
                // 更新配置输入框
                const config = result.config || {};
                const setVal = (id, val) => {
                    const el = document.getElementById(id);
                    if (el && val !== undefined) el.value = val;
                };
                setVal('mem-max-log', config.max_log_entries);
                setVal('mem-serial-buffer', Math.round((config.max_serial_buffer || 65536) / 1024));
                setVal('mem-max-results', config.max_test_results);
                setVal('mem-gc-interval', config.gc_interval);
                setVal('mem-warning-mb', config.memory_warning_mb);
            }
        } catch (e) {
            console.error('获取内存状态失败:', e);
        }
    },
    
    async runGC() {
        Utils.toast('正在清理内存...', 'info');
        try {
            const result = await API.call('run_gc');
            if (result && result.success) {
                const freed = result.freed_mb || 0;
                Utils.toast(`内存清理完成，释放 ${freed.toFixed(1)} MB`, 'success');
                this.refreshMemoryStatus();
            } else {
                Utils.toast('清理失败: ' + (result?.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('清理失败: ' + e.message, 'error');
        }
    },
    
    async saveMemoryConfig() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? parseInt(el.value) : null;
        };
        
        const config = {
            max_log_entries: getVal('mem-max-log'),
            max_serial_buffer: (getVal('mem-serial-buffer') || 64) * 1024,  // KB -> bytes
            max_test_results: getVal('mem-max-results'),
            gc_interval: getVal('mem-gc-interval'),
            memory_warning_mb: getVal('mem-warning-mb'),
        };
        
        try {
            const result = await API.call('update_memory_config', config);
            if (result && result.success) {
                Utils.toast('内存配置已保存', 'success');
            } else {
                Utils.toast('保存失败: ' + (result?.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e.message, 'error');
        }
    }
};

window.SettingsPage = SettingsPage;
