/**
 * 用户登录页面
 */

const UserLoginPage = {
    users: [],
    
    async init() {
        console.log('UserLoginPage init');
        await this.loadUsers();
    },
    
    async loadUsers() {
        const result = await API.call('dev_get_users');
        if (result.success) {
            this.users = result.users || [];
            
            // 如果有当前用户，直接跳转
            if (result.current_user) {
                switchPage('home');
                return;
            }
            
            this.renderUsers();
        }
    },
    
    renderUsers() {
        const container = document.getElementById('user-list');
        if (!container) return;
        
        if (this.users.length === 0) {
            container.innerHTML = '<div class="empty-users">暂无用户，请创建新用户</div>';
            // 自动显示创建表单
            this.showCreateForm();
            return;
        }
        
        container.innerHTML = this.users.map(u => `
            <div class="user-item" onclick="UserLoginPage.login('${u.id}')">
                <div class="avatar">${this.getInitial(u.name)}</div>
                <div class="info">
                    <div class="name">${u.name}</div>
                    <div class="detail">${this.getRoleName(u.role)} · ${u.id}</div>
                </div>
                <span class="arrow">→</span>
            </div>
        `).join('');
    },
    
    getInitial(name) {
        return name ? name.charAt(0).toUpperCase() : '?';
    },
    
    getRoleName(role) {
        const names = {
            'dev': '研发工程师',
            'test': '测试工程师',
            'prod': '生产工程师'
        };
        return names[role] || role;
    },
    
    async login(userId) {
        const result = await API.call('dev_set_current_user', userId);
        if (result.success) {
            Utils.toast('登录成功', 'success');
            switchPage('home');
        } else {
            Utils.toast('登录失败: ' + (result.error || ''), 'error');
        }
    },
    
    showCreateForm() {
        document.getElementById('create-form').style.display = 'block';
        document.querySelector('.create-user-section').style.display = 'none';
    },
    
    hideCreateForm() {
        document.getElementById('create-form').style.display = 'none';
        document.querySelector('.create-user-section').style.display = 'block';
    },
    
    async selectWorkspace() {
        const result = await API.call('dev_select_folder');
        if (result.success) {
            document.getElementById('new-user-workspace').value = result.path;
            Utils.toast('已选择工作目录', 'success');
        }
    },
    
    async createUser() {
        const name = document.getElementById('new-user-name').value.trim();
        const userId = document.getElementById('new-user-id').value.trim();
        const role = document.getElementById('new-user-role').value;
        const workspace = document.getElementById('new-user-workspace').value.trim();
        const gitName = document.getElementById('new-git-name').value.trim();
        const gitEmail = document.getElementById('new-git-email').value.trim();
        
        if (!name || !userId || !workspace) {
            Utils.toast('请填写姓名、工号和工作目录', 'warning');
            return;
        }
        
        if (!gitName || !gitEmail) {
            Utils.toast('请填写Git用户名和邮箱', 'warning');
            return;
        }
        
        Utils.toast('正在创建用户...', 'info');
        
        // 配置Git
        const gitResult = await API.call('dev_config_git', gitName, gitEmail);
        if (!gitResult.success) {
            Utils.toast('Git配置失败: ' + (gitResult.error || ''), 'error');
            return;
        }
        
        // 创建用户
        const result = await API.call('dev_add_user', userId, name, role, workspace);
        if (result.success) {
            // 自动登录
            await API.call('dev_set_current_user', userId);
            Utils.toast('用户创建成功！', 'success');
            switchPage('home');
        } else {
            Utils.toast('创建失败: ' + (result.error || ''), 'error');
        }
    }
};
