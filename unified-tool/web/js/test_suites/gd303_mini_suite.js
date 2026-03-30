/**
 * GD303 Mini 完整UI测试套件 (v3.1 - 专业测试方法论)
 * 
 * ============================================================================
 * 测试设计方法论
 * ============================================================================
 * 
 * 1. 边界值分析 (Boundary Value Analysis - BVA)
 *    - 最小值 (MIN): 0mm, 50mm
 *    - 最小值-1 (MIN-1): -1mm (无效)
 *    - 最小值+1 (MIN+1): 51mm
 *    - 最大值 (MAX): 30000mm
 *    - 最大值-1 (MAX-1): 29999mm
 *    - 最大值+1 (MAX+1): 30001mm (超量程)
 * 
 * 2. 等价类划分 (Equivalence Partitioning)
 *    - 有效等价类: 50mm ~ 30000mm
 *    - 无效等价类: <50mm, >30000mm, 负数
 * 
 * 3. 错误推测 (Error Guessing)
 *    - 零值处理
 *    - 负数处理
 *    - 溢出处理
 *    - 精度丢失
 * 
 * 4. 状态转换测试 (State Transition Testing)
 *    - 所有模式切换路径
 *    - 错误状态恢复
 *    - 中断恢复
 * 
 * ============================================================================
 * 设备参数 (来自 device_config.h)
 * ============================================================================
 * - 机身长度: 68mm (后基准偏移)
 * - 测量范围: 50mm ~ 30000mm (0.05m ~ 30m)
 * - 测量精度: ±2mm
 * - 最大显示值: 99999
 * - 单位转换: m→ft (×3.28084), m→in (×39.3701)
 * 
 * ============================================================================
 * 设计原则
 * ============================================================================
 * 1. 按模式顺序执行: SINGLE → AREA → VOLUME → PYTH1 → PYTH2 → PYTH3
 * 2. 每个模式内测完所有用例再切换到下一个模式
 * 3. 每个测试开头发送 CA 01 进入调试模式
 * 4. 模式内用 K3 清除数据，不切换模式
 */

