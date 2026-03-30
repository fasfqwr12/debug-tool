/**
 * 产品配置管理 - 前端逻辑
 */

// 产品列表
let products = [];
let currentProduct = null;

// 默认产品模板
const DEFAULT_PRODUCT = {
    id: '',
    name: '',
    version: '1.0.0',
    lcd: {
        type: 'seg',        // seg | dot
        lineCount: 4,
        digitPerLine: 5,
        hasBacklight: true
    },
    ranging: {
        maxM: 30,
        minM: 0.05,
        precision: 0.002
    },
    features: {
        single: true,
        continuous: true,
        area: true,
        volume: true,
        pyth: true,
        stakeout: false,
        areaAdd: false,
        bluetooth: false,
        wifi: false,
        usb: true
    },
    power: {
        batteryLowMv: 3300,
        batteryShutdownMv: 3100,
        autoOffSec: 180,
        laserTimeoutSec: 30
    },
    key: {
        longMs: 800,
        key3sMs: 3000,
        debounceMs: 20
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await loadProducts();
    renderProductList();
});

// 加载产品列表
async function loadProducts() {
    try {
        // 优先使用 pywebview API
        if (window.pywebview && window.pywebview.api) {
            const data = await window.pywebview.api.product_list();
            products = data.success ? data.products : [];
        } else {
            // 回退到 HTTP API
            const resp = await fetch('/api/products/list');
            const data = await resp.json();
            products = data.success ? data.products : [];
        }
    } catch (e) {
        console.error('加载产品列表失败:', e);
        products = [];
    }
    
    // 如果没有产品，添加示例
    if (products.length === 0) {
        products = [
            { ...DEFAULT_PRODUCT, id: 'mini30', name: 'GD303-MINI30', lcd: { ...DEFAULT_PRODUCT.lcd, type: 'seg', lineCount: 4 }, ranging: { ...DEFAULT_PRODUCT.ranging, maxM: 30 } },
            { ...DEFAULT_PRODUCT, id: 'pro150', name: 'GD303-PRO150', lcd: { ...DEFAULT_PRODUCT.lcd, type: 'dot', lineCount: 4 }, ranging: { ...DEFAULT_PRODUCT.ranging, maxM: 150 }, features: { ...DEFAULT_PRODUCT.features, stakeout: true } },
            { ...DEFAULT_PRODUCT, id: 'mini20', name: 'GD303-MINI20', lcd: { ...DEFAULT_PRODUCT.lcd, type: 'seg', lineCount: 3 }, ranging: { ...DEFAULT_PRODUCT.ranging, maxM: 20 } }
        ];
    }
}


// 渲染产品列表
function renderProductList() {
    const container = document.getElementById('productList');
    container.innerHTML = '<h3>📋 产品列表</h3>';
    
    products.forEach(p => {
        const div = document.createElement('div');
        div.className = 'product-item' + (currentProduct?.id === p.id ? ' active' : '');
        div.onclick = () => selectProduct(p.id);
        div.innerHTML = `
            <div class="name">${p.name}</div>
            <div class="info">${p.id} | v${p.version}</div>
            <div class="tags">
                <span class="tag ${p.lcd.type === 'seg' ? 'tag-seg' : 'tag-dot'}">${p.lcd.type === 'seg' ? '段码屏' : '点阵屏'}</span>
                <span class="tag tag-line">${p.lcd.lineCount}行</span>
                <span class="tag">${p.ranging.maxM}m</span>
            </div>
        `;
        container.appendChild(div);
    });
}

// 选择产品
function selectProduct(id) {
    currentProduct = products.find(p => p.id === id);
    renderProductList();
    renderConfigPanel();
}

