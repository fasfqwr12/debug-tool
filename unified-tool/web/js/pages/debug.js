/**
 * 研发调试页面 - 启动入口
 */

const DebugPage = {
    init() {},
    destroy() {},
    
    async openPyQt() {
        const res = await API.call('open_debug_tool');
        if (res.success) {
            Utils.toast('调试工具已启动', 'success');
        } else {
            Utils.toast(res.message || '启动失败', 'error');
        }
    },
    
    openWeb() {
        window.open('pages/debug_pro.html', '_blank', 'width=1400,height=900');
    }
};

window.DebugPage = DebugPage;
