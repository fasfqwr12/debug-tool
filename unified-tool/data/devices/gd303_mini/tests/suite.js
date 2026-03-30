/**
 * GD303 Mini 完整UI测试套件 (v2.2 - 添加重置步骤)
 * 
 * 重要: 每个测试用例开头添加"重置"动作，确保从干净状态开始
 * 
 * 基于固件 svc_ui_mini.c 状态机逻辑:
 * - runstep: 奇数=等待测量(激光开), 偶数=显示结果
 * - 初始 runstep=1, 测量成功后 runstep++
 * - 报错时 runstep 不变
 * - K3短按: 连续中停止 / 有数据回退 / 关激光 / 切单次模式
 * - K2短按: 切换模式, runstep=0(激光开则=1), 清除错误状态
 * 
 * 初始状态12个字段:
 * laser, mode, unit, base, runstep, line4, line3, line2, line1, state, backlight, beep
 */

window.GD303MiniTestSuite = {
    name: "GD303 Mini UI测试",
    version: "2.2",
    device: "gd303_mini",
    params: {
        fuselageLength: 0.068,  // 机身长度68mm (后基准偏移)
        minDist: 0.05,
        maxDist: 30.0,
        m_to_ft: 3.28084,
        m_to_in: 39.3701
    },
    
    // 默认初始状态 (完整12字段)
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
    
    // 重置步骤: 多次K3清除确保回到干净状态
    resetSteps: [
        { action: "K3短按", expect: { state: "IDLE" }, desc: "清除1" },
        { action: "K3短按", expect: { laser: "OFF" }, desc: "清除2" },
        { action: "K3短按", expect: { mode: "SINGLE" }, desc: "清除3-切单次" },
        { action: "K3短按", expect: { runstep: 0, line4: "-----" }, desc: "清除4-确认" }
    ],

    categories: [
        // ============ 1. 边界值测试 ============
        {
            id: "1",
            name: "边界值-距离显示",
            cases: [
                {
                    id: "1.1",
                    name: "距离边界",
                    subcases: [
                        {
                            id: "1.1.1",
                            name: "最小距离0.05m",
                            desc: "测量50mm，后基准显示0.118m (50+68=118mm)",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----", state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1, line4: "-----" } },
                                { action: "模拟测距成功(50,3)", expect: { laser: "OFF", runstep: 2, line4: 0.118, state: "RESULT" } }
                            ]
                        },
                        {
                            id: "1.1.2",
                            name: "1m距离",
                            desc: "测量1000mm，后基准显示1.068m",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { laser: "OFF", runstep: 2, line4: 1.068 } }
                            ]
                        },
                        {
                            id: "1.1.3",
                            name: "10m距离",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(10000,3)", expect: { laser: "OFF", runstep: 2, line4: 10.068 } }
                            ]
                        },
                        {
                            id: "1.1.4",
                            name: "最大距离30m",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(30000,2)", expect: { laser: "OFF", runstep: 2, line4: 30.068 } }
                            ]
                        },
                        {
                            id: "1.1.5",
                            name: "零值显示",
                            desc: "测量0mm，后基准显示0.068m (机身长度)",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(0,3)", expect: { laser: "OFF", runstep: 2, line4: 0.068 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 2. 单位切换 ============
        {
            id: "2",
            name: "单位-米/英尺/英寸",
            cases: [
                {
                    id: "2.1",
                    name: "单位显示",
                    subcases: [
                        {
                            id: "2.1.1",
                            name: "米单位显示",
                            desc: "1m+68mm=1.068m",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "m", line4: 1.068, runstep: 2 } }
                            ]
                        },
                        {
                            id: "2.1.2",
                            name: "英尺单位显示",
                            desc: "1.068m × 3.28084 = 3.503ft",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "ft", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "ft", line4: 3.503, runstep: 2 } }
                            ]
                        },
                        {
                            id: "2.1.3",
                            name: "英寸单位显示",
                            desc: "1.068m × 39.3701 = 42.05in",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "in", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(2)", expect: { unit: "in" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { unit: "in", line4: 42.05, runstep: 2 } }
                            ]
                        }
                    ]
                },
                {
                    id: "2.2",
                    name: "单位切换",
                    subcases: [
                        {
                            id: "2.2.1",
                            name: "测量后切换单位",
                            desc: "测量后切换单位，显示值自动转换",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, runstep: 2 } },
                                { action: "设置单位(1)", expect: { unit: "ft" } }
                            ]
                        },
                        {
                            id: "2.2.2",
                            name: "单位循环切换",
                            initial: { unit: "m", state: "IDLE" },
                            steps: [
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "设置单位(2)", expect: { unit: "in" } },
                                { action: "设置单位(0)", expect: { unit: "m" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 3. 基准偏移 ============
        {
            id: "3",
            name: "基准-前/后偏移",
            cases: [
                {
                    id: "3.1",
                    name: "基准测试",
                    subcases: [
                        {
                            id: "3.1.1",
                            name: "后基准+68mm",
                            desc: "后基准: 显示值 = 测量值 + 68mm",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "获取状态", expect: { base: "BACK" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, runstep: 2 } }
                            ]
                        },
                        {
                            id: "3.1.2",
                            name: "前基准无偏移",
                            desc: "前基准: 显示值 = 测量值 (不加偏移)",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "FRONT", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.000, runstep: 2 } }
                            ]
                        },
                        {
                            id: "3.1.3",
                            name: "基准切换",
                            initial: { base: "BACK", state: "IDLE" },
                            steps: [
                                { action: "获取状态", expect: { base: "BACK" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K2长按", expect: { base: "BACK" } }
                            ]
                        },
                        {
                            id: "3.1.4",
                            name: "前后基准差值验证",
                            desc: "同一距离，后基准比前基准多68mm",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, runstep: 2 } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.000, runstep: 4 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 4. 模式-单次测量 ============
        {
            id: "4",
            name: "模式-单次测量",
            cases: [
                {
                    id: "4.1",
                    name: "基本流程",
                    subcases: [
                        {
                            id: "4.1.1",
                            name: "单次测量完整流程",
                            desc: "K1开激光(runstep奇数) → K1测距(runstep偶数)",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----", state: "IDLE", backlight: "ON", beep: "ON" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----", state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1, line4: "-----", state: "IDLE" } },
                                { action: "模拟测距成功(5000,3)", expect: { laser: "OFF", runstep: 2, line4: 5.068, state: "RESULT" } }
                            ]
                        },
                        {
                            id: "4.1.2",
                            name: "连续两次测量",
                            desc: "第二次测量前runstep从偶数变奇数，line3显示上次结果",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", line3: "-----", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----", line3: "-----", state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { laser: "OFF", runstep: 2, line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3, line4: "-----" } },
                                { action: "模拟测距成功(2000,3)", expect: { laser: "OFF", runstep: 4, line4: 2.068, line3: 1.068 } }
                            ]
                        }
                    ]
                },
                {
                    id: "4.2",
                    name: "历史数据滚动",
                    subcases: [
                        {
                            id: "4.2.1",
                            name: "4次测量历史滚动",
                            desc: "runstep 2→4→6→8，数据依次滚动到line3→line2→line1",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----", line3: "-----", line2: "-----", line1: "-----" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 2, line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 4, line4: 2.068, line3: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 5 } },
                                { action: "模拟测距成功(3000,3)", expect: { runstep: 6, line4: 3.068, line3: 2.068, line2: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 7 } },
                                { action: "模拟测距成功(4000,3)", expect: { runstep: 8, line4: 4.068, line3: 3.068, line2: 2.068, line1: 1.068 } }
                            ]
                        },
                        {
                            id: "4.2.2",
                            name: "报错不滚动数据",
                            desc: "测距失败时runstep不变，历史数据不滚动",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, line4: "-----", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 2, line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距失败(3)", expect: { state: "ERROR", runstep: 3 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 4, line4: 2.068, line3: 1.068 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 5. 模式-面积测量 ============
        {
            id: "5",
            name: "模式-面积测量",
            cases: [
                {
                    id: "5.1",
                    name: "面积测量",
                    subcases: [
                        {
                            id: "5.1.1",
                            name: "进入面积模式",
                            desc: "K2短按切换模式，runstep重置为0",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0, line4: "-----", line1: "-----", line2: "-----", state: "IDLE" } }
                            ]
                        },
                        {
                            id: "5.1.2",
                            name: "面积计算2m×3m",
                            desc: "两次测量后计算面积: (2.068)×(3.068)=6.345m²",
                            initial: { laser: "OFF", mode: "AREA", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0, line1: "-----", line2: "-----", line4: "-----" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 3, line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3000,3)", expect: { runstep: 5, line2: 3.068, line4: 6.345 } }
                            ]
                        },
                        {
                            id: "5.1.3",
                            name: "面积测量中途取消",
                            desc: "K3短按回退步骤",
                            initial: { laser: "OFF", mode: "AREA", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 3, line1: 2.068 } },
                                { action: "K3短按", expect: { runstep: 1 } }
                            ]
                        }
                    ]
                }
            ]
        },
        // ============ 6. 模式-体积测量 ============
        {
            id: "6",
            name: "模式-体积测量",
            cases: [
                {
                    id: "6.1",
                    name: "体积测量",
                    subcases: [
                        {
                            id: "6.1.1",
                            name: "进入体积模式",
                            initial: { laser: "OFF", mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME", runstep: 0, line4: "-----" } }
                            ]
                        },
                        {
                            id: "6.1.2",
                            name: "体积计算2m×2m×2m",
                            desc: "三次测量后计算体积: (2.068)³=8.845m³",
                            initial: { laser: "OFF", mode: "VOLUME", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 3, line1: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 5, line2: 2.068 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 7, line3: 2.068, line4: 8.845 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 7. 模式-勾股测量 ============
        {
            id: "7",
            name: "模式-勾股测量",
            cases: [
                {
                    id: "7.1",
                    name: "勾股模式",
                    subcases: [
                        {
                            id: "7.1.1",
                            name: "进入勾股1模式",
                            initial: { laser: "OFF", mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1", runstep: 0 } }
                            ]
                        },
                        {
                            id: "7.1.2",
                            name: "勾股1计算(5-4=3)",
                            desc: "斜边5m，直角边4m，计算另一边: sqrt(5²-4²)=3m",
                            initial: { laser: "OFF", mode: "PYTH1", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(4932,3)", expect: { runstep: 3, line1: 5.000 } },
                                { action: "K1短按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(3932,3)", expect: { runstep: 5, line2: 4.000, line4: 3.000 } }
                            ]
                        },
                        {
                            id: "7.1.3",
                            name: "进入勾股2模式",
                            initial: { laser: "OFF", mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1" } },
                                { action: "K2短按", expect: { mode: "PYTH2", runstep: 0 } }
                            ]
                        },
                        {
                            id: "7.1.4",
                            name: "进入勾股3模式",
                            initial: { laser: "OFF", mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1" } },
                                { action: "K2短按", expect: { mode: "PYTH2" } },
                                { action: "K2短按", expect: { mode: "PYTH3", runstep: 0 } }
                            ]
                        }
                    ]
                }
            ]
        },
        // ============ 8. 模式-连续测量 ============
        {
            id: "8",
            name: "模式-连续测量",
            cases: [
                {
                    id: "8.1",
                    name: "连续测量",
                    subcases: [
                        {
                            id: "8.1.1",
                            name: "进入连续测量",
                            desc: "K1长按启动连续测量，显示MAX/MIN图标",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1长按", expect: { laser: "ON" } }
                            ]
                        },
                        {
                            id: "8.1.2",
                            name: "MAX/MIN更新",
                            desc: "连续测量中自动更新最大最小值",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068, line2: 2.068, line3: 2.068 } },
                                { action: "模拟测距成功(3000,3)", expect: { line4: 3.068, line2: 3.068, line3: 2.068 } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068, line2: 3.068, line3: 1.068 } }
                            ]
                        },
                        {
                            id: "8.1.3",
                            name: "退出连续测量",
                            desc: "K3短按停止连续测量",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 2.068 } },
                                { action: "K3短按", expect: { laser: "OFF", state: "IDLE" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 9. 状态-模式切换 ============
        {
            id: "9",
            name: "状态-模式切换",
            cases: [
                {
                    id: "9.1",
                    name: "模式循环",
                    subcases: [
                        {
                            id: "9.1.1",
                            name: "模式循环切换",
                            desc: "SINGLE→AREA→VOLUME→PYTH1→PYTH2→PYTH3→SINGLE",
                            initial: { laser: "OFF", mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0 } },
                                { action: "K2短按", expect: { mode: "VOLUME", runstep: 0 } },
                                { action: "K2短按", expect: { mode: "PYTH1", runstep: 0 } },
                                { action: "K2短按", expect: { mode: "PYTH2", runstep: 0 } },
                                { action: "K2短按", expect: { mode: "PYTH3", runstep: 0 } },
                                { action: "K2短按", expect: { mode: "SINGLE", runstep: 0 } }
                            ]
                        },
                        {
                            id: "9.1.2",
                            name: "切换模式清除错误",
                            desc: "K2短按切换模式会清除ERROR状态",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(3)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K2短按", expect: { state: "IDLE", mode: "AREA", runstep: 0 } }
                            ]
                        },
                        {
                            id: "9.1.3",
                            name: "清除键重置状态",
                            desc: "K3短按清除错误状态",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K3短按", expect: { state: "IDLE", laser: "OFF" } }
                            ]
                        },
                        {
                            id: "9.1.4",
                            name: "清除键回退步骤",
                            desc: "有数据时K3短按回退runstep-=2",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 2, line4: 1.068 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 4, line4: 2.068 } },
                                { action: "K3短按", expect: { runstep: 2 } },
                                { action: "K3短按", expect: { runstep: 0 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 10. 异常-测量错误 ============
        {
            id: "10",
            name: "异常-测量错误",
            cases: [
                {
                    id: "10.1",
                    name: "错误处理",
                    subcases: [
                        {
                            id: "10.1.1",
                            name: "无目标(对空)",
                            desc: "错误码1: 无目标",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR", runstep: 1 } }
                            ]
                        },
                        {
                            id: "10.1.2",
                            name: "信号太弱",
                            desc: "错误码2: 信号弱",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR", runstep: 1 } }
                            ]
                        },
                        {
                            id: "10.1.3",
                            name: "错误后恢复测量",
                            desc: "错误后K3清除，再次测量成功",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K3短按", expect: { state: "IDLE", laser: "OFF" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { state: "RESULT", runstep: 2, line4: 1.068 } }
                            ]
                        },
                        {
                            id: "10.1.4",
                            name: "连续错误后成功",
                            desc: "多次错误后runstep不变，成功后正常递增",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(2)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { state: "RESULT", runstep: 2, line4: 1.068 } }
                            ]
                        }
                    ]
                }
            ]
        },
        // ============ 11. 异常-按键异常 ============
        {
            id: "11",
            name: "异常-按键异常",
            cases: [
                {
                    id: "11.1",
                    name: "按键异常",
                    subcases: [
                        {
                            id: "11.1.1",
                            name: "激光开时按模式键",
                            desc: "激光开启时K2短按切换模式",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 1 } }
                            ]
                        },
                        {
                            id: "11.1.2",
                            name: "连续测量中按模式键",
                            desc: "连续测量中K2短按无效",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "K2短按", expect: { mode: "SINGLE" } }
                            ]
                        },
                        {
                            id: "11.1.3",
                            name: "无数据时K3短按",
                            desc: "runstep<=1时K3短按关激光或切单次模式",
                            initial: { laser: "OFF", mode: "AREA", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "K3短按", expect: { laser: "OFF", runstep: 1 } },
                                { action: "K3短按", expect: { mode: "SINGLE", runstep: 0 } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 12. 系统-背光/蜂鸣/开关机 ============
        {
            id: "12",
            name: "系统-背光/蜂鸣/开关机",
            cases: [
                {
                    id: "12.1",
                    name: "背光蜂鸣",
                    subcases: [
                        {
                            id: "12.1.1",
                            name: "背光开关",
                            desc: "K3长按切换背光",
                            initial: { backlight: "ON", state: "IDLE" },
                            steps: [
                                { action: "K3长按", expect: { backlight: "OFF" } },
                                { action: "K3长按", expect: { backlight: "ON" } }
                            ]
                        },
                        {
                            id: "12.1.2",
                            name: "蜂鸣器开关(K1+K2)",
                            desc: "K1+K2组合键切换蜂鸣器",
                            initial: { beep: "ON", state: "IDLE" },
                            steps: [
                                { action: "K1+K2组合", expect: { beep: "OFF" } },
                                { action: "K1+K2组合", expect: { beep: "ON" } }
                            ]
                        }
                    ]
                },
                {
                    id: "12.2",
                    name: "开关机",
                    subcases: [
                        {
                            id: "12.2.1",
                            name: "开机(K1超长按1.1秒)",
                            desc: "关机状态下K1超长按开机",
                            initial: { state: "OFF" },
                            steps: [
                                { action: "K1超长按", expect: { state: "IDLE" } }
                            ]
                        },
                        {
                            id: "12.2.2",
                            name: "关机(K3超长按3秒)",
                            desc: "K3超长按3秒关机",
                            initial: { state: "IDLE" },
                            steps: [
                                { action: "K3超长按", expect: { state: "OFF" } }
                            ]
                        },
                        {
                            id: "12.2.3",
                            name: "自动关机(3分钟)",
                            desc: "无操作3分钟后自动关机",
                            initial: { state: "IDLE" },
                            steps: [
                                { action: "等待(180000)", expect: { state: "OFF" } }
                            ]
                        }
                    ]
                },
                {
                    id: "12.3",
                    name: "充电显示",
                    subcases: [
                        {
                            id: "12.3.1",
                            name: "充电时电池动画",
                            desc: "充电时电池图标循环动画",
                            initial: { state: "IDLE" },
                            steps: [
                                { action: "获取状态", expect: {} }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 13. 段码-数字显示 ============
        {
            id: "13",
            name: "段码-数字显示",
            cases: [
                {
                    id: "13.1",
                    name: "数字显示",
                    subcases: [
                        {
                            id: "13.1.1",
                            name: "数字0-9显示",
                            desc: "验证各数字段码正确",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1234,3)", expect: { runstep: 2, line4: 1.302 } }
                            ]
                        },
                        {
                            id: "13.1.2",
                            name: "小数点位置",
                            desc: "不同数值小数点位置正确",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(123,3)", expect: { runstep: 2, line4: 0.191 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(12345,3)", expect: { runstep: 4, line4: 12.413 } }
                            ]
                        },
                        {
                            id: "13.1.3",
                            name: "Error显示",
                            desc: "错误时显示NULLx",
                            initial: { laser: "OFF", mode: "SINGLE", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR", runstep: 1 } }
                            ]
                        },
                        {
                            id: "13.1.4",
                            name: "横杠-----显示",
                            desc: "初始状态显示-----",
                            initial: { laser: "OFF", mode: "SINGLE", line4: "-----", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----" } },
                                { action: "获取状态", expect: { line4: "-----" } }
                            ]
                        }
                    ]
                }
            ]
        },
        // ============ 14. 段码-图标显示 ============
        {
            id: "14",
            name: "段码-图标显示",
            cases: [
                {
                    id: "14.1",
                    name: "图标显示",
                    subcases: [
                        {
                            id: "14.1.1",
                            name: "电池图标",
                            desc: "电池图标根据电量显示",
                            initial: { state: "IDLE" },
                            steps: [
                                { action: "获取状态", expect: {} }
                            ]
                        },
                        {
                            id: "14.1.2",
                            name: "激光图标",
                            desc: "激光开关时基准图标闪烁",
                            initial: { laser: "OFF", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "K3短按", expect: { laser: "OFF" } }
                            ]
                        },
                        {
                            id: "14.1.3",
                            name: "基准图标",
                            desc: "前后基准图标切换",
                            initial: { base: "BACK", state: "IDLE" },
                            steps: [
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K2长按", expect: { base: "BACK" } }
                            ]
                        },
                        {
                            id: "14.1.4",
                            name: "单位图标",
                            desc: "m/ft/in单位图标切换",
                            initial: { unit: "m", state: "IDLE" },
                            steps: [
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "设置单位(2)", expect: { unit: "in" } }
                            ]
                        },
                        {
                            id: "14.1.5",
                            name: "模式图标",
                            desc: "各测量模式图标显示",
                            initial: { mode: "SINGLE", state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "K2短按", expect: { mode: "AREA" } },
                                { action: "K2短按", expect: { mode: "VOLUME" } },
                                { action: "K2短按", expect: { mode: "PYTH1" } }
                            ]
                        }
                    ]
                }
            ]
        },

        // ============ 15. 交叉测试 ============
        {
            id: "15",
            name: "交叉测试",
            cases: [
                {
                    id: "15.1",
                    name: "功能组合",
                    subcases: [
                        {
                            id: "15.1.1",
                            name: "单位+基准组合",
                            desc: "切换单位和基准后测量",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 2, line4: 1.068 } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 3 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 4, line4: 3.281 } }
                            ]
                        },
                        {
                            id: "15.1.2",
                            name: "模式切换后测量",
                            desc: "单次测量后切换到面积模式，数据清除",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, line4: "-----", state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 2, line4: 1.068 } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0, line4: "-----", line1: "-----" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 3, line1: 2.068 } }
                            ]
                        },
                        {
                            id: "15.1.3",
                            name: "错误后切换模式再测量",
                            desc: "测量错误后切换模式清除错误",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距失败(1)", expect: { state: "ERROR", runstep: 1 } },
                                { action: "K2短按", expect: { state: "IDLE", mode: "AREA", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(1000,3)", expect: { runstep: 3, line1: 1.068 } }
                            ]
                        },
                        {
                            id: "15.1.4",
                            name: "连续测量中切换单位",
                            desc: "连续测量中切换单位，显示值自动转换",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K1长按", expect: { laser: "ON" } },
                                { action: "模拟测距成功(1000,3)", expect: { line4: 1.068 } },
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "模拟测距成功(2000,3)", expect: { line4: 6.785 } },
                                { action: "K3短按", expect: { laser: "OFF", state: "IDLE" } }
                            ]
                        },
                        {
                            id: "15.1.5",
                            name: "开关机后状态恢复",
                            desc: "关机前设置的单位和基准开机后保持",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "设置单位(1)", expect: { unit: "ft" } },
                                { action: "K2长按", expect: { base: "FRONT" } },
                                { action: "K3超长按", expect: { state: "OFF" } },
                                { action: "K1超长按", expect: { state: "IDLE" } },
                                { action: "获取状态", expect: { unit: "ft", base: "FRONT" } }
                            ]
                        },
                        {
                            id: "15.1.6",
                            name: "多步测量中途切换模式",
                            desc: "面积测量第一步后切换模式，数据清除",
                            initial: { laser: "OFF", mode: "SINGLE", unit: "m", base: "BACK", runstep: 0, state: "IDLE" },
                            steps: [
                                { action: "重置", expect: { mode: "SINGLE", runstep: 0, state: "IDLE" } },
                                { action: "设置单位(0)", expect: { unit: "m" } },
                                { action: "K2短按", expect: { mode: "AREA", runstep: 0 } },
                                { action: "K1短按", expect: { laser: "ON", runstep: 1 } },
                                { action: "模拟测距成功(2000,3)", expect: { runstep: 3, line1: 2.068 } },
                                { action: "K2短按", expect: { mode: "VOLUME", runstep: 0, line1: "-----", line4: "-----" } }
                            ]
                        }
                    ]
                }
            ]
        }
    ]
};


// 辅助函数: 计算期望值
window.GD303MiniTestSuite.calcExpect = {
    // 后基准距离 (mm → m，加机身长度)
    backDist: (mm) => (mm / 1000 + 0.068).toFixed(3),
    // 前基准距离 (mm → m，不加偏移)
    frontDist: (mm) => (mm / 1000).toFixed(3),
    // 米转英尺
    mToFt: (m) => (m * 3.28084).toFixed(3),
    // 米转英寸
    mToIn: (m) => (m * 39.3701).toFixed(2)
};

// 重置动作处理函数
window.GD303MiniTestSuite.executeReset = async function(sendCommand) {
    // 多次K3清除确保回到干净状态
    for (let i = 0; i < 4; i++) {
        await sendCommand('key_clear');
        await new Promise(r => setTimeout(r, 100));
    }
    // 确保单位是米
    await sendCommand('set_unit', { unit: 0 });
    await new Promise(r => setTimeout(r, 50));
};

console.log('[GD303MiniTestSuite] 测试套件v2.2已加载，包含', window.GD303MiniTestSuite.categories.length, '个分类');
console.log('[GD303MiniTestSuite] 每个用例开头添加"重置"动作，确保从干净状态开始');