// 渲染配置面板
function renderConfigPanel() {
    const panel = document.getElementById('configPanel');
    if (!currentProduct) {
        panel.innerHTML = '<div style="text-align:center;color:#999;padding:50px;">← 选择一个产品</div>';
        return;
    }
    
    const p = currentProduct;
    panel.innerHTML = `
        <div class="config-section">
            <h3>📌 基本信息</h3>
            <div class="form-grid">
                <label>产品ID</label><input type="text" id="cfg_id" value="${p.id}" onchange="updateConfig('id', this.value)">
                <label>产品名称</label><input type="text" id="cfg_name" value="${p.name}" onchange="updateConfig('name', this.value)">
                <label>版本号</label><input type="text" id="cfg_version" value="${p.version}" onchange="updateConfig('version', this.value)">
            </div>
        </div>
        
        <div class="config-section">
            <h3>🖥️ 屏幕配置</h3>
            <div class="form-grid">
                <label>屏幕类型</label>
                <select id="cfg_lcd_type" onchange="updateConfig('lcd.type', this.value)">
                    <option value="seg" ${p.lcd.type === 'seg' ? 'selected' : ''}>段码屏</option>
                    <option value="dot" ${p.lcd.type === 'dot' ? 'selected' : ''}>点阵屏</option>
                </select>
                <label>显示行数</label><input type="number" value="${p.lcd.lineCount}" onchange="updateConfig('lcd.lineCount', +this.value)">
                <label>每行位数</label><input type="number" value="${p.lcd.digitPerLine}" onchange="updateConfig('lcd.digitPerLine', +this.value)">
                <label>背光</label><input type="checkbox" ${p.lcd.hasBacklight ? 'checked' : ''} onchange="updateConfig('lcd.hasBacklight', this.checked)">
            </div>
        </div>
        
        <div class="config-section">
            <h3>📏 测距配置</h3>
            <div class="form-grid">
                <label>最大量程 (m)</label><input type="number" step="0.1" value="${p.ranging.maxM}" onchange="updateConfig('ranging.maxM', +this.value)">
                <label>最小量程 (m)</label><input type="number" step="0.01" value="${p.ranging.minM}" onchange="updateConfig('ranging.minM', +this.value)">
                <label>测量精度 (m)</label><input type="number" step="0.001" value="${p.ranging.precision}" onchange="updateConfig('ranging.precision', +this.value)">
            </div>
        </div>
        
        <div class="config-section">
            <h3>⚡ 功能开关</h3>
            <div class="feature-grid">
                ${renderFeatureCheckbox('single', '单次测量', p.features.single)}
                ${renderFeatureCheckbox('continuous', '连续测量', p.features.continuous)}
                ${renderFeatureCheckbox('area', '面积测量', p.features.area)}
                ${renderFeatureCheckbox('volume', '体积测量', p.features.volume)}
                ${renderFeatureCheckbox('pyth', '勾股测量', p.features.pyth)}
                ${renderFeatureCheckbox('stakeout', '放样测量', p.features.stakeout)}
                ${renderFeatureCheckbox('areaAdd', '面积累加', p.features.areaAdd)}
                ${renderFeatureCheckbox('bluetooth', '蓝牙', p.features.bluetooth)}
                ${renderFeatureCheckbox('wifi', 'WiFi', p.features.wifi)}
                ${renderFeatureCheckbox('usb', 'USB', p.features.usb)}
            </div>
        </div>
        
        <div class="config-section">
            <h3>🔋 电源配置</h3>
            <div class="form-grid">
                <label>低电量阈值 (mV)</label><input type="number" value="${p.power.batteryLowMv}" onchange="updateConfig('power.batteryLowMv', +this.value)">
                <label>关机阈值 (mV)</label><input type="number" value="${p.power.batteryShutdownMv}" onchange="updateConfig('power.batteryShutdownMv', +this.value)">
                <label>自动关机 (秒)</label><input type="number" value="${p.power.autoOffSec}" onchange="updateConfig('power.autoOffSec', +this.value)">
                <label>激光超时 (秒)</label><input type="number" value="${p.power.laserTimeoutSec}" onchange="updateConfig('power.laserTimeoutSec', +this.value)">
            </div>
        </div>
        
        <div class="config-actions">
            <button class="btn btn-primary" onclick="saveProduct()">💾 保存配置</button>
            <button class="btn btn-success" onclick="generateProductCode()">⚙️ 生成 product.h</button>
            <button class="btn btn-danger" onclick="deleteProduct()">🗑️ 删除产品</button>
        </div>
    `;
}

function renderFeatureCheckbox(key, label, checked) {
    return `<label class="feature-item">
        <input type="checkbox" ${checked ? 'checked' : ''} onchange="updateConfig('features.${key}', this.checked)">
        <span>${label}</span>
    </label>`;
}

