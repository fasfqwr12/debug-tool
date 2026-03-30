/**
 * 用户切换功能
 */

const UserSwitchPage = {
    users: [],
    currentUser: null,
    _inited: false,
    
    async init() {
        if (this._inited) return;
        this._inited = true;
        // 加载用户列表
        await this.loadUsers();
        
        // 检查当前登录用户
        await this.checkCurrentUser();
        
        // 在顶部导航栏添加用户信息
        this.addUserDisplay();
    },
    
    destroy() {},
    
    async loadUsers() {
        try {
            const result = await API.call('user_list', null, true);
            if (result.success) {
                this.users = result.users;
            }
        } catch (e) {
            console.error('加载用户失败:', e);
        }
    },
    
    async checkCurrentUser() {
        try {
            const result = await API.call('user_current');
            if (result.success) {
                this.currentUser = result.user;
            }
        } catch (e) {
            console.log('未登录');
        }
    },
    
    addUserDisplay() {
        // 在导航栏标题旁边添加用户信息
        const userDisplay = document.getElementById('nav-user-display');
        if (!userDisplay) return;
        
        // 显示用户切换按钮
        userDisplay.style.display = 'block';
        
        // 更新用户信息
        this.updateUserDisplay();
    },
    
    show() {
        const dialog = document.getElementById('user-switch-dialog');
        if (!dialog) return;
        
        // 更新用户列表
        const select = document.getElementById('switch-user-select');
        select.innerHTML = '<option value="">请选择用户</option>';
        this.users.forEach(user => {
            if (user.active) {
                const hasPassword = user.password_hash ? ' (需要密码)' : '';
                select.innerHTML += `<option value="${user.id}" data-has-password="${user.password_hash ? 'true' : 'false'}">${user.name} - ${user.getRoleName ? user.getRoleName(user.role) : user.role}${hasPassword}</option>`;
            }
        });
        
        // 更新当前用户信息
        const currentInfo = document.getElementById('current-user-info');
        if (this.currentUser) {
            currentInfo.innerHTML = `
                当前用户：<strong>${this.currentUser.name}</strong><br>
                角色：${this.getRoleName(this.currentUser.role)}<br>
                部门：${this.currentUser.department || '未设置'}
            `;
        } else {
            currentInfo.innerHTML = '当前用户：未登录';
        }
        
        // 清空密码输入
        document.getElementById('switch-password').value = '';
        document.getElementById('password-group').style.display = 'none';
        
        dialog.style.display = 'flex';
    },
    
    onUserSelect() {
        const select = document.getElementById('switch-user-select');
        const passwordGroup = document.getElementById('password-group');
        const selectedOption = select.options[select.selectedIndex];
        
        if (selectedOption && selectedOption.dataset.hasPassword === 'true') {
            passwordGroup.style.display = 'block';
        } else {
            passwordGroup.style.display = 'none';
        }
    },
    
    hide() {
        const dialog = document.getElementById('user-switch-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    },
    
    async switchUser() {
        const userId = document.getElementById('switch-user-select').value;
        
        if (!userId) {
            Utils.toast('请选择用户', 'warning');
            return;
        }
        
        // 获取密码（如果需要）
        const password = document.getElementById('switch-password').value;
        
        try {
            const result = await API.call('user_login', userId, password);
            
            if (result.success) {
                this.currentUser = result.user;
                
                // 更新显示
                this.updateUserDisplay();
                
                // 关闭对话框
                this.hide();
                
                Utils.toast(`已登录：${result.user.name}`, 'success');
                
                // 刷新页面以更新权限
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } else {
                Utils.toast('登录失败：' + result.error, 'error');
            }
        } catch (e) {
            Utils.toast('登录失败', 'error');
        }
    },
    
    updateUserDisplay() {
        const userAvatar = document.getElementById('nav-user-avatar');
        const userName = document.getElementById('nav-user-name');
        
        if (userAvatar && userName) {
            if (this.currentUser) {
                userAvatar.textContent = this.currentUser.name.charAt(0);
                userName.textContent = this.currentUser.name;
            } else {
                userAvatar.textContent = '?';
                userName.textContent = '未登录';
            }
        }
    },
    
    getRoleName(role) {
        const roleNames = {
            'manager': '管理人员',
            'developer': '开发人员',
            'tester': '测试人员'
        };
        return roleNames[role] || role;
    }
};

// 先挂到全局，保证点击事件能找到
window.UserSwitchPage = UserSwitchPage;

// 自动初始化（等待 pywebview 就绪）
window.addEventListener('load', () => {
    setTimeout(async () => {
        try {
            if (window.API && typeof API.waitReady === 'function') {
                await API.waitReady();
            }
            await UserSwitchPage.init();
        } catch (e) {
            console.error('UserSwitchPage 初始化失败:', e);
        }
    }, 300);
});
