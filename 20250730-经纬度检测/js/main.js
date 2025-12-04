document.addEventListener('DOMContentLoaded', () => {
    const wordFilesInput = document.getElementById('wordFiles');
    const excelFileInput = document.getElementById('excelFile');
    const processBtn = document.getElementById('processBtn');
    const statusElement = document.getElementById('status');
    const resultsElement = document.getElementById('results');
    let wordFiles = [];
    let excelFile = null;
    let上期项目数据 = [];
    let本期项目经纬度列表 = []; // 存储所有本期项目的经纬度数据

    // 文件选择处理
    wordFilesInput.addEventListener('change', (e) => {
        wordFiles = Array.from(e.target.files);
        statusElement.textContent = `已选择 ${wordFiles.length} 个Word文档`;
    });

    excelFileInput.addEventListener('change', (e) => {
        excelFile = e.target.files[0];
        if (excelFile) {
            statusElement.textContent += `，已选择Excel文件: ${excelFile.name}`;
        }
    });

    processBtn.addEventListener('click', async () => {
        if (wordFiles.length === 0) {
            alert('请选择Word文档');
            return;
        }

        // 重置全局数据
        本期项目经纬度列表 = [];
        上期项目数据 = [];

        statusElement.innerHTML = '<div class="loading"></div> 处理中...';
        resultsElement.innerHTML = '';

        try {
            // 1. 处理上期Excel数据（如果有）
            if (excelFile) {
                上期项目数据 = await 处理Excel文件(excelFile);
                statusElement.innerHTML += `<br>已加载 ${上期项目数据.length} 条上期项目数据`;
            } else {
                statusElement.innerHTML += '<br>未选择Excel文件，跳过上期项目数据处理';
            }

            // 2. 处理每个Word文档
            for (const file of wordFiles) {
                await 处理Word文档(file);
            }

            // 3. 所有项目处理完成后，重新分析所有项目（确保项目间比较完整）
            resultsElement.innerHTML = '';
            for (const 项目 of 本期项目经纬度列表) {
                const resultItem = document.createElement('div');
                resultItem.className = 'result-item';
                resultItem.innerHTML = `<h3>${项目.项目名称}</h3>${分析项目数据(项目.经纬度列表, 项目.项目名称)}`;
                resultsElement.appendChild(resultItem);
            }

            statusElement.textContent = '所有文件处理完成';
        } catch (error) {
            statusElement.textContent = `处理出错: ${error.message}`;
            console.error('处理错误:', error);
        }
    });

    // Excel文件处理函数
    async function 处理Excel文件(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    // 添加选项参数，明确是否包含标题行
                    // header: 1 表示不使用首行作为标题，而是返回二维数组
                    // header: 'A' 表示使用首行作为标题
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 'A' });

                    // 处理三列数据：项目名称、经度和纬度
                    // 假设第一列是项目名称，第二列是经度，第三列是纬度
                    const 经纬度数据 = jsonData.slice(1) // 忽略首行标题
                        .filter(item => item.A && item.B && item.C) // 确保有项目名称、经度和纬度
                        .map(item => ({
                            项目名称: item.A,
                            经度: parseFloat(item.B),
                            纬度: parseFloat(item.C)
                        }));

                    resolve(经纬度数据);
                } catch (error) {
                    reject(new Error(`Excel处理错误: ${error.message}`));
                }
            };
            reader.onerror = () => reject(new Error('文件读取错误'));
            reader.readAsArrayBuffer(file);
        });
    }

    // Word文档处理函数
    async function 处理Word文档(file) {
        statusElement.innerHTML += `<br>正在处理: ${file.name}`;
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        resultItem.innerHTML = `<h3>${file.name}</h3><div class="loading"></div> 处理中...`;
        resultsElement.appendChild(resultItem);

        try {
            // 1. 使用JSZip提取Word文档中的图片
            const zip = new JSZip();
            const content = await zip.loadAsync(file);
            const images = [];

            // 遍历ZIP中的所有文件
            for (const [relativePath, zipEntry] of Object.entries(content.files)) {
                // 检查是否为图片文件
                if (zipEntry.name.match(/\.(png|jpg|jpeg|gif)$/i)) {
                    const imageData = await zipEntry.async('arraybuffer');
                    images.push({ buffer: imageData });
                }
            }
            console.log(file.name, '提取图片数量:', images.length);
            if (images.length === 0) {
                resultItem.innerHTML += '<p class="warning">警告: 未找到图片</p>';
                return;
            }

            // 2. 对每张图片进行OCR识别经纬度
            const 图片经纬度列表 = [];
            for (const image of images) {
                const 经纬度 = await 从图片提取经纬度(image);
                if (经纬度) {
                    图片经纬度列表.push(经纬度);
                }
            }

            if (图片经纬度列表.length === 0) {
                resultItem.innerHTML += '<p class="warning">警告: 未从图片中识别出经纬度</p>';
                return;
            }

            // 3. 存储当前项目经纬度数据
            本期项目经纬度列表.push({
                项目名称: file.name,
                经纬度列表: 图片经纬度列表
            });

            // 4. 分析项目数据
            const 检测结果 = 分析项目数据(图片经纬度列表, file.name);
            resultItem.innerHTML = `<h3>${file.name}</h3>${检测结果}`;
        } catch (error) {
            resultItem.innerHTML += `<p class="warning">处理错误: ${error.message}</p>`;
            console.error(`处理Word文档错误:`, error);
        }
    }

    // 从图片提取经纬度
    async function 从图片提取经纬度(image) {
        // 将图片数据转换为 base64 格式
        const imgData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result.split(',')[1]); // 只取 base64 部分
            reader.readAsDataURL(new Blob([image.buffer]));
        });

        // 使用本地 OCR 接口
        const url = 'http://127.0.0.1:1224/api/ocr';
        const data = {
            base64: imgData,
            options: {
                'ocr.language': 'models/config_chinese.txt',
                'data.format': 'text'
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: JSON.stringify(data),
                headers: { 'Content-Type': 'application/json' }
            });

            // 获取原始响应文本
            const rawText = await response.text();
            // 处理可能的转义换行符
            const normalizedText = rawText.replace(/\n/g, '\\n');

            // 解析JSON
            let result;
            try {
                result = JSON.parse(normalizedText);
            } catch (jsonError) {
                console.error('JSON解析错误:', jsonError);
                return null;
            }

            // 检查响应状态
            if (result.code !== 100) {
                console.error('OCR识别失败:', result.data || '未知错误');
                return null;
            }

            // 获取识别文本
            const text = result.data || '';
            console.log('OCR 结果:', text);

            // 优先查找有6位小数的数字
            const 六位小数匹配 = text.match(/(\d+\.\d{6})/g);
            if (六位小数匹配 && 六位小数匹配.length >= 2) {
                let 经度 = 六位小数匹配[0];
                let 纬度 = 六位小数匹配[1];

                // 去除首位的零
                经度 = 去除首位零(经度);
                纬度 = 去除首位零(纬度);

                return { 经度, 纬度 };
            }
            console.log('未识别出经纬度:', text);
            return null;
        } catch (error) {
            console.error('OCR 接口调用错误:', error);
            return null;
        }
    }

    // 去除首位的零
    function 去除首位零(numStr) {
        // 确保是字符串
        numStr = String(numStr);

        // 去除首位的零，但保留单个零和小数点后的零
        if (numStr.length > 1 && numStr[0] === '0' && numStr[1] !== '.') {
            return numStr.replace(/^0+/, '');
        }
        return numStr;
    }


    // 分析项目数据并生成检测结果
    function 分析项目数据(经纬度列表, 项目名称) {
        let html = `<p>共识别到 ${经纬度列表.length} 个经纬度</p>`;

        // 新增：展示所有经纬度并标注类型
        html += `<h4>经纬度详情:</h4>`;
        if (经纬度列表.length === 0) {
            html += `<p>未识别到任何经纬度信息</p>`;
        } else {
            // 第一个经纬度默认为投资申请表
            html += `<p>投资申请表经纬度: ${经纬度列表[0].经度}, ${经纬度列表[0].纬度}</p>`;

            // 其余经纬度标注为现场照片
            for (let i = 1; i < 经纬度列表.length; i++) {
                html += `<p>现场照片 ${i} 经纬度: ${经纬度列表[i].经度}, ${经纬度列表[i].纬度}</p>`;
            }
        }
        html += `<hr>`; // 添加分隔线区分详情和检测结果

        // 新增：单个项目中所有经纬度之间的距离计算
        if (经纬度列表.length >= 2) {
            html += `<h4>项目内距离检测:</h4>`;
            for (let i = 0; i < 经纬度列表.length; i++) {
                for (let j = i + 1; j < 经纬度列表.length; j++) {
                    const 点1 = 经纬度列表[i];
                    const 点2 = 经纬度列表[j];
                    const 距离 = 计算两点距离(
                        { 经度: parseFloat(点1.经度), 纬度: parseFloat(点1.纬度) },
                        { 经度: parseFloat(点2.经度), 纬度: parseFloat(点2.纬度) }
                    );
                    const 点1类型 = i === 0 ? '投资申请表' : `现场照片 ${i}`;
                    const 点2类型 = j === 0 ? '投资申请表' : `现场照片 ${j}`;
                    html += `<p>${点1类型} 到 ${点2类型} 的距离: ${距离.toFixed(2)} 米</p>`;
                }
            }
        }

        // 2. 与其他本期项目比较
        html += '<h4>本期项目距离检测:</h4>';
        let 过近项目 = false;
        for (const 其他项目 of 本期项目经纬度列表) {
            if (其他项目.项目名称 === 项目名称) continue; // 跳过当前项目

            for (let i = 0; i < 经纬度列表.length; i++) {
                const 本项目点 = 经纬度列表[i];
                const 本项目点类型 = i === 0 ? '投资申请表' : `现场照片 ${i}`;

                for (let j = 0; j < 其他项目.经纬度列表.length; j++) {
                    const 其他项目点 = 其他项目.经纬度列表[j];
                    const 其他项目点类型 = j === 0 ? '投资申请表' : `现场照片 ${j}`;

                    const 距离 = 计算两点距离(
                        { 经度: parseFloat(本项目点.经度), 纬度: parseFloat(本项目点.纬度) },
                        { 经度: parseFloat(其他项目点.经度), 纬度: parseFloat(其他项目点.纬度) }
                    );
                    if (距离 < 100) {
                        html += `<p class="warning">${项目名称} 的 ${本项目点类型}  与 ${其他项目.项目名称} 的 ${其他项目点类型}  距离过近: ${距离.toFixed(2)} 米</p>`;
                        过近项目 = true;
                    }
                }
            }
        }
        if (!过近项目 && 本期项目经纬度列表.length > 1) {
            html += '<p>未发现与其他本期项目距离过近的情况</p>';
        } else if (本期项目经纬度列表.length <= 1) {
            html += '<p>只有一个项目，无法进行项目间距离检测</p>';
        }

        // 3. 与上期项目比较
        html += '<h4>与上期项目距离检测:</h4>';
        let 上期近距离项目 = false;
        for (const 上期项目 of 上期项目数据) {
            for (let i = 0; i < 经纬度列表.length; i++) {
                const 本项目点 = 经纬度列表[i];
                const 本项目点类型 = i === 0 ? '投资申请表' : `现场照片 ${i}`;

                const 距离 = 计算两点距离(
                    { 经度: parseFloat(本项目点.经度), 纬度: parseFloat(本项目点.纬度) },
                    { 经度: parseFloat(上期项目.经度), 纬度: parseFloat(上期项目.纬度) }
                );
                if (距离 < 100) {
                    html += `<p class="warning"> ${项目名称} 的 ${本项目点类型} 与上期 ${上期项目.项目名称} 距离过近: ${距离.toFixed(2)} 米</p>`;
                    上期近距离项目 = true;
                }
            }
        }
        if (!上期近距离项目 && 上期项目数据.length > 0) {
            html += '<p>未发现与上期项目距离过近的情况</p>';
        } else if (上期项目数据.length === 0) {
            html += '<p>没有加载上期项目数据</p>';
        }

        return html;
    }

    // 计算两点间距离（米）
    function 计算两点距离(point1, point2) {
        // 确保经纬度是数字类型
        const lon1 = parseFloat(point1.经度);
        const lat1 = parseFloat(point1.纬度);
        const lon2 = parseFloat(point2.经度);
        const lat2 = parseFloat(point2.纬度);

        // 检查是否是有效数字
        if (isNaN(lon1) || isNaN(lat1) || isNaN(lon2) || isNaN(lat2)) {
            console.error('无效的经纬度坐标');
            return 0;
        }

        const from = turf.point([lon1, lat1]);
        const to = turf.point([lon2, lat2]);
        const options = { units: 'meters' };
        return turf.distance(from, to, options);
    }
});