// 更新配置
function updateConfig(path, value) {
    const keys = path.split('.');
    let obj = currentProduct;
    for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    renderProductList();
}

// 保存产品
async function saveProduct() {
    try {
        let data;
        if (window.pywebview && window.pywebview.api) {
            data = await window.pywebview.api.product_save(currentProduct);
        } else {
            const resp = await fetch('/api/products/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentProduct)
            });
            data = await resp.json();
        }
        alert(data.success ? '保存成功!' : '保存失败: ' + data.error);
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

// 新建产品
function createProduct() {
    const id = prompt('请输入产品ID (如 mini30):');
    if (!id) return;
    
    const newProduct = { ...JSON.parse(JSON.stringify(DEFAULT_PRODUCT)), id, name: id.toUpperCase() };
    products.push(newProduct);
    currentProduct = newProduct;
    renderProductList();
    renderConfigPanel();
}

// 删除产品
function deleteProduct() {
    if (!confirm(`确定删除产品 ${currentProduct.name}?`)) return;
    products = products.filter(p => p.id !== currentProduct.id);
    currentProduct = null;
    renderProductList();
    renderConfigPanel();
}

// 生成 product.h 代码
function generateProductCode() {
    const p = currentProduct;
    const code = `/**
 * @file    product.h
 * @brief   产品配置 - ${p.name}
 * @note    由上位机自动生成，请勿手动修改
 */
#ifndef PRODUCT_H
#define PRODUCT_H

/*============================================================================
 * 产品标识
 *============================================================================*/
#define PRODUCT_NAME        "${p.name}"
#define PRODUCT_ID          "${p.id}"
#define PRODUCT_VERSION     "${p.version}"

/*============================================================================
 * 屏幕配置
 *============================================================================*/
#define LCD_TYPE_${p.lcd.type.toUpperCase()}        1
#define LCD_LINE_COUNT      ${p.lcd.lineCount}
#define LCD_DIGIT_PER_LINE  ${p.lcd.digitPerLine}
#define LCD_HAS_BACKLIGHT   ${p.lcd.hasBacklight ? 1 : 0}

/*============================================================================
 * 测距配置
 *============================================================================*/
#define RANGING_MAX_M       ${p.ranging.maxM.toFixed(1)}f
#define RANGING_MIN_M       ${p.ranging.minM.toFixed(2)}f
#define RANGING_PRECISION   ${p.ranging.precision.toFixed(3)}f

/*============================================================================
 * 功能开关
 *============================================================================*/
#define FEAT_SINGLE         ${p.features.single ? 1 : 0}
#define FEAT_CONTINUOUS     ${p.features.continuous ? 1 : 0}
#define FEAT_AREA           ${p.features.area ? 1 : 0}
#define FEAT_VOLUME         ${p.features.volume ? 1 : 0}
#define FEAT_PYTH           ${p.features.pyth ? 1 : 0}
#define FEAT_STAKEOUT       ${p.features.stakeout ? 1 : 0}
#define FEAT_AREA_ADD       ${p.features.areaAdd ? 1 : 0}
#define FEAT_BLUETOOTH      ${p.features.bluetooth ? 1 : 0}
#define FEAT_WIFI           ${p.features.wifi ? 1 : 0}
#define FEAT_USB            ${p.features.usb ? 1 : 0}

/*============================================================================
 * 电源配置
 *============================================================================*/
#define BATTERY_LOW_MV      ${p.power.batteryLowMv}
#define BATTERY_SHUTDOWN_MV ${p.power.batteryShutdownMv}
#define AUTO_OFF_SEC        ${p.power.autoOffSec}
#define LASER_TIMEOUT_SEC   ${p.power.laserTimeoutSec}

/*============================================================================
 * 按键配置
 *============================================================================*/
#define KEY_LONG_MS         ${p.key.longMs}
#define KEY_3S_MS           ${p.key.key3sMs}
#define KEY_DEBOUNCE_MS     ${p.key.debounceMs}

/*============================================================================
 * 包含段码映射
 *============================================================================*/
#include "lcd_seg_map.h"

#endif /* PRODUCT_H */
`;
    
    // 下载文件
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'product.h';
    a.click();
    URL.revokeObjectURL(url);
    
    alert('product.h 已生成并下载!');
}
