/**
 * UI测试库 - 动作和期望的标准定义
 * 测试人员可以通过Tab快速选择
 */

window.UITestLib = {
    // ==================== 动作库 ====================
    actions: {
        // 按键操作
        "K1短按": { 
            cmd: "key_measure", 
            desc: "按测量键（第一次开激光，第二次测距）",
            category: "按键"
        },
        "K1长按": { 
            cmd: "key_measure_long", 
            desc: "长按测量键进入连续测量",
            category: "按键"
        },
        "K2短按": { 
            cmd: "key_mode", 
            desc: "按模式键切换模式",
            category: "按键"
        },
        "K2长按": { 
            cmd: "key_base", 
            desc: "长按模式键切换基准",
            category: "按键"
        },
        "K3短按": { 
            cmd: "key_clear", 
            desc: "按清除键清除/返回",
            category: "按键"
        },
        "K3长按": { 
            cmd: "key_backlight", 
            desc: "长按清除键切换背光",
            category: "按键"
        },
        "K3超长按": { 
            cmd: "key_power_off", 
            desc: "超长按清除键关机(3秒)",
            category: "按键"
        },
        "K1超长按": { 
            cmd: "key_power_on", 
            desc: "超长按测量键开机(1.1秒)",
            category: "按键"
        },
        "K1+K2组合": { 
            cmd: "key_combo_beep", 
            desc: "组合键切换蜂鸣器",
            category: "按键"
        },
        
        // 调试命令
        "进入调试模式": { 
            cmd: "debug_enter", 
            desc: "发送CA 01进入调试模式(禁用所有超时)",
            category: "调试"
        },
        "退出调试模式": { 
            cmd: "debug_exit", 
            desc: "发送CA 00退出调试模式",
            category: "调试"
        },
        
        // 模拟命令
        "模拟测距成功": { 
            cmd: "sim_ok", 
            params: [
                { name: "距离", key: "distance", type: "number", unit: "mm", default: 5000 },
                { name: "信号", key: "signal", type: "number", default: 3 }
            ],
            desc: "模拟测距返回成功结果",
            category: "模拟",
            example: "模拟测距成功(5000,3)"
        },
        "模拟测距失败": { 
            cmd: "sim_err", 
            params: [
                { name: "错误码", key: "code", type: "number", default: 1 }
            ],
            desc: "模拟测距返回错误",
            category: "模拟",
            example: "模拟测距失败(1)"
        },
        "设置单位": { 
            cmd: "set_unit", 
            params: [
                { name: "单位", key: "unit", type: "number", default: 0 }
            ],
            desc: "设置显示单位(0米/1英尺/2英寸)",
            category: "模拟",
            example: "设置单位(0)"
        },
        "设置单位米": { 
            cmd: "set_unit", 
            param: 0,
            desc: "设置显示单位为米",
            category: "模拟"
        },
        "设置单位英尺": { 
            cmd: "set_unit", 
            param: 1,
            desc: "设置显示单位为英尺",
            category: "模拟"
        },
        "设置单位英寸": { 
            cmd: "set_unit", 
            param: 2,
            desc: "设置显示单位为英寸",
            category: "模拟"
        },
        
        // 控制命令
        "等待": { 
            cmd: "wait", 
            params: [
                { name: "时间", key: "ms", type: "number", unit: "ms", default: 300 }
            ],
            desc: "等待指定毫秒",
            category: "控制",
            example: "等待(300)"
        },
        "获取状态": { 
            cmd: "get_status", 
            desc: "获取当前UI状态并更新LCD",
            category: "控制"
        },
        "重置": { 
            cmd: "reset", 
            desc: "重置到初始状态(多次K3清除+切单次模式)",
            category: "控制",
            isComposite: true,
            subActions: [
                { cmd: "key_clear", delay: 100 },
                { cmd: "key_clear", delay: 100 },
                { cmd: "key_clear", delay: 100 },
                { cmd: "key_clear", delay: 100 }
            ]
        },
        "LCD截屏": { 
            cmd: "lcd_screenshot", 
            params: [
                { name: "文件名", key: "name", type: "string", default: "screenshot" }
            ],
            desc: "保存LCD截图",
            category: "控制",
            example: "LCD截屏(step1)"
        },
    },

    // ==================== 期望库 ====================
    expects: {
        // === 状态期望(基于固件返回) ===
        "激光开": { field: "laser", value: "ON", desc: "激光开启", category: "状态" },
        "激光关": { field: "laser", value: "OFF", desc: "激光关闭", category: "状态" },
        "步骤奇数": { field: "runstep", check: "odd", desc: "激光开启状态(runstep为奇数)", category: "状态" },
        "步骤偶数": { field: "runstep", check: "even", desc: "显示结果状态(runstep为偶数)", category: "状态" },
        "步骤=": { 
            field: "runstep", 
            params: [{ name: "数值", type: "number" }],
            desc: "步骤等于指定值",
            example: "步骤=(2)",
            category: "状态"
        },
        "状态空闲": { field: "state", value: "IDLE", desc: "空闲状态", category: "状态" },
        "状态测量中": { field: "state", value: "MEASURING", desc: "测量中", category: "状态" },
        "状态结果": { field: "state", value: "RESULT", desc: "显示结果", category: "状态" },
        "状态错误": { field: "state", value: "ERROR", desc: "错误状态", category: "状态" },
        
        // === 数字行显示(LCD元素绑定) ===
        "第4行显示": { 
            type: "lcd_line",
            line: 4,
            field: "line4",
            params: [{ name: "数值", type: "string" }],
            desc: "第4行显示数值(如5.068m)",
            example: "第4行显示(5.068m)",
            category: "数字",
            lcdElements: ["Line4_D1", "Line4_D2", "Line4_D3", "Line4_D4", "Line4_D5", "Line4_DP1", "Line4_DP2", "Line4_DP3", "Line4_Unit"]
        },
        "第3行显示": { 
            type: "lcd_line",
            line: 3,
            field: "line3",
            params: [{ name: "数值", type: "string" }],
            desc: "第3行显示数值",
            example: "第3行显示(3.500m)",
            category: "数字",
            lcdElements: ["Line3_D1", "Line3_D2", "Line3_D3", "Line3_D4", "Line3_D5", "Line3_DP1", "Line3_DP2", "Line3_DP3", "Line3_Unit"]
        },
        "第2行显示": { 
            type: "lcd_line",
            line: 2,
            field: "line2",
            params: [{ name: "数值", type: "string" }],
            desc: "第2行显示数值",
            category: "数字",
            lcdElements: ["Line2_D1", "Line2_D2", "Line2_D3", "Line2_D4", "Line2_D5", "Line2_DP1", "Line2_DP2", "Line2_DP3", "Line2_Unit"]
        },
        "第1行显示": { 
            type: "lcd_line",
            line: 1,
            field: "line1",
            params: [{ name: "数值", type: "string" }],
            desc: "第1行显示数值",
            category: "数字",
            lcdElements: ["Line1_D1", "Line1_D2", "Line1_D3", "Line1_D4", "Line1_D5", "Line1_DP1", "Line1_DP2", "Line1_DP3", "Line1_Unit"]
        },
        "显示Error": { 
            type: "lcd_text",
            field: "line4",
            value: "Error",
            text: "Error",
            desc: "显示错误",
            category: "数字",
            lcdElements: ["Line4_D1", "Line4_D2", "Line4_D3", "Line4_D4", "Line4_D5"]
        },
        "显示-----": { 
            type: "lcd_text",
            field: "line4",
            value: "-----",
            text: "-----",
            desc: "显示空白横线",
            category: "数字",
            lcdElements: ["Line4_D1", "Line4_D2", "Line4_D3", "Line4_D4", "Line4_D5"]
        },
        
        // === 模式期望(LCD图标绑定) ===
        "模式单次": { 
            field: "mode", value: "SINGLE", 
            desc: "单次测量模式", 
            category: "模式",
            lcdElements: ["Mode_s_1_w", "Mode_s_1_x", "Mode_s_1_y", "Mode_s_1_z"]
        },
        "模式面积": { 
            field: "mode", value: "AREA", 
            desc: "面积测量模式", 
            category: "模式",
            lcdElements: ["Mode_s_2_w", "Mode_s_2_x", "Mode_s_2_y", "Mode_s_2_z", "Mode_s_2_h"]
        },
        "模式体积": { 
            field: "mode", value: "VOLUME", 
            desc: "体积测量模式", 
            category: "模式",
            lcdElements: ["Mode_s_3_w", "Mode_s_3_x", "Mode_s_3_y1", "Mode_s_3_y2", "Mode_s_3_z", "Mode_s_3_h"]
        },
        "模式勾股1": { 
            field: "mode", value: "PYTH1", 
            desc: "勾股定理模式1", 
            category: "模式",
            lcdElements: ["Mode_s_q"]
        },
        "模式勾股2": { 
            field: "mode", value: "PYTH2", 
            desc: "勾股定理模式2", 
            category: "模式",
            lcdElements: ["Mode_s_q"]
        },
        "模式勾股3": { 
            field: "mode", value: "PYTH3", 
            desc: "勾股定理模式3", 
            category: "模式",
            lcdElements: ["Mode_s_q"]
        },
        "模式连续": { 
            field: "mode", value: "CONTINUOUS", 
            desc: "连续测量模式", 
            category: "模式"
        },
        "模式角度": { 
            field: "mode", value: "ANGLE", 
            desc: "角度测量模式", 
            category: "模式",
            lcdElements: ["Mode_s_angle", "Angle_Symbol"]
        },
        
        // === 单位期望(LCD元素绑定) ===
        "单位米": { 
            field: "unit", value: "m", 
            desc: "米单位", 
            category: "单位",
            lcdElements: ["Line4_Unit"]
        },
        "单位英尺": { 
            field: "unit", value: "ft", 
            desc: "英尺单位", 
            category: "单位",
            lcdElements: ["Line4_Unit"]
        },
        "单位英寸": { 
            field: "unit", value: "in", 
            desc: "英寸单位", 
            category: "单位",
            lcdElements: ["Line4_Unit"]
        },
        
        // === 基准期望(LCD元素绑定) ===
        "后基准": { 
            field: "base", value: "BACK", 
            desc: "后基准(加机身长度)", 
            category: "基准",
            lcdElements: ["Base_s1", "Base_s2", "Base_s19", "Base_s20", "Base_s21", "Base_s22", "Base_s23", "Base_s24", "Base_s25", "Base_s26", "Base_s27", "Base_s28", "Base_s29", "Base_s30"]
        },
        "前基准": { 
            field: "base", value: "FRONT", 
            desc: "前基准", 
            category: "基准",
            lcdElements: ["Base_s1", "Base_s2"]
        },
        
        // === 图标期望(LCD元素绑定) ===
        "电池满": { 
            type: "lcd_icon",
            desc: "电池满格(3格)", 
            category: "图标",
            lcdElements: ["Battery_Frame", "Battery_Grid1", "Battery_Grid2", "Battery_Grid3"]
        },
        "电池2格": { 
            type: "lcd_icon",
            desc: "电池2格", 
            category: "图标",
            lcdElements: ["Battery_Frame", "Battery_Grid1", "Battery_Grid2"],
            lcdOff: ["Battery_Grid3"]
        },
        "电池1格": { 
            type: "lcd_icon",
            desc: "电池1格", 
            category: "图标",
            lcdElements: ["Battery_Frame", "Battery_Grid1"],
            lcdOff: ["Battery_Grid2", "Battery_Grid3"]
        },
        "电池空": { 
            type: "lcd_icon",
            desc: "电池空", 
            category: "图标",
            lcdElements: ["Battery_Frame"],
            lcdOff: ["Battery_Grid1", "Battery_Grid2", "Battery_Grid3"]
        },
        "信号满": { 
            type: "lcd_icon",
            desc: "信号满格(5格)", 
            category: "图标",
            lcdElements: ["Signal_1", "Signal_2", "Signal_3", "Signal_4", "Signal_5"]
        },
        "信号4格": { 
            type: "lcd_icon",
            desc: "信号4格", 
            category: "图标",
            lcdElements: ["Signal_1", "Signal_2", "Signal_3", "Signal_4"],
            lcdOff: ["Signal_5"]
        },
        "信号3格": { 
            type: "lcd_icon",
            desc: "信号3格", 
            category: "图标",
            lcdElements: ["Signal_1", "Signal_2", "Signal_3"],
            lcdOff: ["Signal_4", "Signal_5"]
        },
        "信号2格": { 
            type: "lcd_icon",
            desc: "信号2格", 
            category: "图标",
            lcdElements: ["Signal_1", "Signal_2"],
            lcdOff: ["Signal_3", "Signal_4", "Signal_5"]
        },
        "信号1格": { 
            type: "lcd_icon",
            desc: "信号1格", 
            category: "图标",
            lcdElements: ["Signal_1"],
            lcdOff: ["Signal_2", "Signal_3", "Signal_4", "Signal_5"]
        },
        "蓝牙开": { 
            type: "lcd_icon",
            desc: "蓝牙图标亮", 
            category: "图标",
            lcdElements: ["Bluetooth", "BT"]
        },
        "蓝牙关": { 
            type: "lcd_icon",
            desc: "蓝牙图标灭", 
            category: "图标",
            lcdOff: ["Bluetooth", "BT"]
        },
        "蜂鸣器开": { 
            type: "lcd_icon",
            desc: "蜂鸣器开启图标", 
            category: "图标",
            lcdElements: ["Beep_On"],
            lcdOff: ["Beep_Off"]
        },
        "蜂鸣器关": { 
            type: "lcd_icon",
            desc: "蜂鸣器关闭图标", 
            category: "图标",
            lcdElements: ["Beep_Off"],
            lcdOff: ["Beep_On"]
        },
        "MAX显示": { 
            type: "lcd_icon",
            desc: "MAX图标亮", 
            category: "图标",
            lcdElements: ["MAX_MIN", "max"],
            lcdOff: ["min"]
        },
        "MIN显示": { 
            type: "lcd_icon",
            desc: "MIN图标亮", 
            category: "图标",
            lcdElements: ["MAX_MIN", "min"],
            lcdOff: ["max"]
        },
        "负号显示": { 
            type: "lcd_icon",
            desc: "负号显示", 
            category: "图标",
            lcdElements: ["minus"]
        },
        
        // === 界面预设期望 ===
        "界面": { 
            type: "lcd_preset",
            params: [{ name: "预设名", type: "preset" }],
            desc: "检查LCD界面是否匹配预设",
            example: "界面(单次模式-初始)",
            category: "界面"
        },
        
        // === 其他 ===
        "容差": { 
            field: "tolerance", 
            params: [{ name: "数值", type: "number" }],
            desc: "允许的误差范围",
            example: "容差(0.01)",
            category: "其他"
        },
    },

    // ==================== 常用模板 ====================
    templates: {
        "测距流程": {
            desc: "完整的单次测距流程：清除→开激光→测距",
            steps: [
                { action: "K3短按", expects: ["激光关", "显示-----"] },
                { action: "K1短按", expects: ["激光开", "步骤奇数"] },
                { action: "模拟测距成功(5000,3)", expects: ["激光关", "第4行显示(5.068)", "步骤偶数"] },
            ]
        },
        "连续测距流程": {
            desc: "连续测量模式：开激光→多次测距→停止",
            steps: [
                { action: "K1长按", expects: ["激光开", "模式连续"] },
                { action: "模拟测距成功(3000,3)", expects: ["第4行显示(3.068)"] },
                { action: "等待(500)", expects: [] },
                { action: "模拟测距成功(3100,3)", expects: ["第4行显示(3.168)"] },
                { action: "K3短按", expects: ["激光关"] },
            ]
        },
        "切换单位流程": {
            desc: "切换单位：米→英尺→英寸→米",
            steps: [
                { action: "设置单位米", expects: ["单位米"] },
                { action: "设置单位英尺", expects: ["单位英尺"] },
                { action: "设置单位英寸", expects: ["单位英寸"] },
                { action: "设置单位米", expects: ["单位米"] },
            ]
        },
        "模式切换流程": {
            desc: "切换测量模式：单次→面积→体积→勾股",
            steps: [
                { action: "K2短按", expects: ["模式面积"] },
                { action: "K2短按", expects: ["模式体积"] },
                { action: "K2短按", expects: ["模式勾股1"] },
                { action: "K2短按", expects: ["模式勾股2"] },
                { action: "K2短按", expects: ["模式勾股3"] },
                { action: "K2短按", expects: ["模式单次"] },
            ]
        },
        "基准切换流程": {
            desc: "切换测量基准：后→前→后",
            steps: [
                { action: "K2长按", expects: ["前基准"] },
                { action: "K2长按", expects: ["后基准"] },
            ]
        },
        "错误处理流程": {
            desc: "测试错误显示和清除",
            steps: [
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距失败(1)", expects: ["显示Error", "激光关"] },
                { action: "K3短按", expects: ["显示-----"] },
            ]
        },
        "面积测量流程": {
            desc: "面积测量：切换模式→测两边→显示面积",
            steps: [
                { action: "K2短按", expects: ["模式面积"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(2000,3)", expects: ["第4行显示(2.068)"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(3000,3)", expects: [] },
            ]
        },
        "历史数据滚动": {
            desc: "测试4次测量后历史数据滚动",
            steps: [
                { action: "K3短按", expects: ["显示-----"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(1000,3)", expects: ["第4行显示(1.068)"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(2000,3)", expects: ["第4行显示(2.068)", "第3行显示(1.068)"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(3000,3)", expects: ["第4行显示(3.068)", "第3行显示(2.068)", "第2行显示(1.068)"] },
                { action: "K1短按", expects: ["激光开"] },
                { action: "模拟测距成功(4000,3)", expects: ["第4行显示(4.068)", "第3行显示(3.068)", "第2行显示(2.068)", "第1行显示(1.068)"] },
            ]
        },
    },

    // ==================== 解析函数 ====================
    
    // 解析动作字符串，返回 {cmd, param}
    parseAction(actionStr) {
        // 检查是否有参数 "动作名(参数1,参数2)"
        const match = actionStr.match(/^(.+?)\((.+)\)$/);
        if (match) {
            const name = match[1];
            const paramsStr = match[2];
            const actionDef = this.actions[name];
            if (!actionDef) return null;
            
            const paramValues = paramsStr.split(',').map(s => s.trim());
            if (actionDef.params) {
                const param = {};
                actionDef.params.forEach((p, i) => {
                    let val = paramValues[i] || p.default;
                    if (p.type === 'number') val = parseFloat(val) || 0;
                    param[p.key] = val;
                });
                return { cmd: actionDef.cmd, param };
            }
            return { cmd: actionDef.cmd, param: paramValues[0] };
        }
        
        // 无参数动作
        const actionDef = this.actions[actionStr];
        if (!actionDef) return null;
        return { cmd: actionDef.cmd, param: actionDef.param };
    },
    
    // 解析期望字符串，返回 {field, value, check}
    parseExpect(expectStr) {
        // 检查是否有参数
        const match = expectStr.match(/^(.+?)\((.+)\)$/);
        if (match) {
            const name = match[1];
            const value = match[2].trim();
            const expectDef = this.expects[name];
            if (!expectDef) return null;
            
            const numVal = parseFloat(value);
            return { 
                field: expectDef.field, 
                value: isNaN(numVal) ? value : numVal 
            };
        }
        
        // 无参数期望
        const expectDef = this.expects[expectStr];
        if (!expectDef) return null;
        return { 
            field: expectDef.field, 
            value: expectDef.value,
            check: expectDef.check
        };
    },
    
    // 获取动作列表（用于下拉/补全）
    getActionList() {
        const list = [];
        const categories = {};
        
        Object.entries(this.actions).forEach(([name, def]) => {
            const cat = def.category || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push({
                name,
                desc: def.desc,
                example: def.example || name,
                hasParams: !!def.params
            });
        });
        
        return categories;
    },
    
    // 获取期望列表（用于下拉/补全）
    getExpectList() {
        const list = [];
        Object.entries(this.expects).forEach(([name, def]) => {
            list.push({
                name,
                desc: def.desc,
                example: def.example || name,
                hasParams: !!def.params
            });
        });
        return list;
    },
    
    // 获取模板列表
    getTemplateList() {
        return Object.entries(this.templates).map(([name, def]) => ({
            name,
            desc: def.desc,
            stepCount: def.steps.length
        }));
    },
    
    // 应用模板，返回步骤数组
    applyTemplate(templateName) {
        const tpl = this.templates[templateName];
        if (!tpl) return [];
        
        return tpl.steps.map(step => ({
            actionText: step.action,
            expectTexts: step.expects,
            ...this.parseAction(step.action),
            expects: step.expects.map(e => this.parseExpect(e)).filter(Boolean)
        }));
    },
};

console.log('[UITestLib] 测试库已加载，包含', Object.keys(UITestLib.actions).length, '个动作，', Object.keys(UITestLib.expects).length, '个期望');