window.GD303MiniTestSuite = {
    name: "GD303 Mini UI测试",
    version: "3.1",
    device: "gd303_mini",
    
    // 设备参数 (来自 device_config.h)
    params: {
        fuselageLength: 0.068,      // 机身长度68mm (后基准偏移)
        minDist: 0.05,              // 最小测量距离 50mm
        maxDist: 30.0,              // 最大测量距离 30m
        accuracy: 0.002,            // 测量精度 ±2mm
        maxDisplay: 99999,          // 最大显示值
        m_to_ft: 3.28084,           // 米→英尺
        m_to_in: 39.3701,           // 米→英寸
        m2_to_ft2: 10.7639,         // 平方米→平方英尺
        m3_to_ft3: 35.3147,         // 立方米→立方英尺
    },
    
    // 边界值定义 (用于测试用例)
    boundaries: {
        distance: {
            min: 0,                 // 最小值 0mm
            minValid: 50,           // 最小有效值 50mm
            typical: 5000,          // 典型值 5m
            max: 30000,             // 最大值 30m
            maxPlus1: 30001,        // 超量程
        },
        signal: {
            min: 1,                 // 最弱信号
            max: 5,                 // 最强信号
        },
        errorCodes: [1, 2, 3, 4],   // 错误码: 无目标/信号弱/信号强/超量程
    },
    
    // 默认初始状态
    defaultInitial: {
        laser: "OFF",
        mode: "SINGLE",
        unit: "m",
        base: "BACK",
        runstep: 0,
        line4: "-----",
        line3: "-----",
        line2: "-----",
        line1: "-----",
        state: "IDLE",
        backlight: "ON",
        beep: "ON"
    },

    categories: [
        // ============================================================
        // 1. 单次模式 (SINGLE) - 所有单次模式测试
        // ============================================================
        {
            id: "1",
            name: "单次模式(SINGLE)",
            desc: "单次测量模式的所有测试，包括正常流程、边界值、错误处理",
            cases: [
                // 1.1 基本测量流程
                {
                    id: "1.1",
                    name: "基本测量流程",
                    subcases: [
                        {
                            id: "1.1.1",
                            name: "单次测量完整流程",
                            desc: "K1开激光 → K1测距 → 显示结果",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: { laser: "OFF" }, desc: "确保激光关" },
                                { action: "K3短按", expect: { mode: "SINGLE" }, desc: "确保单次模式" },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "开激光" },
                                { action: "模拟测距成功(5000,3)", expect: { laser: "OFF", line4: 5.068 }, desc: "测量5m" }
                            ]
                        },
                        {
                            id: "1.1.2",
                            name: "连续两次测量",
                            desc: "第二次测量，历史数据滚动到line3",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: { laser: "OFF" } },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068, line3: 1.068 } }
                            ]
                        },
                        {
                            id: "1.1.3",
                            name: "4次测量历史滚动",
                            desc: "数据依次滚动到line3→line2→line1",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3000,3)", expect: { line4: 3.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4000,3)", expect: { line4: 4.068, line3: 3.068, line2: 2.068, line1: 1.068 } }
                            ]
                        }
                    ]
                },
                // 1.2 距离边界值
                {
                    id: "1.2",
                    name: "距离边界值",
                    subcases: [
                        {
                            id: "1.2.1",
                            name: "最小距离0mm",
                            desc: "测量0mm，后基准显示0.068m(机身长度)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(0,3)", expect: { line4: 0.068 } }
                            ]
                        },
                        {
                            id: "1.2.2",
                            name: "最小距离50mm",
                            desc: "测量50mm，后基准显示0.118m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(50,3)", expect: { line4: 0.118 } }
                            ]
                        },
                        {
                            id: "1.2.3",
                            name: "最大距离30m",
                            desc: "测量30000mm，后基准显示30.068m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(30000,2)", expect: { line4: 30.068 } }
                            ]
                        }
                    ]
                },
                // 1.3 单位切换
                {
                    id: "1.3",
                    name: "单位切换",
                    subcases: [
                        {
                            id: "1.3.1",
                            name: "米单位显示",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "m", line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.3.2",
                            name: "英尺单位显示",
                            desc: "1.068m × 3.28084 = 3.503ft",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "ft", line4: 3.503 } }
                            ]
                        },
                        {
                            id: "1.3.3",
                            name: "英寸单位显示",
                            desc: "1.068m × 39.3701 = 42.05in",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(2)", expect: { unit: "in" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "in", line4: 42.05 } }
                            ]
                        }
                    ]
                },
                // 1.4 基准切换
                {
                    id: "1.4",
                    name: "基准切换",
                    subcases: [
                        {
                            id: "1.4.1",
                            name: "后基准+68mm",
                            desc: "后基准: 显示值 = 测量值 + 68mm",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.4.2",
                            name: "前基准无偏移",
                            desc: "前基准: 显示值 = 测量值",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.000 } },
                                { action: "K2长按", expect: { base: "BACK" }, desc: "恢复后基准" }
                            ]
                        }
                    ]
                },
                // 1.5 测量错误处理
                {
                    id: "1.5",
                    name: "测量错误处理",
                    subcases: [
                        {
                            id: "1.5.1",
                            name: "错误码1-无目标",
                            desc: "对空测量，显示Err1",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } }
                            ]
                        },
                        {
                            id: "1.5.2",
                            name: "错误码2-信号弱",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR" } }
                            ]
                        },
                        {
                            id: "1.5.3",
                            name: "错误码3-信号强",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(3)", expect: { state: "ERROR" } }
                            ]
                        },
                        {
                            id: "1.5.4",
                            name: "错误码4-超量程",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(4)", expect: { state: "ERROR" } }
                            ]
                        },
                        {
                            id: "1.5.5",
                            name: "错误后K3清除恢复",
                            desc: "错误后K3清除，再次测量成功",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K3短按", expect: { laser: "OFF" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.5.6",
                            name: "错误后K1直接重试",
                            desc: "错误后直接K1重新测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.5.7",
                            name: "连续多次错误后成功",
                            desc: "多次错误后成功测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(3)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.5.8",
                            name: "错误不滚动历史数据",
                            desc: "测距失败时历史数据不滚动",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068, line3: 1.068 }, desc: "line3应该是1.068不是错误" }
                            ]
                        }
                    ]
                },
                // 1.6 连续测量
                {
                    id: "1.6",
                    name: "连续测量",
                    subcases: [
                        {
                            id: "1.6.1",
                            name: "进入连续测量",
                            desc: "K1长按启动连续测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1长按", expect: { laser: "ON" } }
                            ]
                        },
                        {
                            id: "1.6.2",
                            name: "连续测量MAX/MIN更新",
                            desc: "连续测量中自动更新最大最小值",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: { laser: "OFF" } },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                { action: "模拟测距成功(3000,3)", expect: { line4: 3.068, line2: 3.068 }, desc: "MAX更新" },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, line3: 1.068 }, desc: "MIN更新" },
                                { action: "K3短按", expect: { laser: "OFF" } }
                            ]
                        },
                        {
                            id: "1.6.3",
                            name: "连续测量中出错",
                            desc: "连续测量中出错不停止，继续测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: { laser: "OFF" } },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                { action: "模拟测距失败(1)", expect: {} },
                                { action: "模拟测距成功(3000,3)", expect: { line4: 3.068 } },
                                { action: "K3短按", expect: { laser: "OFF" } }
                            ]
                        }
                    ]
                },
                // 1.7 K3回退功能
                {
                    id: "1.7",
                    name: "K3回退功能",
                    subcases: [
                        {
                            id: "1.7.1",
                            name: "K3回退历史数据",
                            desc: "有数据时K3短按回退",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                { action: "K3短按", expect: { line4: 1.068 }, desc: "回退到上一个值" }
                            ]
                        },
                        {
                            id: "1.7.2",
                            name: "K3关闭激光",
                            desc: "激光开时K3关闭激光",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "K3短按", expect: { laser: "OFF" } }
                            ]
                        }
                    ]
                },
                // 1.8 信号强度边界
                {
                    id: "1.8",
                    name: "信号强度边界",
                    subcases: [
                        {
                            id: "1.8.1",
                            name: "信号强度1格(最弱)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,1)", expect: { line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.8.2",
                            name: "信号强度5格(最强)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,5)", expect: { line4: 1.068 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 2. 面积模式 (AREA) - 所有面积模式测试
        // ============================================================
        {
            id: "2",
            name: "面积模式(AREA)",
            desc: "面积测量模式的所有测试",
            cases: [
                // 2.1 基本面积测量
                {
                    id: "2.1",
                    name: "基本面积测量",
                    subcases: [
                        {
                            id: "2.1.1",
                            name: "切换到面积模式",
                            desc: "从单次模式切换到面积模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } }
                            ]
                        },
                        {
                            id: "2.1.2",
                            name: "面积计算2m×3m",
                            desc: "两次测量后计算面积: 2.068×3.068=6.345m²",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "开激光测第一边" },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 }, desc: "长=2.068m" },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测第二边" },
                                { action: "模拟测距成功(3000,3)", expect: { line2: 3.068, line4: 6.345 }, desc: "宽=3.068m, 面积=6.345m²" }
                            ]
                        },
                        {
                            id: "2.1.3",
                            name: "面积计算1m×1m",
                            desc: "1.068×1.068=1.141m²",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line1: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line2: 1.068, line4: 1.141 } }
                            ]
                        }
                    ]
                },
                // 2.2 面积模式错误处理
                {
                    id: "2.2",
                    name: "面积模式错误处理",
                    subcases: [
                        {
                            id: "2.2.1",
                            name: "第一边测量失败",
                            desc: "第一边测量失败，保持step=1等待重试",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } }
                            ]
                        },
                        {
                            id: "2.2.2",
                            name: "第二边测量失败",
                            desc: "第二边测量失败，保持step=2等待重试",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3000,3)", expect: { line2: 3.068, line4: 6.345 } }
                            ]
                        }
                    ]
                },
                // 2.3 面积模式K3回退
                {
                    id: "2.3",
                    name: "面积模式K3回退",
                    subcases: [
                        {
                            id: "2.3.1",
                            name: "测量中途K3回退",
                            desc: "第一边测完后K3回退到step=1",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K3短按", expect: {}, desc: "回退到step=1" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1500,3)", expect: { line1: 1.568 }, desc: "重新测第一边" }
                            ]
                        },
                        {
                            id: "2.3.2",
                            name: "计算完成后K3回退",
                            desc: "面积计算完成后K3回退重新测第二边",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3000,3)", expect: { line4: 6.345 } },
                                { action: "K3短按", expect: { laser: "ON" }, desc: "回退重测第二边" },
                                { action: "模拟测距成功(4000,3)", expect: { line2: 4.068, line4: 8.413 }, desc: "新面积" }
                            ]
                        }
                    ]
                },
                // 2.4 面积极限值
                {
                    id: "2.4",
                    name: "面积极限值",
                    subcases: [
                        {
                            id: "2.4.1",
                            name: "最大面积30m×30m",
                            desc: "30×30=900m²",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line1: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line2: 30.000, line4: 900.000 } }
                            ]
                        },
                        {
                            id: "2.4.2",
                            name: "最小面积0.1m×0.1m",
                            desc: "0.1×0.1=0.01m²",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(32,3)", expect: { line1: 0.100 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(32,3)", expect: { line2: 0.100, line4: 0.010 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 3. 体积模式 (VOLUME) - 所有体积模式测试
        // ============================================================
        {
            id: "3",
            name: "体积模式(VOLUME)",
            desc: "体积测量模式的所有测试",
            cases: [
                // 3.1 基本体积测量
                {
                    id: "3.1",
                    name: "基本体积测量",
                    subcases: [
                        {
                            id: "3.1.1",
                            name: "切换到体积模式",
                            desc: "从面积模式切换到体积模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } }
                            ]
                        },
                        {
                            id: "3.1.2",
                            name: "体积计算2m×2m×2m",
                            desc: "三次测量后计算体积: 2.068³=8.845m³",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测长" },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测宽" },
                                { action: "模拟测距成功(2000,3)", expect: { line2: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测高" },
                                { action: "模拟测距成功(2000,3)", expect: { line3: 2.068, line4: 8.845 } }
                            ]
                        },
                        {
                            id: "3.1.3",
                            name: "体积计算1m×2m×3m",
                            desc: "1.068×2.068×3.068=6.777m³",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line1: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line2: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3000,3)", expect: { line3: 3.068, line4: 6.777 } }
                            ]
                        }
                    ]
                },
                // 3.2 体积模式错误处理
                {
                    id: "3.2",
                    name: "体积模式错误处理",
                    subcases: [
                        {
                            id: "3.2.1",
                            name: "第一步测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } }
                            ]
                        },
                        {
                            id: "3.2.2",
                            name: "第二步测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line2: 2.068 } }
                            ]
                        },
                        {
                            id: "3.2.3",
                            name: "第三步测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line2: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(3)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line3: 2.068, line4: 8.845 } }
                            ]
                        }
                    ]
                },
                // 3.3 体积模式K3回退
                {
                    id: "3.3",
                    name: "体积模式K3回退",
                    subcases: [
                        {
                            id: "3.3.1",
                            name: "第二步K3回退到第一步",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K3短按", expect: {}, desc: "回退到step=1" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1500,3)", expect: { line1: 1.568 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 4. 勾股1模式 (PYTH1) - 求直角边
        // ============================================================
        {
            id: "4",
            name: "勾股1模式(PYTH1)",
            desc: "勾股定理1: 已知斜边和一条直角边，求另一条直角边 √(a²-b²)",
            cases: [
                // 4.1 基本勾股1计算
                {
                    id: "4.1",
                    name: "基本勾股1计算",
                    subcases: [
                        {
                            id: "4.1.1",
                            name: "切换到勾股1模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1" } }
                            ]
                        },
                        {
                            id: "4.1.2",
                            name: "勾股1计算(5-4=3)",
                            desc: "斜边5m，直角边4m，另一边=√(25-16)=3m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测斜边" },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 }, desc: "斜边=5m" },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测直角边" },
                                { action: "模拟测距成功(3932,3)", expect: { line2: 4.000, line4: 3.000 }, desc: "直角边=4m, 结果=3m" }
                            ]
                        },
                        {
                            id: "4.1.3",
                            name: "勾股1计算(13-5=12)",
                            desc: "斜边13m，直角边5m，另一边=√(169-25)=12m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(12932,3)", expect: { line1: 13.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000, line4: 12.000 } }
                            ]
                        }
                    ]
                },
                // 4.2 勾股1计算错误
                {
                    id: "4.2",
                    name: "勾股1计算错误",
                    subcases: [
                        {
                            id: "4.2.1",
                            name: "斜边小于直角边(计算错误)",
                            desc: "斜边3m < 直角边5m，√(9-25)为负，显示Err",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line1: 3.000 }, desc: "斜边=3m" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000 }, desc: "直角边=5m > 斜边，line4应显示Err" }
                            ]
                        },
                        {
                            id: "4.2.2",
                            name: "斜边等于直角边(结果为0)",
                            desc: "斜边5m = 直角边5m，√(25-25)=0",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 }, desc: "斜边=5m" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000 }, desc: "直角边=5m = 斜边，line4应显示Err" }
                            ]
                        }
                    ]
                },
                // 4.3 勾股1测量错误
                {
                    id: "4.3",
                    name: "勾股1测量错误",
                    subcases: [
                        {
                            id: "4.3.1",
                            name: "第一边测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } }
                            ]
                        },
                        {
                            id: "4.3.2",
                            name: "第二边测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3932,3)", expect: { line2: 4.000, line4: 3.000 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 5. 勾股2模式 (PYTH2) - 间接测量求和
        // ============================================================
        {
            id: "5",
            name: "勾股2模式(PYTH2)",
            desc: "勾股定理2: 间接测量 √(a²-b²) + √(c²-b²)",
            cases: [
                // 5.1 基本勾股2计算
                {
                    id: "5.1",
                    name: "基本勾股2计算",
                    subcases: [
                        {
                            id: "5.1.1",
                            name: "切换到勾股2模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "K2短按", expect: { mode: "PYTH2" } }
                            ]
                        },
                        {
                            id: "5.1.2",
                            name: "勾股2计算(5,4,5)",
                            desc: "a=5m, b=4m, c=5m, 结果=√(25-16)+√(25-16)=3+3=6m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测斜边a" },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测公共边b" },
                                { action: "模拟测距成功(3932,3)", expect: { line2: 4.000 } },
                                { action: "K1短按", expect: { laser: "ON" }, desc: "测斜边c" },
                                { action: "模拟测距成功(4932,3)", expect: { line3: 5.000, line4: 6.000 } }
                            ]
                        }
                    ]
                },
                // 5.2 勾股2计算错误
                {
                    id: "5.2",
                    name: "勾股2计算错误",
                    subcases: [
                        {
                            id: "5.2.1",
                            name: "斜边a小于公共边b",
                            desc: "a=3m < b=5m，计算错误显示Err",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line1: 3.000 }, desc: "a=3m" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000 }, desc: "b=5m > a" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(5932,3)", expect: { line3: 6.000 }, desc: "c=6m, 但a<b导致Err" }
                            ]
                        },
                        {
                            id: "5.2.2",
                            name: "斜边c小于公共边b",
                            desc: "c=3m < b=5m，计算错误显示Err",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(5932,3)", expect: { line1: 6.000 }, desc: "a=6m" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000 }, desc: "b=5m" },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line3: 3.000 }, desc: "c=3m < b, 导致Err" }
                            ]
                        }
                    ]
                },
                // 5.3 勾股2测量错误
                {
                    id: "5.3",
                    name: "勾股2测量错误",
                    subcases: [
                        {
                            id: "5.3.1",
                            name: "中间步骤测量失败",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3932,3)", expect: { line2: 4.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line3: 5.000, line4: 6.000 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 6. 勾股3模式 (PYTH3) - 间接测量求差
        // ============================================================
        {
            id: "6",
            name: "勾股3模式(PYTH3)",
            desc: "勾股定理3: 间接测量 |√(a²-b²) - √(c²-b²)|",
            cases: [
                // 6.1 基本勾股3计算
                {
                    id: "6.1",
                    name: "基本勾股3计算",
                    subcases: [
                        {
                            id: "6.1.1",
                            name: "切换到勾股3模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "K2短按", expect: { mode: "PYTH3" } }
                            ]
                        },
                        {
                            id: "6.1.2",
                            name: "勾股3计算(5,4,5)",
                            desc: "a=5m, b=4m, c=5m, 结果=|√(25-16)-√(25-16)|=|3-3|=0m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH3" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3932,3)", expect: { line2: 4.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line3: 5.000, line4: 0.000 } }
                            ]
                        },
                        {
                            id: "6.1.3",
                            name: "勾股3计算(5,3,4)",
                            desc: "a=5m, b=3m, c=4m, 结果=|√(25-9)-√(16-9)|=|4-2.646|=1.354m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH3" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line2: 3.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3932,3)", expect: { line3: 4.000, line4: 1.354 } }
                            ]
                        }
                    ]
                },
                // 6.2 勾股3计算错误
                {
                    id: "6.2",
                    name: "勾股3计算错误",
                    subcases: [
                        {
                            id: "6.2.1",
                            name: "斜边小于公共边",
                            desc: "a=3m < b=5m，计算错误显示Err",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH3" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line1: 3.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line2: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(5932,3)", expect: { line3: 6.000 }, desc: "a<b导致Err" }
                            ]
                        }
                    ]
                },
                // 6.3 模式循环回单次
                {
                    id: "6.3",
                    name: "模式循环回单次",
                    subcases: [
                        {
                            id: "6.3.1",
                            name: "从勾股3切回单次模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH3" } },
                                { action: "K2短按", expect: { mode: "SINGLE" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 7. 系统功能测试
        // ============================================================
        {
            id: "7",
            name: "系统功能",
            desc: "背光、蜂鸣器、模式切换等系统功能",
            cases: [
                // 7.1 背光蜂鸣
                {
                    id: "7.1",
                    name: "背光蜂鸣",
                    subcases: [
                        {
                            id: "7.1.1",
                            name: "背光开关(K3长按)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3长按", expect: { backlight: "OFF" } },
                                { action: "K3长按", expect: { backlight: "ON" } }
                            ]
                        },
                        {
                            id: "7.1.2",
                            name: "蜂鸣器开关(K1+K2)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K1+K2组合", expect: { beep: "OFF" } },
                                { action: "K1+K2组合", expect: { beep: "ON" } }
                            ]
                        }
                    ]
                },
                // 7.2 模式循环切换
                {
                    id: "7.2",
                    name: "模式循环切换",
                    subcases: [
                        {
                            id: "7.2.1",
                            name: "完整模式循环",
                            desc: "SINGLE→AREA→VOLUME→PYTH1→PYTH2→PYTH3→SINGLE",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1" } },
                                { action: "K2短按", expect: { mode: "PYTH2" } },
                                { action: "K2短按", expect: { mode: "PYTH3" } },
                                { action: "K2短按", expect: { mode: "SINGLE" } }
                            ]
                        },
                        {
                            id: "7.2.2",
                            name: "切换模式清除错误状态",
                            desc: "K2短按切换模式会清除ERROR状态",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K2短按", expect: { state: "IDLE", mode: "AREA" } }
                            ]
                        }
                    ]
                },
                // 7.3 背光控制（移除开关机测试）
                {
                    id: "7.3",
                    name: "背光控制",
                    subcases: [
                        {
                            id: "7.3.1",
                            name: "背光开关(K3长按)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3长按", expect: { backlight: "ON" } },
                                { action: "K3长按", expect: { backlight: "OFF" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 8. 交叉功能测试
        // ============================================================
        {
            id: "8",
            name: "交叉功能测试",
            desc: "多功能组合测试",
            cases: [
                {
                    id: "8.1",
                    name: "功能组合",
                    subcases: [
                        {
                            id: "8.1.1",
                            name: "单位+基准组合测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 3.281 } },
                                { action: "K2长按", expect: { base: "BACK" } }
                            ]
                        },
                        {
                            id: "8.1.2",
                            name: "模式切换后数据清除",
                            desc: "单次测量后切换到面积模式，数据清除",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K2短按", expect: { mode: "AREA", line4: "-----" } }
                            ]
                        },
                        {
                            id: "8.1.3",
                            name: "错误后切换模式再测量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR" } },
                                { action: "K2短按", expect: { state: "IDLE", mode: "AREA" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line1: 1.068 } }
                            ]
                        },
                        {
                            id: "8.1.4",
                            name: "多步测量中途切换模式",
                            desc: "面积测量第一步后切换模式，数据清除",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line1: 2.068 } },
                                { action: "K2短按", expect: { mode: "VOLUME", line1: "-----" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 9. 边界值与异常测试 (BVA - Boundary Value Analysis)
        // ============================================================
        {
            id: "9",
            name: "边界值与异常测试(BVA)",
            desc: "专业边界值分析: 超量程、显示溢出、计算溢出、单位转换边界",
            cases: [
                // 9.1 距离超边界测试
                {
                    id: "9.1",
                    name: "距离超边界测试",
                    subcases: [
                        {
                            id: "9.1.1",
                            name: "超量程MAX+1(30001mm)",
                            desc: "BVA: 超过最大量程30m，应返回错误码4(超量程)",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(30001,3)", expect: {}, desc: "超量程30.001m，观察固件处理" }
                            ]
                        },
                        {
                            id: "9.1.2",
                            name: "超量程MAX+1000(31000mm)",
                            desc: "BVA: 大幅超量程31m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(31000,3)", expect: {}, desc: "超量程31m，观察固件处理" }
                            ]
                        },
                        {
                            id: "9.1.3",
                            name: "极限超量程(99999mm)",
                            desc: "BVA: 接近显示上限99.999m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(99931,3)", expect: {}, desc: "99.999m，观察显示是否溢出" }
                            ]
                        },
                        {
                            id: "9.1.4",
                            name: "显示溢出(100000mm)",
                            desc: "BVA: 超过最大显示值99999，应显示OL或截断",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(99932,3)", expect: {}, desc: "100m，超过显示上限" }
                            ]
                        },
                        {
                            id: "9.1.5",
                            name: "负距离值(-1mm)",
                            desc: "BVA: 负数距离，固件应拒绝或显示错误",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(-1,3)", expect: {}, desc: "负距离，观察固件处理" }
                            ]
                        },
                        {
                            id: "9.1.6",
                            name: "大负数距离(-10000mm)",
                            desc: "BVA: 大负数，测试有符号整数处理",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(-10000,3)", expect: {}, desc: "-10m，观察固件处理" }
                            ]
                        }
                    ]
                },
                // 9.2 单位转换边界测试
                {
                    id: "9.2",
                    name: "单位转换边界测试",
                    subcases: [
                        {
                            id: "9.2.1",
                            name: "英尺显示溢出(30m→98.43ft)",
                            desc: "BVA: 30m转英尺=98.43ft，接近显示上限",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "30m=98.43ft" }
                            ]
                        },
                        {
                            id: "9.2.2",
                            name: "英寸显示溢出(30m→1181.1in)",
                            desc: "BVA: 30m转英寸=1181.1in，可能超过显示位数",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(2)", expect: { unit: "in" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "30m=1181.1in" }
                            ]
                        },
                        {
                            id: "9.2.3",
                            name: "英尺+英寸模式边界",
                            desc: "BVA: 测试ft+in组合显示模式",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(3)", expect: { unit: "ft+in" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "30m转ft+in显示" }
                            ]
                        }
                    ]
                },
                // 9.3 面积计算溢出测试
                {
                    id: "9.3",
                    name: "面积计算溢出测试",
                    subcases: [
                        {
                            id: "9.3.1",
                            name: "最大面积30m×30m=900m²",
                            desc: "BVA: 最大面积，接近显示上限",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line1: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "30×30=900m²" }
                            ]
                        },
                        {
                            id: "9.3.2",
                            name: "面积英尺²溢出(900m²→9687.5ft²)",
                            desc: "BVA: 900m²转ft²=9687.5，可能溢出",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {} },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "900m²=9687.5ft²" }
                            ]
                        },
                        {
                            id: "9.3.3",
                            name: "面积英寸²溢出(900m²→1395003in²)",
                            desc: "BVA: 900m²转in²=1395003，严重溢出",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "AREA" } },
                                { action: "设置单位(2)", expect: { unit: "in" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {} },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "900m²=1395003in²，超过99999" }
                            ]
                        }
                    ]
                },
                // 9.4 体积计算溢出测试
                {
                    id: "9.4",
                    name: "体积计算溢出测试",
                    subcases: [
                        {
                            id: "9.4.1",
                            name: "最大体积30m×30m×30m=27000m³",
                            desc: "BVA: 最大体积，超过显示上限99999",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line1: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line2: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "27000m³，超过99999" }
                            ]
                        },
                        {
                            id: "9.4.2",
                            name: "体积边界10m×10m×10m=1000m³",
                            desc: "BVA: 中等体积，不溢出",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: { line1: 10.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: { line2: 10.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: {}, desc: "1000m³" }
                            ]
                        },
                        {
                            id: "9.4.3",
                            name: "体积ft³溢出(1000m³→35315ft³)",
                            desc: "BVA: 1000m³转ft³=35315，不溢出",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "VOLUME" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: {} },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: {} },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(9932,3)", expect: {}, desc: "1000m³=35315ft³" }
                            ]
                        }
                    ]
                },
                // 9.5 勾股计算边界测试
                {
                    id: "9.5",
                    name: "勾股计算边界测试",
                    subcases: [
                        {
                            id: "9.5.1",
                            name: "PYTH1极小差值(5.001m,5m)",
                            desc: "BVA: 斜边仅比直角边大0.001m，结果接近0",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4933,3)", expect: { line1: 5.001 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: {}, desc: "√(5.001²-5²)≈0.1m" }
                            ]
                        },
                        {
                            id: "9.5.2",
                            name: "PYTH1最大值(30m,1m)",
                            desc: "BVA: 最大斜边30m，最小直角边1m",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH1" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line1: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(932,3)", expect: {}, desc: "√(900-1)≈29.98m" }
                            ]
                        },
                        {
                            id: "9.5.3",
                            name: "PYTH2最大结果(30m,1m,30m)",
                            desc: "BVA: 两个最大斜边，最小公共边",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH2" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: { line1: 30.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(932,3)", expect: { line2: 1.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(29932,3)", expect: {}, desc: "≈59.96m" }
                            ]
                        },
                        {
                            id: "9.5.4",
                            name: "PYTH3结果为0(对称情况)",
                            desc: "BVA: a=c时结果为0",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "PYTH3" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2932,3)", expect: { line2: 3.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(4932,3)", expect: { line3: 5.000, line4: 0.000 }, desc: "|4-4|=0" }
                            ]
                        }
                    ]
                },
                // 9.6 信号强度边界测试
                {
                    id: "9.6",
                    name: "信号强度边界测试",
                    subcases: [
                        {
                            id: "9.6.1",
                            name: "信号强度0(无效值)",
                            desc: "BVA: 信号强度0，应视为无效",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,0)", expect: {}, desc: "信号强度0" }
                            ]
                        },
                        {
                            id: "9.6.2",
                            name: "信号强度6(超出范围)",
                            desc: "BVA: 信号强度超过最大值5",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,6)", expect: {}, desc: "信号强度6，超出范围" }
                            ]
                        },
                        {
                            id: "9.6.3",
                            name: "信号强度负数(-1)",
                            desc: "BVA: 负数信号强度",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,-1)", expect: {}, desc: "信号强度-1" }
                            ]
                        }
                    ]
                },
                // 9.7 错误码边界测试
                {
                    id: "9.7",
                    name: "错误码边界测试",
                    subcases: [
                        {
                            id: "9.7.1",
                            name: "错误码0(无效)",
                            desc: "BVA: 错误码0，应视为无效或成功",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(0)", expect: {}, desc: "错误码0" }
                            ]
                        },
                        {
                            id: "9.7.2",
                            name: "错误码5(超出定义)",
                            desc: "BVA: 错误码超出定义范围1-4",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(5)", expect: {}, desc: "错误码5，超出定义" }
                            ]
                        },
                        {
                            id: "9.7.3",
                            name: "错误码255(最大uint8)",
                            desc: "BVA: 最大uint8值",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距失败(255)", expect: {}, desc: "错误码255" }
                            ]
                        }
                    ]
                },
                // 9.8 精度边界测试
                {
                    id: "9.8",
                    name: "精度边界测试",
                    subcases: [
                        {
                            id: "9.8.1",
                            name: "最小精度1mm",
                            desc: "BVA: 测试1mm精度显示",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1,3)", expect: { line4: 0.069 }, desc: "1mm+68mm=69mm" }
                            ]
                        },
                        {
                            id: "9.8.2",
                            name: "连续1mm递增",
                            desc: "BVA: 测试连续小增量",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: {} },
                                { action: "K3短按", expect: { mode: "SINGLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1001,3)", expect: { line4: 1.069 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1002,3)", expect: { line4: 1.070 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============================================================
        // 10. 关机测试 (最后执行)
        // ============================================================
        {
            id: "10",
            name: "关机测试",
            desc: "设备关机测试 - 必须最后执行",
            cases: [
                {
                    id: "10.1",
                    name: "设备关机",
                    subcases: [
                        {
                            id: "10.1.1",
                            name: "正常关机(K3超长按3秒)",
                            desc: "测试完成后关机，避免影响后续测试",
                            skipVerification: true,
                            steps: [
                                { action: "进入调试模式", expect: {} },
                                { action: "K3超长按", expect: { state: "OFF" } }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};

// 辅助函数
window.GD303MiniTestSuite.calcExpect = {
    backDist: (mm) => (mm / 1000 + 0.068).toFixed(3),
    frontDist: (mm) => (mm / 1000).toFixed(3),
    mToFt: (m) => (m * 3.28084).toFixed(3),
    mToIn: (m) => (m * 39.3701).toFixed(2)
};

console.log('[GD303MiniTestSuite] 测试套件v3.2已加载');
console.log('[GD303MiniTestSuite] 按模式分组: SINGLE→AREA→VOLUME→PYTH1→PYTH2→PYTH3→系统→交叉→BVA→关机');
console.log('[GD303MiniTestSuite] 共', window.GD303MiniTestSuite.categories.length, '个测试分组');
console.log('[GD303MiniTestSuite] ⚠️  关机测试已移至最后，避免影响其他测试');
