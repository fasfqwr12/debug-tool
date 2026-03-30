/**
 * 生产管理页面模块
 */

const ProductionPage = {
    programs: [],
    selectedProgram: null,
    
    async init() {
        await this.refresh();
        this.bindEvents();
    },
    
    destroy() {},
    
    bindEvents() {
        // 搜索框
        const searchInput = document.getElementById('program-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.search(e.target.value);
            }, 300));
        }
    },
    
    async refresh() {
        try {
            this.programs = await API.production.getPrograms();
            this.render();
        } catch (e) {
            console.error('加载程序列表失败:', e);
        }
    },
    
    render() {
        const container = document.getElementById('program-list');
        if (!container) return;
        
        if (this.programs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📦</div>
                    <p>暂无程序</p>
                    <button class="btn" onclick="ProductionPage.create()">创建程序</button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.programs.map(p => `
            <div class="program-item ${this.selectedProgram?.id === p.id ? 'selected' : ''}" 
                 onclick="ProductionPage.select('${p.id}')">
                <div class="program-icon">📄</div>
                <div class="program-info">
                    <div class="program-name">${p.name}</div>
                    <div class="program-desc">${p.description || '无描述'}</div>
                    <div class="program-meta">${p.steps} 步骤 · ${p.modified || '未知时间'}</div>
                </div>
                <div class="program-actions">
                    <button class="btn btn-sm" onclick="event.stopPropagation(); ProductionPage.run('${p.id}')">▶ 运行</button>
                    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); ProductionPage.edit('${p.id}')">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); ProductionPage.delete('${p.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
    },
    
    async search(keyword) {
        if (!keyword) {
            await this.refresh();
            return;
        }
        
        try {
            this.programs = await API.production.search(keyword);
            this.render();
        } catch (e) {
            console.error('搜索失败:', e);
        }
    },
    
    async select(id) {
        try {
            const res = await API.production.getProgram(id);
            if (res.success) {
                this.selectedProgram = res.data;
                this.showDetail(res.data);
                this.render(); // 更新选中状态
            }
        } catch (e) {
            console.error('获取程序详情失败:', e);
        }
    },
    
    showDetail(program) {
        const detail = document.getElementById('program-detail');
        if (!detail) return;
        
        detail.innerHTML = `
            <h3>${program.name}</h3>
            <p>${program.description || '无描述'}</p>
            
            <div class="steps-list">
                <h4>步骤列表</h4>
                ${(program.steps || []).map((step, i) => `
                    <div class="step-item">
                        <span class="step-num">${i + 1}</span>
                        <span class="step-action">${step.action || '未定义'}</span>
                        <span class="step-params">${JSON.stringify(step.params || {})}</span>
                    </div>
                `).join('') || '<div class="empty-hint">暂无步骤</div>'}
            </div>
        `;
    },
    
    async create() {
        const name = await Utils.prompt('请输入程序名称');
        if (!name) return;
        
        const id = 'prog_' + Date.now();
        const program = {
            name: name,
            description: '',
            steps: []
        };
        
        const res = await API.production.saveProgram(id, program);
        if (res.success) {
            Utils.toast('程序已创建', 'success');
            await this.refresh();
        } else {
            Utils.toast(res.message || '创建失败', 'error');
        }
    },
    
    async edit(id) {
        // 简单实现：弹出输入框修改名称
        const res = await API.production.getProgram(id);
        if (!res.success) return;
        
        const program = res.data;
        const newName = await Utils.prompt('修改程序名称', program.name);
        if (newName && newName !== program.name) {
            program.name = newName;
            await API.production.saveProgram(id, program);
            Utils.toast('已保存', 'success');
            await this.refresh();
        }
    },
    
    async delete(id) {
        if (!await Utils.confirm('确定要删除这个程序吗？')) return;
        
        const res = await API.production.deleteProgram(id);
        if (res.success) {
            Utils.toast('已删除', 'success');
            if (this.selectedProgram?.id === id) {
                this.selectedProgram = null;
                const detail = document.getElementById('program-detail');
                if (detail) detail.innerHTML = '<div class="empty-hint">请选择一个程序</div>';
            }
            await this.refresh();
        } else {
            Utils.toast(res.message || '删除失败', 'error');
        }
    },
    
    async run(id) {
        if (!await Utils.confirm('确定要运行这个程序吗？')) return;
        
        const res = await API.production.runProgram(id);
        if (res.success) {
            Utils.toast('程序开始执行', 'info');
        } else {
            Utils.toast(res.message || '执行失败', 'error');
        }
    },
    
    async stop() {
        await API.production.stopProgram();
        Utils.toast('程序已停止', 'warning');
    }
};

// 程序执行进度回调
window.onProgram_progress = function(data) {
    console.log('程序进度:', data);
    // 可以在这里更新进度条
};

window.ProductionPage = ProductionPage;
