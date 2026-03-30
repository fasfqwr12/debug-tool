/**
 * 仪表盘页面 - 版本生命周期跟踪
 */

const HomePage = {
    versions: [],
    currentStage: null,
    
    async init() {
        console.log('HomePage init');
        await this.loadVersionStats();
        await this.loadRecentActivity();
        this.bindEvents();
    },
    
    destroy() {},
    
    bindEvents() {
        // 点击阶段筛选
        document.querySelectorAll('.lifecycle-stage').forEach(el => {
            el.addEventListener('click', () => {
                const stage = el.dataset.stage;
                this.filterByStage(stage);
            });
        });
    },
    
    async loadVersionStats() {
        try {
            const result = await API.call('dev_get_version_stats');
            if (result.success) {
                const stats = result.stats || {};
                
                // 更新各阶段计数
                document.getElementById('stage-dev-count').textContent = stats.dev || 0;
                document.getElementById('stage-submitted-count').textContent = stats.submitted || 0;
                document.getElementById('stage-testing-count').textContent = stats.testing || 0;
                document.getElementById('stage-passed-count').textContent = stats.passed || 0;
                document.getElementById('stage-released-count').textContent = stats.released || 0;
                
                // 保存版本列表
                this.versions = result.versions || [];
                this.renderVersionList(this.versions);
                
                // 更新今日任务数
                const tasksEl = document.getElementById('home-tasks');
                if (tasksEl) {
                    tasksEl.textContent = (stats.submitted || 0) + (stats.testing || 0);
                }
            }
        } catch (e) {
            console.error('加载版本统计失败:', e);
        }
    },
    
    filterByStage(stage) {
        // 切换选中状态
        document.querySelectorAll('.lifecycle-stage').forEach(el => {
            el.classList.toggle('active', el.dataset.stage === stage);
        });
        
        if (this.currentStage === stage) {
            // 取消筛选
            this.currentStage = null;
            this.renderVersionList(this.versions);
        } else {
            this.currentStage = stage;
            const filtered = this.versions.filter(v => v.stage === stage);
            this.renderVersionList(filtered);
        }
    },
    
    renderVersionList(versions) {
        const container = document.getElementById('lifecycle-list');
        if (!container) return;
        
        if (!versions || versions.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无版本记录</div>';
            return;
        }
        
        const stageNames = {
            dev: '开发中',
            submitted: '待测试',
            testing: '测试中',
            passed: '已通过',
            rejected: '已拒绝',
            released: '已发布'
        };
        
        container.innerHTML = versions.slice(0, 10).map(v => `
            <div class="lifecycle-item" onclick="switchPage('dev_release')">
                <span class="item-icon">📦</span>
                <div class="item-info">
                    <div class="item-name">${v.project_name || '未知项目'} v${v.version}</div>
                    <div class="item-meta">${v.fw_model || '--'} | ${v.created_at ? new Date(v.created_at).toLocaleDateString() : '--'}</div>
                </div>
                <span class="item-stage ${v.stage}">${stageNames[v.stage] || v.stage}</span>
            </div>
        `).join('');
    },
    
    async loadRecentActivity() {
        try {
            // 加载最近操作记录
            const result = await API.call('get_recent_activity');
            if (result.success) {
                const list = document.getElementById('home-recent-list');
                if (list && result.activities && result.activities.length > 0) {
                    list.innerHTML = result.activities.map(a => `
                        <div class="recent-item">
                            <div>${a.action}</div>
                            <div class="time">${a.time}</div>
                        </div>
                    `).join('');
                }
            }
        } catch (e) {
            // 忽略错误
        }
        
        // 加载当前用户
        try {
            const userResult = await API.call('user_get_current');
            if (userResult.success && userResult.user) {
                const el = document.getElementById('home-user');
                if (el) el.textContent = userResult.user.name || userResult.user.id;
            }
        } catch (e) {}
    }
};

window.HomePage = HomePage;
