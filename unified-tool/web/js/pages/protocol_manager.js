/**
 * 协议管理页面
 * 
 * 集成 DeviceConfigManager 统一设备配置管理
 */
window.ProtocolPage = {
    commands: [],
    workflows: [],
    deviceConfigs: [],
    currentMachine: 'gd_laser',
    currentConfig: null,
    editingCmd: null,
    editingWf: null,
    commandParams: { laser_on: { model: 0, direction: 0 }, calibrate_p1: { distance: 5000 }, calibrate_p2: { distance: 20000 }, calibrate_p3: { distance: 25000 }, slipway_p1_mm: 5000, slipway_p2_mm: 20000, slipway_p3_mm: 25000 },

    // 竞品协议库（Profile）
    competitorProfiles: [],
    currentCompetitorId: '',
    currentCompetitorProto: null,

    _autoSaveTimer: null,
    _useDeviceConfigManager: false,  // 是否使用新的设备配置管理器

    getTemplateWorkflows() {
        // GD303-80M 三点标定(联动): 10%反射率 + 5m/20m/25m
        return [
            {
                id: 'wf_gd303_80m_cal_3point_link',
                name: 'GD三点标定(联动)',
                icon: '',
                description: '5m=10%，20/25m=90% + 三点标定',
                params: {
                    p1_distance_mm: { type: 'number', default: 5000, label: '位置1距离(mm)' },
                    p2_distance_mm: { type: 'number', default: 20000, label: '位置2距离(mm)' },
                    p3_distance_mm: { type: 'number', default: 25000, label: '位置3距离(mm)' },
                    slipway_p1_mm: { type: 'number', default: 5000, label: '滑台位置1(mm)' },
                    slipway_p2_mm: { type: 'number', default: 20000, label: '滑台位置2(mm)' },
                    slipway_p3_mm: { type: 'number', default: 25000, label: '滑台位置3(mm)' },
                    p1_reflectivity_pct: { type: 'number', default: 10, label: '位置1反射率(%)' },
                    p2_reflectivity_pct: { type: 'number', default: 90, label: '位置2反射率(%)' },
                    delay_ms: { type: 'number', default: 800, label: '开光后延时(ms)' },
                },
                steps: [
                    { action: 'move_rotary', position: '10%', timeout: 30000 },
                    { action: 'command', cmd: 'laser_on', params: { model: 0, direction: 0 } },
                    { action: 'delay', ms: 800 },
                    { action: 'move_slipway', position: '${slipway_p1_mm}', timeout: 60000 },
                    { action: 'command', cmd: 'calibrate_p1', params: { distance: '${p1_distance_mm}' } },
                    { action: 'move_rotary', position: '90%', timeout: 30000 },
                    { action: 'move_slipway', position: '${slipway_p2_mm}', timeout: 90000 },
                    { action: 'command', cmd: 'calibrate_p2', params: { distance: '${p2_distance_mm}' } },
                    { action: 'move_slipway', position: '${slipway_p3_mm}', timeout: 90000 },
                    { action: 'command', cmd: 'calibrate_p3', params: { distance: '${p3_distance_mm}' } },
                    { action: 'command', cmd: 'laser_off', params: {} },
                    { action: 'notify', message: '三点标定完成（5m=10%，20/25m=90%）' }
                ]
            }
        ];
    },

    applyTemplates() {
        const templates = this.getTemplateWorkflows();
        if (!templates.length) return;
        const ok = confirm('将为当前型号创建/覆盖默认联动流程模板：\n- GD三点标定(联动)\n是否继续？');
        if (!ok) return;
        templates.forEach(t => {
            const idx = this.workflows.findIndex(w => (w.id || '') === t.id || (w.name || '') === t.name);
            if (idx >= 0) this.workflows[idx] = t;
            else this.workflows.unshift(t);
        });
        this.render();
        Utils.toast('模板已应用(未保存)，请点击右上角“保存”', 'success');
    },

    async init() {
        this.updateStatus('加载中...');
        
        // 尝试初始化 DeviceConfigManager
        await this.initDeviceManager();
        
        try {
            await this.loadDeviceConfigs();
            if (this.deviceConfigs.length > 0) {
                await this.switchMachine(this.currentMachine, {
                    fromDeviceManager: !!this._useDeviceConfigManager,
                    silentToast: true,
                });
            }
            this.render();
            await this.loadCompetitorProfiles();
            this.updateStatus(`已加载 ${this.commands.length} 个命令, ${this.deviceConfigs.length} 个机型`);
        } catch(e) {
            this.updateStatus('加载失败: ' + e);
        }
    },
    
    // 初始化设备管理器
    async initDeviceManager() {
        if (typeof DeviceConfigManager === 'undefined') {
            console.log('[ProtocolPage] DeviceConfigManager 不可用，使用旧API');
            this._useDeviceConfigManager = false;
            return;
        }
        
        try {
            await DeviceConfigManager.init();
            this._useDeviceConfigManager = true;
            
            // 订阅设备变更事件
            DeviceConfigManager.subscribe('device-changed', (e) => {
                if (e.newDevice !== this.currentMachine) {
                    this.switchMachine(e.newDevice, { fromDeviceManager: true, silentToast: true });
                }
            });
            
            // 订阅协议更新事件
            DeviceConfigManager.subscribe('protocols-updated', (e) => {
                if (e.deviceId === this.currentMachine) {
                    this.loadMachineConfig(this.currentMachine);
                }
            });
            
            console.log('[ProtocolPage] DeviceConfigManager 已初始化');
        } catch (e) {
            console.warn('[ProtocolPage] DeviceConfigManager 初始化失败:', e);
            this._useDeviceConfigManager = false;
        }
    },

    async loadDeviceConfigs() {
        try {
            const result = await API.deviceConfig.list();
            if (result && result.success && Array.isArray(result.configs)) {
                this.deviceConfigs = result.configs;
                const managerDevice = (this._useDeviceConfigManager && typeof DeviceConfigManager !== 'undefined')
                    ? DeviceConfigManager.getCurrentDevice()
                    : '';
                if (managerDevice && this.deviceConfigs.some(cfg => cfg.id === managerDevice)) {
                    this.currentMachine = managerDevice;
                } else if (!this.currentMachine || !this.deviceConfigs.some(cfg => cfg.id === this.currentMachine)) {
                    this.currentMachine = this.deviceConfigs.length > 0 ? this.deviceConfigs[0].id : '';
                }
                this.renderDeviceSelect();
            } else {
                console.error('[ProtocolPage] loadDeviceConfigs error:', result ? result.error : 'result is null');
            }
        } catch(e) {
            console.error('[ProtocolPage] loadDeviceConfigs exception:', e);
        }
    },

    renderDeviceSelect() {
        const select = document.getElementById('pm-machine-type');
        if (!select) return;
        select.innerHTML = '';
        this.deviceConfigs.forEach(cfg => {
            const opt = document.createElement('option');
            opt.value = cfg.id;
            opt.textContent = cfg.name;
            select.appendChild(opt);
        });
        const managerDevice = (this._useDeviceConfigManager && typeof DeviceConfigManager !== 'undefined')
            ? DeviceConfigManager.getCurrentDevice()
            : '';
        const selectedMachine = (managerDevice && this.deviceConfigs.some(cfg => cfg.id === managerDevice))
            ? managerDevice
            : (this.deviceConfigs.some(cfg => cfg.id === this.currentMachine) ? this.currentMachine : (this.deviceConfigs[0]?.id || ''));
        this.currentMachine = selectedMachine || '';
        if (selectedMachine) select.value = selectedMachine;
        // 双击编辑设备名称
        select.ondblclick = () => this.editDeviceName();
    },

    async editDeviceName() {
        const cfg = this.deviceConfigs.find(c => c.id === this.currentMachine);
        if (!cfg) return;
        
        const newName = prompt('编辑设备名称:', cfg.name);
        if (!newName || newName === cfg.name) return;
        
        Utils.toast('正在保存...', 'info');
        try {
            const res = await API.deviceConfig.rename(this.currentMachine, newName);
            if (res.success) {
                Utils.toast('名称已更新', 'success');
                await this.loadDeviceConfigs();
                const select = document.getElementById('pm-machine-type');
                if (select) select.value = this.currentMachine;
            } else {
                Utils.toast('更新失败: ' + (res.error || ''), 'error');
            }
        } catch(e) {
            Utils.toast('更新异常: ' + e, 'error');
        }
    },
    
    updateStatus(text) {
        const el = document.getElementById('pm-cmd-status');
        if (el) el.textContent = text;
    },

    async loadMachineConfig(machineId) {
        // 从后端加载该机型的完整配置
        try {
            const result = await API.deviceConfig.get(machineId);
            if (result.success && result.config) {
                const cfg = result.config;
                this.currentConfig = cfg;
                this.commands = cfg.commands || [];
                this.workflows = cfg.workflows || [];
                this.commandParams = cfg.params || {};
                this.defaultWorkflow = cfg.default_workflow || '';
                this.loadParamsToUI();
                this.render();
            } else {
                console.error('loadMachineConfig error:', result.error);
                this.commands = [];
                this.workflows = [];
                this.defaultWorkflow = '';
            }
        } catch(e) {
            console.error('loadMachineConfig error:', e);
            this.commands = [];
            this.workflows = [];
            this.defaultWorkflow = '';
        }
    },

    loadParamsToUI() {
        const p = this.commandParams;
        const el1 = document.getElementById('pm-laser-model');
        const el2 = document.getElementById('pm-laser-dir');
        const el3 = document.getElementById('pm-cal-p1');
        const el4 = document.getElementById('pm-cal-p2');
        const el5 = document.getElementById('pm-cal-p3');
        const s1 = document.getElementById('pm-slipway-p1');
        const s2 = document.getElementById('pm-slipway-p2');
        const s3 = document.getElementById('pm-slipway-p3');
        if (el1) el1.value = p.laser_on?.model || 0;
        if (el2) el2.value = p.laser_on?.direction || 0;
        if (el3) el3.value = p.calibrate_p1?.distance || 5000;
        if (el4) el4.value = p.calibrate_p2?.distance || 20000;
        if (el5) el5.value = p.calibrate_p3?.distance || 25000;
        if (s1) s1.value = p.slipway_p1_mm ?? 5000;
        if (s2) s2.value = p.slipway_p2_mm ?? 20000;
        if (s3) s3.value = p.slipway_p3_mm ?? 25000;
    },

    async switchMachine(machineId, options = {}) {
        const { fromDeviceManager = false, silentToast = false } = options || {};
        if (!machineId) return;

        if (!fromDeviceManager && this._useDeviceConfigManager && typeof DeviceConfigManager !== 'undefined') {
            const current = DeviceConfigManager.getCurrentDevice();
            if (current !== machineId) {
                await DeviceConfigManager.setCurrentDevice(machineId);
                return;
            }
        }

        this.currentMachine = machineId;
        const select = document.getElementById('pm-machine-type');
        if (select) select.value = machineId;
        this.updateStatus('加载配置...');
        if (!this._useDeviceConfigManager && !fromDeviceManager) {
            try {
                await API.deviceConfig.activate(machineId);
            } catch (e) {
                console.warn('[ProtocolPage] activate failed:', e);
            }
        }
        await this.loadMachineConfig(machineId);
        const cfg = this.deviceConfigs.find(c => c.id === machineId);
        if (!silentToast) {
            Utils.toast('已切换到: ' + (cfg?.name || machineId), 'info');
        }
        this.updateStatus(`已加载 ${this.commands.length} 个命令, ${this.workflows.length} 个流程；当前全局机型=${machineId}`);
    },

    async addMachine() {
        const name = prompt('输入新设备类型名称 (如: GD303-80M):');
        if (!name) return;
        const id = name.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
        
        // 选择是否从模板复制
        const fromTemplate = confirm('是否从模板复制默认配置？\n(推荐：会包含常用命令和流程)');
        
        Utils.toast('正在创建设备配置...', 'info');
        try {
            const res = await API.deviceConfig.create(id, name, fromTemplate ? '_template' : null);
            if (res.success) {
                Utils.toast(`设备 ${name} 创建成功`, 'success');
                await this.loadDeviceConfigs();
                await this.switchMachine(id);
            } else {
                Utils.toast('创建失败: ' + (res.error || ''), 'error');
            }
        } catch(e) {
            Utils.toast('创建异常: ' + e, 'error');
        }
    },

    async deleteMachine() {
        if (!this.currentMachine) return;
        const cfg = this.deviceConfigs.find(c => c.id === this.currentMachine);
        if (!confirm(`确定删除机型配置 "${cfg?.name || this.currentMachine}" 吗？\n此操作不可恢复！`)) return;
        
        Utils.toast('正在删除...', 'info');
        try {
            const res = await API.deviceConfig.delete(this.currentMachine);
            if (res.success) {
                Utils.toast('已删除', 'success');
                await this.loadDeviceConfigs();
                if (this.deviceConfigs.length > 0) {
                    await this.switchMachine(this.deviceConfigs[0].id);
                }
            } else {
                Utils.toast('删除失败: ' + (res.error || ''), 'error');
            }
        } catch(e) {
            Utils.toast('删除异常: ' + e, 'error');
        }
    },

    switchTab(tab) {
        document.querySelectorAll('.pm-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.pm-content').forEach(c => c.classList.remove('active'));
        document.getElementById('pm-tab-' + tab)?.classList.add('active');
        
        // 切换到UI测试标签页时自动加载命令
        if (tab === 'uitest' && Object.keys(this.uitestCmds || {}).length === 0) {
            this.refreshUITestCmds();
        }

        if (tab === 'competitor') {
            this.loadCompetitorProfiles();
        }
    },

    // ==================== 竞品协议库（Profile） ====================

    _setCompStatus(text) {
        const el = document.getElementById('pm-comp-status');
        if (el) el.textContent = text || '';
    },

    async loadCompetitorProfiles() {
        const sel = document.getElementById('pm-comp-select');
        const ta = document.getElementById('pm-comp-json');
        if (!sel || !ta) return;

        try {
            this._setCompStatus('加载中...');
            const res = await API.settings.competitorProtoList();
            const items = (res && res.success) ? (res.items || []) : [];
            this.competitorProfiles = items;

            sel.innerHTML = items.map(it => {
                const id = it.id || '';
                const kind = it.kind ? ` [${it.kind}]` : '';
                const name = it.name ? ` - ${it.name}` : '';
                return `<option value="${id}">${id}${kind}${name}</option>`;
            }).join('');

            if (!sel.value) {
                if (this.currentCompetitorId) sel.value = this.currentCompetitorId;
                else if (items.length) sel.value = items[0].id;
            }

            this.currentCompetitorId = String(sel.value || '').trim();
            if (!this.currentCompetitorId && items.length) {
                this.currentCompetitorId = items[0].id;
                sel.value = this.currentCompetitorId;
            }

            if (this.currentCompetitorId) {
                await this.compSwitch(this.currentCompetitorId, true);
                this._setCompStatus(`已加载 ${items.length} 个Profile`);
            } else {
                ta.value = '';
                this.currentCompetitorProto = null;
                this._renderCompControls();
                this._setCompStatus('暂无Profile');
            }
        } catch (e) {
            console.error('[ProtocolPage] loadCompetitorProfiles failed:', e);
            this._setCompStatus('加载失败');
        }
    },

    async compSwitch(id, silent = false) {
        const sel = document.getElementById('pm-comp-select');
        const ta = document.getElementById('pm-comp-json');
        const resultEl = document.getElementById('pm-comp-measure-result');
        if (!ta) return;
        const protoId = String(id || (sel ? sel.value : '') || '').trim();
        if (!protoId) return;

        this.currentCompetitorId = protoId;
        if (sel) sel.value = protoId;
        if (resultEl) resultEl.textContent = '--';

        try {
            const res = await API.settings.competitorProtoGet(protoId);
            if (!res || !res.success) throw new Error(res?.message || '加载失败');
            this.currentCompetitorProto = res.proto || null;
            ta.value = JSON.stringify(this.currentCompetitorProto || {}, null, 2);
            this._renderCompControls();
            if (!silent) Utils.toast(`已加载Profile: ${protoId}`, 'success', 900);
        } catch (e) {
            console.warn('[ProtocolPage] compSwitch failed:', e);
            this.currentCompetitorProto = null;
            ta.value = `{\n  \"id\": \"${protoId}\",\n  \"name\": \"${protoId}\",\n  \"kind\": \"custom_ascii\",\n  \"params\": {},\n  \"controls\": {}\n}`;
            this._renderCompControls();
            if (!silent) Utils.toast('加载失败: ' + (e.message || e), 'error');
        }
    },

    async compReload() {
        await this.loadCompetitorProfiles();
    },

    async compCreate() {
        const id = prompt('请输入新Profile ID（例如: comp_xx_v1）');
        if (!id) return;
        const protoId = String(id).trim();
        if (!protoId) return;

        const tpl = {
            id: protoId,
            name: protoId,
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
            const res = await API.settings.competitorProtoSave(protoId, tpl);
            if (res && res.success) {
                Utils.toast('已创建', 'success');
                await this.loadCompetitorProfiles();
                await this.compSwitch(protoId, true);
            } else {
                Utils.toast(res?.message || '创建失败', 'error');
            }
        } catch (e) {
            Utils.toast('创建失败: ' + (e.message || e), 'error');
        }
    },

    async compDelete() {
        const id = this.currentCompetitorId;
        if (!id) return Utils.toast('未选择Profile', 'warning');
        const ok = await Utils.confirm(`确定删除竞品Profile "${id}" 吗？`);
        if (!ok) return;
        try {
            const res = await API.settings.competitorProtoDelete(id);
            if (res && res.success) {
                Utils.toast('已删除', 'success');
                this.currentCompetitorId = '';
                this.currentCompetitorProto = null;
                await this.loadCompetitorProfiles();
            } else {
                Utils.toast(res?.message || '删除失败', 'error');
            }
        } catch (e) {
            Utils.toast('删除失败: ' + (e.message || e), 'error');
        }
    },

    _readCompJson() {
        const ta = document.getElementById('pm-comp-json');
        if (!ta) return null;
        try {
            const obj = JSON.parse(ta.value || '{}');
            if (!obj || typeof obj !== 'object') return null;
            return obj;
        } catch (e) {
            Utils.toast('JSON 解析失败: ' + (e.message || e), 'error');
            return null;
        }
    },

    async compSave() {
        const id = this.currentCompetitorId;
        if (!id) return Utils.toast('未选择Profile', 'warning');
        const obj = this._readCompJson();
        if (!obj) return;

        try {
            const res = await API.settings.competitorProtoSave(id, obj);
            if (res && res.success) {
                Utils.toast('已保存', 'success');
                await this.loadCompetitorProfiles();
                await this.compSwitch(id, true);
            } else {
                Utils.toast(res?.message || '保存失败', 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + (e.message || e), 'error');
        }
    },

    async compApplyToStation() {
        const id = this.currentCompetitorId;
        if (!id) return Utils.toast('未选择Profile', 'warning');
        try {
            const profileRes = await API.settings.toolProfileGet(null);
            if (!profileRes || !profileRes.success) {
                return Utils.toast('未配置工位/工装参数，请到 系统设置-工位管理 配置', 'warning');
            }
            const profileId = profileRes.profile_id;
            const profile = profileRes.profile || {};
            profile.measure = { type: 'competitor_profile', profile_id: id };
            const saveRes = await API.settings.toolProfileUpdate(profileId, profile);
            if (saveRes && saveRes.success) {
                Utils.toast(`已绑定到当前工位测距: ${id}`, 'success');
            } else {
                Utils.toast('绑定失败: ' + (saveRes?.message || ''), 'error');
            }
        } catch (e) {
            Utils.toast('绑定异常: ' + (e.message || e), 'error');
        }
    },

    async compMeasureOnce() {
        const id = this.currentCompetitorId;
        const out = document.getElementById('pm-comp-measure-result');
        const setOut = (s) => { if (out) out.textContent = String(s || '--'); };
        if (!id) return Utils.toast('未选择Profile', 'warning');

        try {
            setOut('测距中...');
            const res = await API.slipway.measureOnce({ type: 'competitor_profile', profile_id: id });
            if (!res || !res.success) {
                setOut('FAIL: ' + (res?.error || '调用失败'));
                return;
            }
            const r = res.result || {};
            if (r.success) {
                const mm = Number(r.distance);
                const ms = Number(r.time_ms);
                const mt = r.measure_type || 'profile';
                const mmText = Number.isFinite(mm) ? mm.toFixed(3) : String(r.distance);
                const msText = Number.isFinite(ms) ? String(Math.round(ms)) : String(r.time_ms || '--');
                setOut(`OK[${mt}] ${mmText}mm ${msText}ms`);
            } else {
                setOut(`FAIL: ${r.error || '测距失败'}`);
            }
        } catch (e) {
            setOut('异常: ' + (e.message || e));
        }
    },

    async compSend() {
        const inp = document.getElementById('pm-comp-send');
        const s = inp ? String(inp.value || '').trim() : '';
        if (!s) return Utils.toast('请输入命令', 'warning');
        return this._compSendAscii(s);
    },

    async _compSendAscii(cmd) {
        const s = String(cmd || '').trim();
        if (!s) return;
        if (!window.DeviceHub || !DeviceHub.isSerialConnected()) {
            return Utils.toast('串口未连接', 'warning');
        }
        let payload = s;
        if (!payload.endsWith('\n')) payload += '\r\n';
        const r = await API.debug.send(payload, false);
        if (r && r.success) Utils.toast(`已发送: ${s}`, 'success', 800);
        else Utils.toast('发送失败: ' + (r?.message || ''), 'error');
    },

    _renderCompControls() {
        const box = document.getElementById('pm-comp-controls');
        if (!box) return;
        const proto = this._readCompJson() || this.currentCompetitorProto || {};
        const controls = (proto && typeof proto === 'object') ? (proto.controls || {}) : {};

        const labelMap = {
            laser_on: '开激光',
            laser_off: '关激光',
            halt: '停止输出',
            get_proto: '查询协议',
            set_ascii: '切ASCII',
            set_modbus: '切Modbus',
            set_hex: '切HEX',
        };

        const entries = Object.entries(controls || {}).filter(([k, v]) => k && v);
        if (!entries.length) {
            box.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">(无 controls，可在JSON里添加 controls 字段)</div>';
            return;
        }

        box.innerHTML = entries.map(([k, v]) => {
            const key = String(k);
            const text = labelMap[key] || key;
            const cmd = (typeof v === 'string') ? v : '';
            const arg = JSON.stringify(cmd);
            return `<button class="cyber-btn sm" onclick="ProtocolPage._compSendAscii(${arg})">${text}</button>`;
        }).join('');
    },

    render() {
        this.renderCmdList();
        this.renderWfList();
    },

    renderCmdList() {
        const el = document.getElementById('pm-cmd-list');
        if (!el) return;
        el.innerHTML = this.commands.map((cmd, i) => `
            <div class="pm-item" onclick="ProtocolPage.editCommand(${i})">
                <span class="icon">${cmd.icon || '📌'}</span>
                <div class="info"><div class="name">${cmd.name}</div><div class="meta">${(cmd.send_params||[]).length} 个参数</div></div>
                <span class="code">0x${cmd.code}</span>
            </div>
        `).join('') || '<div style="color:var(--text-muted);padding:40px;text-align:center">暂无命令，点击上方按钮添加</div>';
    },

    renderWfList() {
        const el = document.getElementById('pm-wf-list');
        if (!el) return;
        const defWf = this.defaultWorkflow || '';
        el.innerHTML = this.workflows.map((wf, i) => `
            <div class="pm-item ${wf.id === defWf ? 'is-default' : ''}">
                <span class="icon" onclick="ProtocolPage.editWorkflow(${i})">${wf.icon || '📋'}</span>
                <div class="info" onclick="ProtocolPage.editWorkflow(${i})">
                    <div class="name">${wf.name} ${wf.id === defWf ? '<span class="default-badge">默认</span>' : ''}</div>
                    <div class="meta">${wf.description || ''}</div>
                </div>
                <button class="cyber-btn sm ${wf.id === defWf ? 'primary' : ''}" onclick="event.stopPropagation();ProtocolPage.setDefaultWorkflow('${wf.id}')" title="设为默认流程">
                    ${wf.id === defWf ? '✓ 默认' : '设为默认'}
                </button>
            </div>
        `).join('') || '<div style="color:var(--text-muted);padding:40px;text-align:center">暂无流程，点击上方按钮添加</div>';
    },
    
    async setDefaultWorkflow(wfId) {
        this.defaultWorkflow = wfId;
        if (this.currentConfig) this.currentConfig.default_workflow = wfId;
        this.renderWfList();
        Utils.toast(`已设置默认流程: ${this.workflows.find(w => w.id === wfId)?.name || wfId}`, 'success');
    },

    // 命令编辑
    addCommand() {
        this.editingCmd = { id: 'cmd_' + Date.now(), name: '', code: '', icon: '📌', timeout: 500, retry: 3, send_params: [], recv_params: [] };
        this.showCmdModal('新增命令', true);
    },

    editCommand(idx) {
        this.editingCmd = JSON.parse(JSON.stringify(this.commands[idx]));
        this.editingCmd._index = idx;
        this.showCmdModal('编辑命令', false);
    },

    showCmdModal(title, isNew) {
        document.getElementById('pm-cmd-title').textContent = title;
        document.getElementById('pm-cmd-name').value = this.editingCmd.name || '';
        document.getElementById('pm-cmd-code').value = this.editingCmd.code || '';
        document.getElementById('pm-cmd-icon').value = this.editingCmd.icon || '📌';
        document.getElementById('pm-cmd-timeout').value = this.editingCmd.timeout || 500;
        document.getElementById('pm-cmd-retry').value = this.editingCmd.retry || 3;
        document.getElementById('pm-cmd-delete').style.display = isNew ? 'none' : '';
        this.renderSendParams();
        this.renderRecvParams();
        document.getElementById('pm-cmd-modal').style.display = 'flex';
        // 自动刷新命令预览
        setTimeout(() => {
            this.refreshCmdPreview();
            // 清空解析输入
            const rxInput = document.getElementById('pm-preview-rx-input');
            const rxResult = document.getElementById('pm-preview-rx-result');
            if (rxInput) rxInput.value = '';
            if (rxResult) rxResult.innerHTML = '';
        }, 100);
    },

    closeCmdEdit() { document.getElementById('pm-cmd-modal').style.display = 'none'; },

    renderSendParams() {
        const el = document.getElementById('pm-send-params');
        const params = this.editingCmd?.send_params || [];
        // 计算每个参数的字节位置（从数据区开始，帧头AA EE cmd之后）
        let byteOffset = 0;
        el.innerHTML = '<div class="row header"><span>字节</span><span>参数名</span><span>类型</span><span>显示名</span><span>默认值</span><span></span></div>' +
            params.map((p, i) => {
                const size = this.getTypeSize(p.type);
                const pos = byteOffset;
                byteOffset += size;
                return `<div class="row">
                <span class="byte-pos" title="数据区第${pos}字节">[${pos}]</span>
                <input value="${p.name||''}" onchange="ProtocolPage.updateSendParam(${i},'name',this.value)">
                <select onchange="ProtocolPage.updateSendParam(${i},'type',this.value)">
                    <option value="uint8" ${p.type==='uint8'?'selected':''}>uint8 (1B)</option>
                    <option value="int8" ${p.type==='int8'?'selected':''}>int8 (1B)</option>
                    <option value="uint16" ${p.type==='uint16'?'selected':''}>uint16 (2B)</option>
                    <option value="uint16_be" ${p.type==='uint16_be'?'selected':''}>uint16_be (2B)</option>
                    <option value="uint32" ${p.type==='uint32'?'selected':''}>uint32 (4B)</option>
                    <option value="uint32_be" ${p.type==='uint32_be'?'selected':''}>uint32_be (4B)</option>
                </select>
                <input value="${p.label||''}" onchange="ProtocolPage.updateSendParam(${i},'label',this.value)">
                <input type="number" value="${p.default||0}" onchange="ProtocolPage.updateSendParam(${i},'default',this.value)">
                <button class="cyber-btn sm" onclick="ProtocolPage.removeSendParam(${i})">🗑️</button>
            </div>`}).join('');
    },

    renderRecvParams() {
        const el = document.getElementById('pm-recv-params');
        const params = this.editingCmd?.recv_params || [];
        // 计算每个参数的字节位置（从数据区开始，帧头AA FE cmd之后）
        let byteOffset = 0;
        el.innerHTML = '<div class="row header"><span>字节</span><span>参数名</span><span>类型</span><span>显示名</span><span>单位</span><span></span></div>' +
            params.map((p, i) => {
                const size = this.getTypeSize(p.type);
                const pos = byteOffset;
                byteOffset += size;
                return `<div class="row">
                <span class="byte-pos" title="数据区第${pos}字节">[${pos}]</span>
                <input value="${p.name||''}" onchange="ProtocolPage.updateRecvParam(${i},'name',this.value)">
                <select onchange="ProtocolPage.updateRecvParam(${i},'type',this.value)">
                    <option value="uint8" ${p.type==='uint8'?'selected':''}>uint8 (1B)</option>
                    <option value="int8" ${p.type==='int8'?'selected':''}>int8 (1B)</option>
                    <option value="uint16" ${p.type==='uint16'?'selected':''}>uint16 (2B)</option>
                    <option value="uint16_be" ${p.type==='uint16_be'?'selected':''}>uint16_be (2B)</option>
                    <option value="int16_be" ${p.type==='int16_be'?'selected':''}>int16_be (2B)</option>
                    <option value="uint32" ${p.type==='uint32'?'selected':''}>uint32 (4B)</option>
                    <option value="uint32_be" ${p.type==='uint32_be'?'selected':''}>uint32_be (4B)</option>
                    <option value="int32_be" ${p.type==='int32_be'?'selected':''}>int32_be (4B)</option>
                </select>
                <input value="${p.label||''}" onchange="ProtocolPage.updateRecvParam(${i},'label',this.value)">
                <input value="${p.unit||''}" onchange="ProtocolPage.updateRecvParam(${i},'unit',this.value)">
                <button class="cyber-btn sm" onclick="ProtocolPage.removeRecvParam(${i})">🗑️</button>
            </div>`}).join('');
    },
    
    getTypeSize(type) {
        if (!type) return 1;
        if (type.includes('32')) return 4;
        if (type.includes('16')) return 2;
        return 1;
    },

    addSendParam() { this.editingCmd.send_params.push({name:'',type:'uint8',label:'',default:0}); this.renderSendParams(); },
    removeSendParam(i) { this.editingCmd.send_params.splice(i,1); this.renderSendParams(); },
    updateSendParam(i,k,v) { this.editingCmd.send_params[i][k] = v; },
    addRecvParam() { this.editingCmd.recv_params.push({name:'',type:'uint8',label:'',unit:''}); this.renderRecvParams(); },
    removeRecvParam(i) { this.editingCmd.recv_params.splice(i,1); this.renderRecvParams(); },
    updateRecvParam(i,k,v) { this.editingCmd.recv_params[i][k] = v; },

    // 命令预览功能
    async refreshCmdPreview() {
        const txEl = document.getElementById('pm-preview-tx');
        const lenEl = document.getElementById('pm-preview-len');
        const rxInput = document.getElementById('pm-preview-rx-input');
        if (!txEl || !lenEl) return;
        
        // 收集当前编辑的命令信息
        const code = document.getElementById('pm-cmd-code')?.value || 'F0';
        const sendParams = this.editingCmd?.send_params || [];
        const recvParams = this.editingCmd?.recv_params || [];
        
        // 构建参数对象
        const params = {};
        sendParams.forEach(p => {
            params[p.name] = p.default || 0;
        });
        
        try {
            // 调用后端API构建帧
            const result = await API.calibration.buildFrame(this.editingCmd?.id || 'preview', params);
            if (result.success) {
                txEl.textContent = result.frame || '--';
                lenEl.textContent = `${result.length || 0} 字节`;
            } else {
                const frame = this.buildFrameLocal(code, sendParams);
                txEl.textContent = frame;
                lenEl.textContent = `${frame.split(' ').length} 字节`;
            }
        } catch (e) {
            const frame = this.buildFrameLocal(code, sendParams);
            txEl.textContent = frame;
            lenEl.textContent = `${frame.split(' ').length} 字节`;
        }
        
        // 检查响应类型
        const responseType = this.editingCmd?.response_type;
        const exampleResponse = this.editingCmd?.example_response;
        
        if (responseType === 'text') {
            // 文本响应类型 - 直接显示文本示例
            if (rxInput) {
                // 优先使用配置的example_response
                if (exampleResponse) {
                    // 将\r\n转换为实际换行显示
                    rxInput.value = exampleResponse.replace(/\\r\\n/g, '\r\n');
                } else {
                    // 自动生成示例
                    const cmdCode = code.toLowerCase();
                    let exampleText = `${cmdCode}.s\r\n`;
                    recvParams.forEach(p => {
                        const name = p.name;
                        let value = 'VALUE';
                        if (name.toLowerCase().includes('state')) value = 'IDLE';
                        else if (name.toLowerCase().includes('mode')) value = 'SINGLE';
                        else if (name.toLowerCase().includes('laser')) value = 'OFF';
                        else if (name.toLowerCase().includes('error')) value = '0';
                        else if (name.toLowerCase().includes('step')) value = '0';
                        else if (name.toLowerCase().includes('line')) value = '0.000';
                        else if (name.toLowerCase().includes('base')) value = 'BACK';
                        exampleText += `${name}: ${value}\r\n`;
                    });
                    exampleText += `${cmdCode}.e\r\n`;
                    rxInput.value = exampleText;
                }
                this.parsePreviewResponse();
            }
        } else if (responseType === 'json') {
            // JSON响应类型
            if (rxInput) {
                if (exampleResponse) {
                    rxInput.value = this.textToHex(exampleResponse.replace(/\\r\\n/g, '\r\n'));
                } else {
                    const exampleJson = '{"cmd":"example","status":0}\r\n';
                    rxInput.value = this.textToHex(exampleJson);
                }
                this.parsePreviewResponse();
            }
        } else if (rxInput && recvParams.length > 0) {
            // 二进制响应，自动生成示例
            const exampleRx = this.buildExampleResponse(code, recvParams);
            rxInput.value = exampleRx;
            this.parsePreviewResponse();
        }
    },
    
    // 文本转HEX
    textToHex(text) {
        return text.split('').map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    },
    
    // 生成示例响应帧 (二进制格式: AA FE cmd [data...] xor BB FF)
    buildExampleResponse(code, recvParams) {
        const bytes = [];
        bytes.push(0xAA);  // header
        bytes.push(0xFE);  // direction (recv)
        bytes.push(parseInt(code, 16) || 0xF0);  // cmd (echo)
        
        // 为每个接收参数生成示例值
        recvParams.forEach((p, idx) => {
            const type = p.type || 'uint8';
            // 生成有意义的示例值
            let val = 0;
            if (p.name === 'error') val = 0;  // error通常是0表示成功
            else if (p.name === 'state') val = 1;  // 状态示例
            else if (p.name === 'mode') val = 0;  // 模式示例
            else if (p.name === 'runstep') val = 2;  // 步骤示例
            else if (p.name.includes('distance')) val = 5000;  // 距离示例5000mm
            else if (p.name.includes('version')) val = 0x0102;  // 版本号示例
            else if (p.name.includes('crc')) val = 0x12345678;  // CRC示例
            else if (p.name.includes('id')) val = 0xABCD1234;  // ID示例
            else if (type.includes('32')) val = 12345678;
            else if (type.includes('16')) val = 1234;
            else val = idx;  // 其他用索引
            
            if (type === 'uint8' || type === 'int8') {
                bytes.push(val & 0xFF);
            } else if (type.includes('16')) {
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            } else if (type.includes('32')) {
                bytes.push((val >> 24) & 0xFF);
                bytes.push((val >> 16) & 0xFF);
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            }
        });
        
        // XOR校验 (从FE开始到数据结束)
        let xor = 0;
        for (let i = 1; i < bytes.length; i++) xor ^= bytes[i];
        bytes.push(xor);
        
        bytes.push(0xBB);  // footer
        bytes.push(0xFF);
        
        return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    },
    
    // 本地模拟构建帧 (AA EE cmd data... checksum BB FF)
    buildFrameLocal(code, sendParams) {
        const bytes = [];
        bytes.push(0xAA);  // header
        bytes.push(0xEE);  // direction (send)
        bytes.push(parseInt(code, 16) || 0xF0);  // cmd
        
        // 添加参数数据
        sendParams.forEach(p => {
            const val = p.default || 0;
            const type = p.type || 'uint8';
            if (type === 'uint8' || type === 'int8') {
                bytes.push(val & 0xFF);
            } else if (type === 'uint16' || type === 'int16') {
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            } else if (type === 'uint16_be' || type === 'int16_be') {
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            } else if (type === 'uint32' || type === 'int32') {
                bytes.push((val >> 24) & 0xFF);
                bytes.push((val >> 16) & 0xFF);
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            } else if (type === 'uint32_be' || type === 'int32_be') {
                bytes.push((val >> 24) & 0xFF);
                bytes.push((val >> 16) & 0xFF);
                bytes.push((val >> 8) & 0xFF);
                bytes.push(val & 0xFF);
            }
        });
        
        // XOR校验
        let xor = 0;
        for (let i = 1; i < bytes.length; i++) xor ^= bytes[i];
        bytes.push(xor);
        
        bytes.push(0xBB);  // footer
        bytes.push(0xFF);
        
        return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    },
    
    // 解析响应演示
    parsePreviewResponse() {
        const input = document.getElementById('pm-preview-rx-input');
        const resultEl = document.getElementById('pm-preview-rx-result');
        if (!input || !resultEl) return;
        
        const inputValue = input.value.trim();
        if (!inputValue) {
            resultEl.innerHTML = '<div class="error">请输入响应数据</div>';
            return;
        }
        
        // 检查响应类型
        const responseType = this.editingCmd?.response_type;
        const recvParams = this.editingCmd?.recv_params || [];
        const code = this.editingCmd?.code?.toLowerCase() || 'xx';
        
        // === 文本响应 (直接解析文本，不是HEX) ===
        if (responseType === 'text') {
            try {
                const text = inputValue;
                const startTag = `${code}.s`;
                const endTag = `${code}.e`;
                
                // 查找开始和结束标记
                const startIdx = text.indexOf(startTag);
                const endIdx = text.indexOf(endTag);
                
                let content = text;
                let hasFrame = false;
                if (startIdx >= 0 && endIdx > startIdx) {
                    content = text.substring(startIdx + startTag.length, endIdx);
                    hasFrame = true;
                }
                
                // 按换行或分号分割
                const lines = content.split(/[\r\n;]+/).filter(l => l.includes(':'));
                
                let html = `<div class="frame-info">文本响应 ${hasFrame ? `(${startTag}...${endTag})` : '(无帧标记)'}</div>`;
                
                // 解析每行 Key: Value
                const parsed = {};
                lines.forEach(line => {
                    const colonIdx = line.indexOf(':');
                    if (colonIdx > 0) {
                        const key = line.substring(0, colonIdx).trim();
                        const value = line.substring(colonIdx + 1).trim();
                        parsed[key] = value;
                    }
                });
                
                // 按recv_params定义的顺序显示
                if (recvParams.length > 0) {
                    recvParams.forEach(p => {
                        const key = p.name;
                        const value = parsed[key];
                        const label = p.label || key;
                        if (value !== undefined) {
                            // 检查枚举值
                            let displayValue = value;
                            if (p.enum && p.enum[value]) {
                                displayValue = `${value} (${p.enum[value]})`;
                            }
                            html += `<div class="field">
                                <span class="byte-info">📝</span>
                                <span class="name">${label}</span>
                                <span class="raw">${key}</span>
                                <span class="value">${displayValue}</span>
                            </div>`;
                        }
                    });
                } else {
                    // 没有定义recv_params，显示所有解析到的字段
                    Object.entries(parsed).forEach(([key, value]) => {
                        html += `<div class="field">
                            <span class="byte-info">📝</span>
                            <span class="name">${key}</span>
                            <span class="raw"></span>
                            <span class="value">${value}</span>
                        </div>`;
                    });
                }
                
                resultEl.innerHTML = html || '<div class="error">未解析到有效字段</div>';
            } catch (e) {
                resultEl.innerHTML = `<div class="error">文本解析失败: ${e.message}</div>`;
            }
            return;
        }
        
        // === JSON响应或二进制响应 (需要HEX输入) ===
        const hexStr = inputValue.replace(/\s+/g, '');
        if (!/^[0-9A-Fa-f]+$/.test(hexStr)) {
            resultEl.innerHTML = '<div class="error">请输入有效的HEX数据</div>';
            return;
        }
        
        // === JSON响应 ===
        if (responseType === 'json') {
            try {
                const text = this.hexToText(hexStr);
                const jsonStart = text.indexOf('{');
                const jsonEnd = text.lastIndexOf('}');
                if (jsonStart >= 0 && jsonEnd > jsonStart) {
                    const jsonStr = text.substring(jsonStart, jsonEnd + 1);
                    const obj = JSON.parse(jsonStr);
                    resultEl.innerHTML = `<div class="frame-info">JSON响应</div><pre style="color:var(--accent);font-size:12px;margin:8px 0;white-space:pre-wrap">${JSON.stringify(obj, null, 2)}</pre>`;
                } else {
                    resultEl.innerHTML = `<div class="frame-info">原始文本</div><pre style="color:var(--text-muted);font-size:12px">${text}</pre>`;
                }
            } catch (e) {
                resultEl.innerHTML = `<div class="error">JSON解析失败: ${e.message}</div>`;
            }
            return;
        }
        
        // === 二进制响应 ===
        try {
            // 解析HEX字符串为字节数组
            const bytes = [];
            for (let i = 0; i < hexStr.length; i += 2) {
                bytes.push(parseInt(hexStr.substr(i, 2), 16));
            }
            
            if (recvParams.length === 0) {
                resultEl.innerHTML = '<div class="error">未定义接收参数</div>';
                return;
            }
            
            // 检测帧头和帧尾，计算数据区范围
            let dataStart = 0;
            let dataEnd = bytes.length;
            let frameInfo = '';
            
            // 检测帧头 AA FE
            if (bytes[0] === 0xAA && bytes[1] === 0xFE) {
                dataStart = 3;  // AA FE cmd 之后
                frameInfo = `帧头: AA FE ${bytes[2]?.toString(16).toUpperCase().padStart(2,'0') || '??'}`;
            } else if (bytes[0] === 0xAA) {
                dataStart = 2;
                frameInfo = `帧头: AA ${bytes[1]?.toString(16).toUpperCase().padStart(2,'0') || '??'}`;
            }
            
            // 检测帧尾 BB FF 和校验和
            if (bytes.length >= 2 && bytes[bytes.length - 2] === 0xBB && bytes[bytes.length - 1] === 0xFF) {
                dataEnd = bytes.length - 3;  // 排除 [xor] BB FF
                frameInfo += ` | 帧尾: [XOR] BB FF`;
            }
            
            frameInfo = `<div class="frame-info">${frameInfo || '无标准帧格式'} | 数据区: [${dataStart}] ~ [${dataEnd - 1}]</div>`;
            
            let html = frameInfo;
            let offset = dataStart;
            let dataOffset = 0;  // 数据区内的偏移
            
            recvParams.forEach(p => {
                if (offset >= dataEnd) return;  // 不要超过数据区
                
                const type = p.type || 'uint8';
                let value = 0;
                let size = 1;
                
                if (type === 'uint8' || type === 'int8') {
                    value = bytes[offset];
                    size = 1;
                } else if (type === 'uint16' || type === 'uint16_be') {
                    value = (bytes[offset] << 8) | bytes[offset + 1];
                    size = 2;
                } else if (type === 'int16' || type === 'int16_be') {
                    value = (bytes[offset] << 8) | bytes[offset + 1];
                    if (value > 32767) value -= 65536;
                    size = 2;
                } else if (type === 'uint32' || type === 'uint32_be') {
                    value = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
                    size = 4;
                } else if (type === 'int32' || type === 'int32_be') {
                    value = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
                    if (value > 2147483647) value -= 4294967296;
                    size = 4;
                }
                
                // 提取原始HEX字节
                const rawBytes = bytes.slice(offset, offset + size).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                
                // 枚举值显示
                const label = p.label || p.name;
                const unit = p.unit || '';
                let displayValue = value;
                if (p.enum && p.enum[value] !== undefined) {
                    displayValue = `${value} (${p.enum[value]})`;
                }
                
                html += `<div class="field">
                    <span class="byte-info">[${dataOffset}]</span>
                    <span class="name">${label}</span>
                    <span class="raw">${rawBytes}</span>
                    <span class="value">${displayValue}${unit ? ' ' + unit : ''}</span>
                </div>`;
                offset += size;
                dataOffset += size;
            });
            
            resultEl.innerHTML = html || '<div class="error">无解析结果</div>';
        } catch (e) {
            resultEl.innerHTML = `<div class="error">解析错误: ${e.message}</div>`;
        }
    },
    
    // HEX字符串转文本
    hexToText(hexStr) {
        let text = '';
        for (let i = 0; i < hexStr.length; i += 2) {
            const byte = parseInt(hexStr.substr(i, 2), 16);
            if (byte >= 32 && byte < 127) {
                text += String.fromCharCode(byte);
            } else if (byte === 10 || byte === 13) {
                text += '\n';
            }
        }
        return text;
    },

    saveCmdEdit() {
        this.editingCmd.name = document.getElementById('pm-cmd-name').value;
        this.editingCmd.code = document.getElementById('pm-cmd-code').value;
        this.editingCmd.icon = document.getElementById('pm-cmd-icon').value;
        this.editingCmd.timeout = parseInt(document.getElementById('pm-cmd-timeout').value);
        this.editingCmd.retry = parseInt(document.getElementById('pm-cmd-retry').value);
        
        // 如果是UI测试命令，调用专门的保存方法
        if (this.editingCmd._isUITest) {
            this.saveUITestCommand();
            return;
        }
        
        if (this.editingCmd._index !== undefined) {
            this.commands[this.editingCmd._index] = this.editingCmd;
        } else {
            this.commands.push(this.editingCmd);
        }
        this.closeCmdEdit();
        this.render();
        Utils.toast('命令已保存', 'success');
    },

    deleteCommand() {
        // 如果是UI测试命令，调用专门的删除方法
        if (this.editingCmd._isUITest) {
            this.deleteUITestCommand();
            return;
        }
        
        if (this.editingCmd._index !== undefined) {
            this.commands.splice(this.editingCmd._index, 1);
            this.closeCmdEdit();
            this.render();
            Utils.toast('命令已删除', 'success');
        }
    },

    // 流程编辑
    addWorkflow() {
        this.editingWf = { id: 'wf_' + Date.now(), name: '', icon: '🎯', description: '', steps: [] };
        this.showWfModal('新增流程', true);
    },

    editWorkflow(idx) {
        this.editingWf = JSON.parse(JSON.stringify(this.workflows[idx]));
        this.editingWf._index = idx;
        this.showWfModal('编辑流程', false);
    },

    showWfModal(title, isNew) {
        document.getElementById('pm-wf-title').textContent = title;
        document.getElementById('pm-wf-name').value = this.editingWf.name || '';
        document.getElementById('pm-wf-icon').value = this.editingWf.icon || '🎯';
        document.getElementById('pm-wf-desc').value = this.editingWf.description || '';
        document.getElementById('pm-wf-delete').style.display = isNew ? 'none' : '';
        this.renderWfSteps();
        document.getElementById('pm-wf-modal').style.display = 'flex';

        // 标题/描述改动也自动保存
        try {
            const nameEl = document.getElementById('pm-wf-name');
            const iconEl = document.getElementById('pm-wf-icon');
            const descEl = document.getElementById('pm-wf-desc');
            const bind = (el, k) => {
                if (!el || el._pmBound) return;
                el._pmBound = true;
                el.addEventListener('input', () => {
                    if (!this.editingWf) return;
                    this.editingWf[k] = el.value;
                    this._scheduleWorkflowAutoSave();
                });
                el.addEventListener('change', () => {
                    if (!this.editingWf) return;
                    this.editingWf[k] = el.value;
                    this._scheduleWorkflowAutoSave();
                });
            };
            bind(nameEl, 'name');
            bind(iconEl, 'icon');
            bind(descEl, 'description');
        } catch (e) {}
    },

    closeWfEdit() { document.getElementById('pm-wf-modal').style.display = 'none'; },

    // 可用动作列表
    actionTypes: [
        { id: 'command', name: '发送命令', icon: '📡' },
        { id: 'move_slipway', name: '滑台移动', icon: '🛤️' },
        { id: 'move_rotary', name: '转靶切换', icon: '🎯' },
        { id: 'wait_slipway_done', name: '等滑台到位', icon: '⏳' },
        { id: 'delay', name: '延时', icon: '⏱️' },
        { id: 'notify', name: '通知', icon: '📢' },
        { id: 'wait_confirm', name: '等待确认', icon: '✋' }
    ],

    renderWfSteps() {
        const el = document.getElementById('pm-wf-steps');
        const steps = this.editingWf?.steps || [];
        el.innerHTML = steps.map((s, i) => {
            const action = s.action || 'command';
            const paramHtml = this.getStepParamHtml(s, i);
            return `<div class="pm-step" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px">
                <span style="min-width:24px">${i+1}.</span>
                <select style="width:120px" onchange="ProtocolPage.updateWfStep(${i},'action',this.value)">
                    ${this.actionTypes.map(a => `<option value="${a.id}" ${action===a.id?'selected':''}>${a.icon} ${a.name}</option>`).join('')}
                </select>
                ${paramHtml}
                <button class="cyber-btn sm" onclick="ProtocolPage.insertWfStep(${i})" title="在此步骤后插入">➕</button>
                <button class="cyber-btn sm" onclick="ProtocolPage.moveWfStepUp(${i})" title="上移" ${i===0?'disabled':''}>⬆️</button>
                <button class="cyber-btn sm" onclick="ProtocolPage.moveWfStepDown(${i})" title="下移" ${i===steps.length-1?'disabled':''}>⬇️</button>
                <button class="cyber-btn sm" onclick="ProtocolPage.removeWfStep(${i})" title="删除">🗑️</button>
            </div>`;
        }).join('') || '<div style="padding:20px;text-align:center;color:var(--text-muted)">暂无步骤，点击下方按钮添加</div>';
    },

    getStepParamHtml(step, i) {
        const action = step.action || 'command';
        switch(action) {
            case 'command': {
                const cmdId = step.cmd || '';
                const pointNum = this._cmdToPoint(cmdId);
                let distVal = '';
                if (pointNum && this.commandParams) {
                    const pk = `calibrate_p${pointNum}`;
                    distVal = this.commandParams[pk]?.distance ?? '';
                } else {
                    distVal = step.params?.distance ?? '';
                }
                const paramsJson = pointNum ? `{"distance":${distVal||0}}` : JSON.stringify(step.params||{});
                return `<select style="flex:1" onchange="ProtocolPage.updateWfStep(${i},'cmd',this.value)">
                    ${this.commands.map(c => `<option value="${c.id}" ${step.cmd===c.id?'selected':''}>${c.name}</option>`).join('')}
                </select>
                <input style="width:100px" placeholder="参数JSON" value='${paramsJson}' onchange="ProtocolPage.updateWfStep(${i},'params',this.value)">`;
            }
            case 'move_slipway': {
                // 滑台位置独立，不与标定距离联动
                const posVal = step.position;
                return `<input type="number" style="width:100px" placeholder="位置(mm)" value="${posVal||5000}" onchange="ProtocolPage.updateWfStep(${i},'position',this.value)">
                <span>mm</span>`;
            }
            case 'move_rotary':
                return `<select style="width:100px" onchange="ProtocolPage.updateWfStep(${i},'position',this.value)">
                    <option value="10%" ${step.position==='10%'?'selected':''}>10%</option>
                    <option value="20%" ${step.position==='20%'?'selected':''}>20%</option>
                    <option value="30%" ${step.position==='30%'?'selected':''}>30%</option>
                    <option value="40%" ${step.position==='40%'?'selected':''}>40%</option>
                    <option value="50%" ${step.position==='50%'?'selected':''}>50%</option>
                    <option value="60%" ${step.position==='60%'?'selected':''}>60%</option>
                    <option value="70%" ${step.position==='70%'?'selected':''}>70%</option>
                    <option value="90%" ${step.position==='90%'?'selected':''}>90%</option>
                </select>`;
            case 'wait_slipway_done':
                return `<input type="number" style="width:80px" placeholder="超时(ms)" value="${step.timeout||60000}" onchange="ProtocolPage.updateWfStep(${i},'timeout',this.value)">
                <span>ms</span>`;
            case 'delay':
                return `<input type="number" style="width:80px" placeholder="时长(ms)" value="${step.ms||1000}" onchange="ProtocolPage.updateWfStep(${i},'ms',this.value)">
                <span>ms</span>`;
            case 'notify':
            case 'wait_confirm':
                return `<input style="flex:1" placeholder="消息内容" value="${step.message||''}" onchange="ProtocolPage.updateWfStep(${i},'message',this.value)">`;
            default:
                return `<input style="flex:1" placeholder="参数" value='${JSON.stringify(step)}'>`;
        }
    },

    addWfStep() { 
        if (!this.editingWf) this.editingWf = { steps: [] };
        if (!this.editingWf.steps) this.editingWf.steps = [];
        this.editingWf.steps.push({ action: 'command', cmd: this.commands[0]?.id || '', params: {} }); 
        this.renderWfSteps(); 
        this._scheduleWorkflowAutoSave();
    },
    
    insertWfStep(afterIndex) {
        // 在指定步骤之后插入新步骤
        if (!this.editingWf) this.editingWf = { steps: [] };
        if (!this.editingWf.steps) this.editingWf.steps = [];
        const newStep = { action: 'command', cmd: this.commands[0]?.id || '', params: {} };
        this.editingWf.steps.splice(afterIndex + 1, 0, newStep);
        this.renderWfSteps();
        this._scheduleWorkflowAutoSave();
        Utils.toast(`已在步骤 ${afterIndex + 1} 后插入新步骤`, 'success');
    },
    
    moveWfStepUp(index) {
        // 上移步骤
        if (index <= 0) return;
        const steps = this.editingWf?.steps;
        if (!steps || steps.length < 2) return;
        [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
        this.renderWfSteps();
        this._scheduleWorkflowAutoSave();
    },
    
    moveWfStepDown(index) {
        // 下移步骤
        const steps = this.editingWf?.steps;
        if (!steps || index >= steps.length - 1) return;
        [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
        this.renderWfSteps();
        this._scheduleWorkflowAutoSave();
    },
    
    removeWfStep(i) { this.editingWf.steps.splice(i,1); this.renderWfSteps(); this._scheduleWorkflowAutoSave(); },
    syncParamToSteps(pointNum, value) {
        const pk = `calibrate_p${pointNum}`;
        if (!this.commandParams[pk]) this.commandParams[pk] = {};
        this.commandParams[pk].distance = parseInt(value) || 0;

        // 如果正在编辑流程，刷新步骤显示
        if (this.editingWf) {
            this.renderWfSteps();
        }
        this._scheduleWorkflowAutoSave();
    },
    syncSlipwayParamToSteps(pointNum, value) {
        const v = parseInt(value) || 0;
        this.commandParams[`slipway_p${pointNum}_mm`] = v;
        if (this.editingWf) {
            this.renderWfSteps();
        }
        this._scheduleWorkflowAutoSave();
    },
    _cmdToPoint(cmd) {
        const c = String(cmd || '').toLowerCase();
        if (c.includes('calibrate_p1') || c.includes('标定位置1')) return 1;
        if (c.includes('calibrate_p2') || c.includes('标定位置2')) return 2;
        if (c.includes('calibrate_p3') || c.includes('标定位置3')) return 3;
        return null;
    },

    _findLinkedPoint(slipwayIdx) {
        const steps = this.editingWf?.steps || [];
        for (let j = slipwayIdx + 1; j < steps.length && j <= slipwayIdx + 5; j++) {
            const s = steps[j];
            if ((s?.action || '') === 'command') {
                const p = this._cmdToPoint(s.cmd);
                if (p) return p;
            }
        }
        return null;
    },

    updateWfStep(i, k, v) { 
        if (k === 'params') { try { v = JSON.parse(v); } catch(e) { v = {}; } }
        if (k === 'position' && !isNaN(v)) v = parseInt(v);
        if (k === 'timeout' || k === 'ms') v = parseInt(v);
        if (k === 'action') {
            this.editingWf.steps[i] = { action: v };
            this.renderWfSteps();
            this._scheduleWorkflowAutoSave();
            return;
        }
        this.editingWf.steps[i][k] = v;

        // 双向同步：步骤改了distance → 同步到参数面板（仅限command的distance，move_slipway.position独立）
        const step = this.editingWf.steps[i];
        if (k === 'params' && v?.distance !== undefined) {
            const p = this._cmdToPoint(step.cmd);
            if (p && this.commandParams) {
                const pk = `calibrate_p${p}`;
                if (!this.commandParams[pk]) this.commandParams[pk] = {};
                this.commandParams[pk].distance = parseInt(v.distance) || 0;
            }
        }

        this._scheduleWorkflowAutoSave();
    },

    _ensureEditingWorkflowInList() {
        if (!this.editingWf) return;
        if (this.editingWf._index !== undefined) return;
        const wf = this.editingWf;
        if (!wf.id) wf.id = 'wf_' + Date.now();
        this.workflows.push(wf);
        wf._index = this.workflows.length - 1;
        // 新建时允许删除
        try {
            const del = document.getElementById('pm-wf-delete');
            if (del) del.style.display = '';
        } catch (e) {}
    },

    _scheduleWorkflowAutoSave() {
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            this._autoSaveTimer = null;
            this._autoSaveWorkflowNow();
        }, 450);
    },

    async _autoSaveWorkflowNow() {
        try {
            if (!this.editingWf) return;
            this._ensureEditingWorkflowInList();
            try { this.bindDistanceParams(); } catch (e) {}

            // 把editingWf回写到列表（确保最新）
            if (this.editingWf._index !== undefined) {
                this.workflows[this.editingWf._index] = this.editingWf;
            }

            const configData = {
                name: this.currentMachine,
                model_pattern: this.currentConfig?.model_pattern || '',
                version: this.currentConfig?.version || '1.0',
                frame_format: this.currentConfig?.frame_format || {},
                commands: this.commands,
                workflows: this.workflows,
                params: this.commandParams,
                default_workflow: this.defaultWorkflow || ''
            };
            console.log('[PM] 自动保存配置到', this.currentMachine, 'params:', this.commandParams);
            const res = await API.deviceConfig.save(this.currentMachine, configData);
            if (!res || res.success !== true) {
                console.error('[PM] 自动保存失败:', res?.error);
                this.updateStatus('自动保存失败: ' + (res?.error || ''));
                return;
            }
            console.log('[PM] 自动保存成功');
            this.updateStatus('已自动保存');
            // 更新列表（避免外部看到的还是旧内容）
            this.renderWfList();
        } catch (e) {
            this.updateStatus('自动保存异常: ' + (e?.message || e));
        }
    },

    saveWfEdit() {
        this.editingWf.name = document.getElementById('pm-wf-name').value;
        this.editingWf.icon = document.getElementById('pm-wf-icon').value;
        this.editingWf.description = document.getElementById('pm-wf-desc').value;

        try {
            this.bindDistanceParams();
        } catch (e) {}
        if (this.editingWf._index !== undefined) {
            this.workflows[this.editingWf._index] = this.editingWf;
        } else {
            this.workflows.push(this.editingWf);
        }
        this.closeWfEdit();
        this.render();
        Utils.toast('流程已保存', 'success');
    },

    deleteWorkflow() {
        if (this.editingWf._index !== undefined) {
            this.workflows.splice(this.editingWf._index, 1);
            this.closeWfEdit();
            this.render();
            Utils.toast('流程已删除', 'success');
        }
    },

    bindDistanceParams() {
        const wf = this.editingWf;
        if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) {
            Utils.toast('暂无步骤可绑定', 'warning');
            return;
        }

        const defs = (wf.params && typeof wf.params === 'object') ? wf.params : {};
        const pickKey = (cands) => {
            for (const k of cands) {
                if (Object.prototype.hasOwnProperty.call(defs, k)) return k;
            }
            return cands[0];
        };
        const k1 = pickKey(['p1_distance_mm', 'p1_distance', 'point1', 'distance1']);
        const k2 = pickKey(['p2_distance_mm', 'p2_distance', 'point2', 'distance2']);
        const k3 = pickKey(['p3_distance_mm', 'p3_distance', 'point3', 'distance3']);

        const keys = { 1: k1, 2: k2, 3: k3 };
        const cmdToPoint = (cmd) => {
            const c = String(cmd || '').toLowerCase();
            if (c.includes('calibrate_p1')) return 1;
            if (c.includes('calibrate_p2')) return 2;
            if (c.includes('calibrate_p3')) return 3;
            return null;
        };

        const cmdIdx = {};
        for (let i = 0; i < wf.steps.length; i++) {
            const s = wf.steps[i] || {};
            if ((s?.action || '') !== 'command') continue;
            const p = cmdToPoint(s.cmd);
            if (p) cmdIdx[p] = i;
        }

        let changed = 0;
        const bindPoint = (p) => {
            const idx = cmdIdx[p];
            const key = keys[p];
            if (idx === undefined || !key) return;

            const step = wf.steps[idx];
            if (!step.params || typeof step.params !== 'object') step.params = {};
            step.params.distance = '${' + key + '}';
            changed++;
            // 注意：move_slipway.position 不再与标定距离绑定，两者独立
        };

        bindPoint(1);
        bindPoint(2);
        bindPoint(3);

        this.renderWfSteps();
        Utils.toast(changed ? `已绑定 ${changed} 处参数` : '未找到可绑定的标定步骤', changed ? 'success' : 'warning');
    },

    // 保存/导入/导出
    async saveAllConfig() {
        // 收集快捷参数
        this.commandParams.laser_on = { model: parseInt(document.getElementById('pm-laser-model').value), direction: parseInt(document.getElementById('pm-laser-dir').value) };
        this.commandParams.calibrate_p1 = { distance: parseInt(document.getElementById('pm-cal-p1').value) };
        this.commandParams.calibrate_p2 = { distance: parseInt(document.getElementById('pm-cal-p2').value) };
        this.commandParams.calibrate_p3 = { distance: parseInt(document.getElementById('pm-cal-p3').value) };
        // 滑台位置（独立参数）
        const s1 = document.getElementById('pm-slipway-p1');
        const s2 = document.getElementById('pm-slipway-p2');
        const s3 = document.getElementById('pm-slipway-p3');
        if (s1) this.commandParams.slipway_p1_mm = parseInt(s1.value) || 0;
        if (s2) this.commandParams.slipway_p2_mm = parseInt(s2.value) || 0;
        if (s3) this.commandParams.slipway_p3_mm = parseInt(s3.value) || 0;
        
        // 保存整个机型配置到后端文件
        const configData = {
            name: this.currentConfig?.name || this.currentMachine,
            model_pattern: this.currentConfig?.model_pattern || `^${this.currentMachine}$`,
            version: this.currentConfig?.version || '1.0',
            frame_format: this.currentConfig?.frame_format || {},
            commands: this.commands,
            workflows: this.workflows,
            params: this.commandParams,
            default_workflow: this.defaultWorkflow || ''
        };
        
        Utils.toast('正在保存...', 'info');
        try {
            const res = await API.deviceConfig.save(this.currentMachine, configData);
            if (res.success) {
                Utils.toast('配置已保存', 'success');
            } else {
                Utils.toast('保存失败: ' + (res.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('保存失败: ' + e, 'error');
        }
    },

    exportConfig() {
        const cfg = { machine: this.currentMachine, commands: this.commands, workflows: this.workflows, params: this.commandParams };
        const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'protocol_' + this.currentMachine + '.json'; a.click();
        Utils.toast('已导出', 'success');
    },

    importConfig() {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0]; if (!file) return;
            try {
                const cfg = JSON.parse(await file.text());
                if (cfg.commands) this.commands = cfg.commands;
                if (cfg.workflows) this.workflows = cfg.workflows;
                if (cfg.params) this.commandParams = cfg.params;
                this.loadParamsToUI();
                this.render();
                Utils.toast('导入成功', 'success');
            } catch(e) { Utils.toast('导入失败: ' + e, 'error'); }
        };
        input.click();
    },

    // ==================== UI测试命令 ====================
    
    uitestCmds: [],  // UI测试命令列表 (从protocols.json加载)
    editingUITestCmd: null,  // 当前编辑的UI测试命令
    
    async refreshUITestCmds() {
        const statusEl = document.getElementById('pm-uitest-status');
        if (statusEl) statusEl.textContent = '加载中...';
        
        try {
            // 从后端API获取UI测试命令
            const result = await API.call('ui_test_get_commands');
            if (result.success && result.commands) {
                // 转换为数组格式
                this.uitestCmds = Object.entries(result.commands).map(([id, cmd]) => ({
                    id,
                    ...cmd
                }));
                const count = this.uitestCmds.length;
                if (statusEl) statusEl.textContent = `已加载 ${count} 个UI测试命令`;
                this.renderUITestCmdList();
            } else {
                if (statusEl) statusEl.textContent = '加载失败: ' + (result.error || '');
            }
        } catch (e) {
            if (statusEl) statusEl.textContent = '加载异常: ' + e.message;
        }
    },
    
    renderUITestCmdList() {
        const el = document.getElementById('pm-uitest-cmd-list');
        if (!el) return;
        
        if (this.uitestCmds.length === 0) {
            el.innerHTML = '<div style="color:var(--text-muted);padding:40px;text-align:center">暂无UI测试命令，点击上方按钮添加</div>';
            return;
        }
        
        // 和命令管理一样的列表样式
        el.innerHTML = this.uitestCmds.map((cmd, i) => `
            <div class="pm-item" onclick="ProtocolPage.editUITestCommand(${i})">
                <span class="icon">${cmd.icon || '🤖'}</span>
                <div class="info">
                    <div class="name">${cmd.name || cmd.id}</div>
                    <div class="meta">${cmd.description || ''} | 发送${(cmd.send_params||[]).length}参数 接收${(cmd.recv_params||[]).length}参数</div>
                </div>
                <span class="code">0x${cmd.code || '??'}</span>
            </div>
        `).join('');
    },
    
    // 新增UI测试命令
    addUITestCommand() {
        this.editingUITestCmd = {
            id: 'ui_' + Date.now(),
            name: '',
            code: '',
            icon: '🤖',
            category: 'ui_test',
            timeout: 300,
            retry: 1,
            send_params: [],
            recv_params: []
        };
        this.editingUITestCmd._isNew = true;
        this.showUITestCmdModal('新增UI测试命令');
    },
    
    // 编辑UI测试命令
    editUITestCommand(idx) {
        this.editingUITestCmd = JSON.parse(JSON.stringify(this.uitestCmds[idx]));
        this.editingUITestCmd._index = idx;
        this.showUITestCmdModal('编辑UI测试命令');
    },
    
    // 显示编辑弹窗 - 复用现有的命令编辑弹窗
    showUITestCmdModal(title) {
        // 复用现有的命令编辑弹窗，但标记为UI测试命令
        this.editingCmd = this.editingUITestCmd;
        this.editingCmd._isUITest = true;
        
        document.getElementById('pm-cmd-title').textContent = title;
        document.getElementById('pm-cmd-name').value = this.editingCmd.name || '';
        document.getElementById('pm-cmd-code').value = this.editingCmd.code || '';
        document.getElementById('pm-cmd-icon').value = this.editingCmd.icon || '🤖';
        document.getElementById('pm-cmd-timeout').value = this.editingCmd.timeout || 300;
        document.getElementById('pm-cmd-retry').value = this.editingCmd.retry || 1;
        document.getElementById('pm-cmd-delete').style.display = this.editingCmd._isNew ? 'none' : '';
        
        this.renderSendParams();
        this.renderRecvParams();
        document.getElementById('pm-cmd-modal').style.display = 'flex';
        
        // 自动刷新命令预览
        setTimeout(() => {
            this.refreshCmdPreview();
            const rxInput = document.getElementById('pm-preview-rx-input');
            const rxResult = document.getElementById('pm-preview-rx-result');
            if (rxInput) rxInput.value = '';
            if (rxResult) rxResult.innerHTML = '';
        }, 100);
    },
    
    // 保存UI测试命令 - 需要修改saveCmdEdit来处理
    async saveUITestCommand() {
        const cmd = this.editingCmd;
        cmd.name = document.getElementById('pm-cmd-name').value;
        cmd.code = document.getElementById('pm-cmd-code').value;
        cmd.icon = document.getElementById('pm-cmd-icon').value;
        cmd.timeout = parseInt(document.getElementById('pm-cmd-timeout').value);
        cmd.retry = parseInt(document.getElementById('pm-cmd-retry').value);
        cmd.category = 'ui_test';  // 确保类别正确
        
        // 调用后端API保存
        try {
            const result = await API.call('protocol_save_command', cmd.id, cmd);
            if (result.success) {
                Utils.toast('UI测试命令已保存', 'success');
                this.closeCmdEdit();
                await this.refreshUITestCmds();  // 刷新列表
            } else {
                Utils.toast('保存失败: ' + (result.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('保存异常: ' + e.message, 'error');
        }
    },
    
    // 删除UI测试命令
    async deleteUITestCommand() {
        const cmd = this.editingCmd;
        if (!confirm(`确定删除命令 "${cmd.name || cmd.id}" 吗？`)) return;
        
        try {
            const result = await API.call('protocol_delete_command', cmd.id);
            if (result.success) {
                Utils.toast('命令已删除', 'success');
                this.closeCmdEdit();
                await this.refreshUITestCmds();
            } else {
                Utils.toast('删除失败: ' + (result.error || ''), 'error');
            }
        } catch (e) {
            Utils.toast('删除异常: ' + e.message, 'error');
        }
    },
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
