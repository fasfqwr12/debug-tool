/**
 * UnitConverter - 单位转换工具
 * 
 * 设计原则:
 * 1. 存储原始值（米/平方米/立方米）- 不丢失精度
 * 2. 显示时转换 - 根据当前单位
 * 3. 计算用显示值 - 保证屏幕显示和计算结果一致
 * 4. 结果转回米存储
 * 
 * 单位索引: 0=m, 1=ft, 2=in, 3=ft+in
 */

window.UnitConverter = {
    
    // ========== 转换因子 ==========
    
    // 长度: 1米 = x单位
    LENGTH_FACTORS: {
        0: 1,           // m
        1: 3.28084,     // ft
        2: 39.3701,     // in
        3: 3.28084      // ft+in (先转ft，再分离)
    },
    
    // 面积: 1平方米 = x单位
    AREA_FACTORS: {
        0: 1,           // m²
        1: 10.7639,     // ft²
        2: 1550.0031,   // in²
        3: 10.7639      // ft²+in² (先转ft²)
    },
    
    // 体积: 1立方米 = x单位
    VOLUME_FACTORS: {
        0: 1,           // m³
        1: 35.3147,     // ft³
        2: 61023.7441,  // in³
        3: 35.3147      // ft³+in³
    },
    
    // 小数位数配置
    DECIMALS: {
        length: { 0: 3, 1: 3, 2: 2, 3: 0 },   // m:3位, ft:3位, in:2位, ft+in:0位
        area:   { 0: 3, 1: 3, 2: 2, 3: 0 },
        volume: { 0: 3, 1: 3, 2: 2, 3: 0 }
    },
    
    // 单位符号
    UNIT_SYMBOLS: {
        length: { 0: 'm', 1: 'ft', 2: 'in', 3: 'ft+in' },
        area:   { 0: 'm²', 1: 'ft²', 2: 'in²', 3: 'ft²' },
        volume: { 0: 'm³', 1: 'ft³', 2: 'in³', 3: 'ft³' }
    },
    
    // ========== 核心转换方法 ==========
    
    /**
     * 米转显示值
     * @param {number} valueInMeters - 原始值（米/平方米/立方米）
     * @param {number} unitIndex - 单位索引 (0=m, 1=ft, 2=in, 3=ft+in)
     * @param {string} dataType - 数据类型 ('length'|'area'|'volume')
     * @returns {object} { value: number, display: string, decimals: number }
     */
    toDisplay(valueInMeters, unitIndex = 0, dataType = 'length') {
        if (valueInMeters === null || valueInMeters === undefined || isNaN(valueInMeters)) {
            return { value: 0, display: '0', decimals: this.getDecimals(unitIndex, dataType) };
        }
        
        const factor = this.getFactor(unitIndex, dataType);
        const decimals = this.getDecimals(unitIndex, dataType);
        
        // 转换
        let converted = valueInMeters * factor;
        
        // 保留小数位
        const rounded = this.roundTo(converted, decimals);
        
        // ft+in 特殊处理
        if (unitIndex === 3 && dataType === 'length') {
            return this.toFeetInches(valueInMeters);
        }
        
        return {
            value: rounded,
            display: this.formatNumber(rounded, decimals),
            decimals: decimals
        };
    },
    
    /**
     * 显示值转米
     * @param {number} displayValue - 显示值
     * @param {number} unitIndex - 单位索引
     * @param {string} dataType - 数据类型
     * @returns {number} 米/平方米/立方米
     */
    toMeters(displayValue, unitIndex = 0, dataType = 'length') {
        if (displayValue === null || displayValue === undefined || isNaN(displayValue)) {
            return 0;
        }
        
        const factor = this.getFactor(unitIndex, dataType);
        return displayValue / factor;
    },
    
    /**
     * 获取转换因子
     */
    getFactor(unitIndex, dataType) {
        switch (dataType) {
            case 'area': return this.AREA_FACTORS[unitIndex] || 1;
            case 'volume': return this.VOLUME_FACTORS[unitIndex] || 1;
            default: return this.LENGTH_FACTORS[unitIndex] || 1;
        }
    },
    
    /**
     * 获取小数位数
     */
    getDecimals(unitIndex, dataType) {
        const config = this.DECIMALS[dataType] || this.DECIMALS.length;
        return config[unitIndex] !== undefined ? config[unitIndex] : 3;
    },
    
    /**
     * 获取单位符号
     */
    getSymbol(unitIndex, dataType = 'length') {
        const symbols = this.UNIT_SYMBOLS[dataType] || this.UNIT_SYMBOLS.length;
        return symbols[unitIndex] || 'm';
    },
    
    // ========== 计算方法（使用显示值计算）==========
    
    /**
     * 计算面积 (长×宽)
     * 使用显示值计算，保证屏幕显示一致
     * @param {number} lengthMeters - 长度（米）
     * @param {number} widthMeters - 宽度（米）
     * @param {number} unitIndex - 当前单位
     * @returns {number} 面积（平方米）
     */
    calcArea(lengthMeters, widthMeters, unitIndex = 0) {
        // 1. 转换为显示值
        const lengthDisplay = this.toDisplay(lengthMeters, unitIndex, 'length');
        const widthDisplay = this.toDisplay(widthMeters, unitIndex, 'length');
        
        // 2. 用显示值计算面积（显示单位下的面积）
        const areaDisplay = lengthDisplay.value * widthDisplay.value;
        
        // 3. 转回平方米存储
        const areaFactor = this.AREA_FACTORS[unitIndex] || 1;
        return areaDisplay / areaFactor;
    },
    
    /**
     * 计算体积 (长×宽×高)
     * @param {number} lengthMeters - 长度（米）
     * @param {number} widthMeters - 宽度（米）
     * @param {number} heightMeters - 高度（米）
     * @param {number} unitIndex - 当前单位
     * @returns {number} 体积（立方米）
     */
    calcVolume(lengthMeters, widthMeters, heightMeters, unitIndex = 0) {
        // 1. 转换为显示值
        const lengthDisplay = this.toDisplay(lengthMeters, unitIndex, 'length');
        const widthDisplay = this.toDisplay(widthMeters, unitIndex, 'length');
        const heightDisplay = this.toDisplay(heightMeters, unitIndex, 'length');
        
        // 2. 用显示值计算体积
        const volumeDisplay = lengthDisplay.value * widthDisplay.value * heightDisplay.value;
        
        // 3. 转回立方米存储
        const volumeFactor = this.VOLUME_FACTORS[unitIndex] || 1;
        return volumeDisplay / volumeFactor;
    },
    
    /**
     * 勾股定理计算
     * @param {number} aMeters - 边a（米）
     * @param {number} bMeters - 边b（米）
     * @param {number} unitIndex - 当前单位
     * @returns {number} 斜边c（米）
     */
    calcPythagorean(aMeters, bMeters, unitIndex = 0) {
        // 用显示值计算
        const aDisplay = this.toDisplay(aMeters, unitIndex, 'length');
        const bDisplay = this.toDisplay(bMeters, unitIndex, 'length');
        
        const cDisplay = Math.sqrt(aDisplay.value * aDisplay.value + bDisplay.value * bDisplay.value);
        
        // 转回米
        const factor = this.LENGTH_FACTORS[unitIndex] || 1;
        return cDisplay / factor;
    },
    
    // ========== 工具方法 ==========
    
    /**
     * 四舍五入到指定小数位
     */
    roundTo(value, decimals) {
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    },
    
    /**
     * 格式化数字为字符串
     */
    formatNumber(value, decimals) {
        return value.toFixed(decimals);
    },
    
    /**
     * 米转英尺+英寸
     */
    toFeetInches(meters) {
        const totalInches = meters * 39.3701;
        const feet = Math.floor(totalInches / 12);
        const inches = this.roundTo(totalInches % 12, 1);
        
        return {
            value: meters,
            feet: feet,
            inches: inches,
            display: `${feet}'${inches}"`,
            decimals: 0
        };
    },
    
    /**
     * 英尺+英寸转米
     */
    feetInchesToMeters(feet, inches) {
        const totalInches = feet * 12 + inches;
        return totalInches / 39.3701;
    }
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.UnitConverter;
}
