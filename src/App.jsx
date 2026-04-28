import React, { useState, useRef } from 'react';
import {
  LucideStamp, LucideUploadCloud, LucideImage, LucideWand2,
  LucideShirt, LucideSettings, LucideKey, LucideDownload,
  LucideCheckCircle, LucideXCircle, LucideLoader2,
  LucideTrash2, LucideRefreshCw, LucidePlus, LucideX
} from 'lucide-react';

// ==================== CONSTANTS ====================
const PRINT_TYPES = [
  { value: 'screen_print/standard',  label: '실크스크린 (일반)',     desc: '평평하고 불투명한 잉크 면, 살짝의 잉크 두께(0.1mm), 무광~반광' },
  { value: 'screen_print/discharge', label: '디스차지 나염',          desc: '염료가 빠진 듯 부드러운 질감, 원단에 스며든 느낌, 두께감 거의 없음' },
  { value: 'screen_print/puff',      label: '발포 나염',              desc: '2~3mm 양각으로 부풀어 오른 입체감, 둥근 가장자리, 무광 고무 재질감' },
  { value: 'screen_print/glitter',   label: '글리터/포일',            desc: '금속 광택, 반사 하이라이트, 미세 글리터 입자감' },
  { value: 'screen_print/water_base',label: '워터베이스 나염',        desc: '얇고 자연스러운 잉크, 원단 결이 비치는 듯한 부드러움' },
  { value: 'screen_print/dtg_dtf',   label: 'DTG / DTF',              desc: '사진 같은 풀컬러 그라데이션, 매우 얇은 필름감, 사진 인쇄 느낌' },
  { value: 'embroidery/flat',        label: '평자수',                  desc: '실 한 가닥 한 가닥의 결, 1mm 내외 입체감, 새틴 스티치 광택' },
  { value: 'embroidery/3d',          label: '3D / 입체 자수',          desc: '폼 위에 자수, 3~5mm 두꺼운 입체, 또렷한 모서리' },
  { value: 'embroidery/patch',       label: '와펜 / 패치',             desc: '별도 천에 자수 후 부착, 가장자리 오버록, 명확한 단차' },
  { value: 'transfer/vinyl',         label: '열전사 비닐',             desc: '단색 비닐, 매끈한 표면, 또렷한 가장자리, 약간의 광택' },
  { value: 'transfer/digital',       label: '디지털 전사',             desc: '풀컬러 사진, 매우 얇은 필름, 광택 약간' },
];

const SIDES = [
  { key: 'front',        label: '앞면' },
  { key: 'back',         label: '뒷면' },
  { key: 'left_sleeve',  label: '좌소매' },
  { key: 'right_sleeve', label: '우소매' },
];

// 면별 세로 위치 옵션 (value는 공통, label은 면별로 다름)
const OFFSET_Y_BY_SIDE = {
  front: [
    { value: 'top',    label: '가슴 위' },
    { value: 'center', label: '가슴 중앙' },
    { value: 'bottom', label: '가슴 아래' },
  ],
  back: [
    { value: 'top',    label: '등 위 (목 아래)' },
    { value: 'center', label: '등 중앙' },
    { value: 'bottom', label: '허리 부근' },
  ],
  left_sleeve: [
    { value: 'top',    label: '어깨 부근' },
    { value: 'center', label: '소매 중간' },
    { value: 'bottom', label: '소매 끝' },
  ],
  right_sleeve: [
    { value: 'top',    label: '어깨 부근' },
    { value: 'center', label: '소매 중간' },
    { value: 'bottom', label: '소매 끝' },
  ],
};

// 면별 좌우 옵션 (소매는 좌우 의미가 약해서 단일 옵션)
const OFFSET_X_BY_SIDE = {
  front: [
    { value: 'left',   label: '좌측 가슴' },
    { value: 'center', label: '중앙' },
    { value: 'right',  label: '우측 가슴' },
  ],
  back: [
    { value: 'left',   label: '왼쪽' },
    { value: 'center', label: '중앙' },
    { value: 'right',  label: '오른쪽' },
  ],
  left_sleeve:  [{ value: 'center', label: '소매 중앙' }],
  right_sleeve: [{ value: 'center', label: '소매 중앙' }],
};

// 결과 view: 각 view는 그 면에 직접 배치된 프린트만 보임
// (소매 측면 프린트는 정면/후면에서 보이지 않음 — 각 view는 그 시점에서 자연스럽게 보이는 것만)
const VIEWS = [
  {
    key: 'front_view',
    label: '정면',
    includes: ['front'],
    viewInstruction: '의류의 정면이 보이는 시점. 앞면 가슴이 정면에서 보이는 컷.',
  },
  {
    key: 'back_view',
    label: '후면',
    includes: ['back'],
    viewInstruction: '의류의 뒷면이 보이는 시점. 등판이 정면에서 보이는 후면 컷.',
  },
  {
    key: 'left_view',
    label: '좌측면',
    includes: ['left_sleeve'],
    viewInstruction: '의류의 왼쪽 측면이 보이는 시점. 왼팔 소매의 바깥쪽(측면)이 카메라를 향한 사이드 뷰.',
  },
  {
    key: 'right_view',
    label: '우측면',
    includes: ['right_sleeve'],
    viewInstruction: '의류의 오른쪽 측면이 보이는 시점. 오른팔 소매의 바깥쪽(측면)이 카메라를 향한 사이드 뷰.',
  },
];

const MODEL_ID = 'gemini-3.1-flash-image-preview';

// ==================== UTILITIES ====================
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const fetchWithRetry = async (url, options, retries = 2, backoff = 1500) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 && i === retries) throw new Error('Rate Limit 초과. 잠시 후 다시 시도');
      if (res.status < 500 && res.status !== 429) return res;
      if (i < retries) { await delay(backoff * Math.pow(2, i)); continue; }
      return res;
    } catch (e) {
      if (i < retries) { await delay(backoff * Math.pow(2, i)); continue; }
      throw e;
    }
  }
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const compressImage = (dataUrl, maxWidth = 2048, quality = 0.92) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth; }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    resolve(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = reject;
  img.src = dataUrl;
});

// 1:1 정사각형으로 패딩 (흰 배경) + 고화질 압축
const squareCompressImage = (dataUrl, size = 2048, quality = 0.92) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const out = Math.min(size, Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = out; canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out, out);
    ctx.imageSmoothingQuality = 'high';
    const scale = Math.min(out / img.width, out / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (out - w) / 2, (out - h) / 2, w, h);
    resolve(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = reject;
  img.src = dataUrl;
});

const stripBase64 = (dataUrl) => dataUrl.split(',')[1];

// ==================== GEMINI API ====================
const callGemini = async ({ apiKey, parts, expectImage }) => {
  if (!apiKey) throw new Error('API Key가 설정되지 않았습니다');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: expectImage ? ['TEXT', 'IMAGE'] : ['TEXT'] }
  };
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('응답 파싱 실패'); }
  if (!res.ok) throw new Error(`API ${res.status}: ${data?.error?.message || raw}`);
  if (data?.error) throw new Error(data.error.message);
  return data;
};

const analyzePrint = async ({ apiKey, printImageDataUrl }) => {
  const prompt = `이 이미지는 의류에 사용되는 프린트(또는 자수)의 클로즈업 사진입니다.
다음 종류 중 가장 가까운 것을 정확히 1개 선택하세요.

종류 목록 (value: 설명):
${PRINT_TYPES.map(t => `- ${t.value}: ${t.label} — ${t.desc}`).join('\n')}

판단 근거(광택, 입체감, 실 구조, 잉크 두께, 가장자리 등)를 1~2문장으로 적어주세요.

반드시 다음 JSON 형식으로만 응답:
{"type": "<위 value 중 하나>", "notes": "<판단 근거>"}`;

  const data = await callGemini({
    apiKey,
    parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64(printImageDataUrl) } }
    ],
    expectImage: false
  });
  const text = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('분석 결과 파싱 실패');
  const parsed = JSON.parse(match[0]);
  if (!PRINT_TYPES.find(t => t.value === parsed.type)) {
    parsed.type = 'screen_print/standard';
  }
  return parsed;
};

// items: [{ printImage, printType, placement: { side, widthCm, offsetY, offsetX } }]
const composeView = async ({
  apiKey, productImageDataUrl, items, chestCm, lengthCm,
  viewLabel, viewInstruction
}) => {
  const chestNum = Number(chestCm);

  const itemBlocks = items.map((item, i) => {
    const idx = i + 1;
    const { placement, printType } = item;
    const typeInfo = PRINT_TYPES.find(t => t.value === printType);
    const sideLabel = SIDES.find(s => s.key === placement.side)?.label || placement.side;
    const yLabel = OFFSET_Y_BY_SIDE[placement.side]?.find(o => o.value === placement.offsetY)?.label || '';
    const xLabel = OFFSET_X_BY_SIDE[placement.side]?.find(o => o.value === placement.offsetX)?.label || '';
    const widthNum = Number(placement.widthCm);
    const ratioPct = chestNum > 0 ? Math.round((widthNum / chestNum) * 100) : null;
    const xExtra = (placement.side === 'front' && placement.offsetX === 'left') ? ' (착용자 기준 왼쪽 가슴 = 보는 사람 기준 오른쪽, 좌측 가슴 로고 위치)'
                 : (placement.side === 'front' && placement.offsetX === 'right') ? ' (착용자 기준 오른쪽 가슴)' : '';
    return `${idx}) ${sideLabel} - ${yLabel}${xLabel ? ', ' + xLabel : ''}${xExtra}
   - 사용할 프린트: [프린트 이미지 #${idx}]
   - 가로 실측: ${widthNum}cm${ratioPct ? ` (의류 가슴폭 ${chestNum}cm의 ${ratioPct}%)` : ''}
   - 재질: ${typeInfo?.label} — ${typeInfo?.desc}`;
  }).join('\n\n');

  const isMulti = items.length > 1;
  const prompt = `[제품 이미지] 다음에 ${items.length}개의 [프린트 이미지 #N]가 순서대로 옵니다.

제품 실측: 가슴단면 ${chestCm}cm, 총장 ${lengthCm}cm

배치:
${itemBlocks}

결과 조건:
- 시점: ${viewInstruction}
- ${isMulti ? `${viewLabel}에서 자연스럽게 보이는 모든 프린트가 같은 한 장의 사진에 함께 합성되어야 함` : `${viewLabel}에서 보이는 프린트만 자연스럽게 합성`}
- 출력 비율은 정확히 1:1 정사각형
- 각 프린트의 크기는 위 비율을 정확히 지킬 것 (임의로 키우거나 줄이지 마세요)
- 원단의 주름, 음영, 결을 프린트 위에 자연스럽게 반영
- 제품 자체(실루엣, 색상, 배경, 조명)는 절대 수정 금지
- 화질을 최대한 선명하게, 디테일이 살아있도록`;

  const parts = [
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: stripBase64(productImageDataUrl) } },
    ...items.map(item => ({ inlineData: { mimeType: 'image/jpeg', data: stripBase64(item.printImage) } })),
  ];

  const data = await callGemini({ apiKey, parts, expectImage: true });
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (imgPart?.inlineData?.data) return `data:image/jpeg;base64,${imgPart.inlineData.data}`;
  const txtPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  throw new Error(txtPart || '이미지가 생성되지 않았습니다');
};

// ==================== UI HELPERS ====================
const ImageDropZone = ({ value, onChange, label, icon: Icon, height = 'aspect-square', square = false }) => {
  const inputRef = useRef(null);
  const handleFile = async (file) => {
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const processed = square ? await squareCompressImage(dataUrl) : await compressImage(dataUrl);
    onChange(processed);
  };
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
        className={`${height} border-2 border-dashed cursor-pointer flex items-center justify-center overflow-hidden transition-colors ${
          value ? 'border-black bg-white' : 'border-gray-300 hover:border-black hover:bg-gray-50'
        }`}
      >
        {value ? (
          <img src={value} alt={label} className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400 text-xs">
            <Icon className="w-6 h-6" />
            <span>{label}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== APP ====================
export default function App() {
  const [productImage, setProductImage] = useState(null);
  const [productSize, setProductSize] = useState({ chest: '', length: '' });
  const [prints, setPrints] = useState([]); // [{ id, image, analysis, analyzing, error }]
  const [placements, setPlacements] = useState([]); // [{ side, printId, widthCm, offsetY, offsetX }]
  const [results, setResults] = useState({}); // { [side]: { status, dataUrl, error } }
  const [isComposing, setIsComposing] = useState(false);
  const [notification, setNotification] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('print_composer_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // ---------- print pool handlers ----------
  const addPrint = async (dataUrl) => {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newPrint = { id, image: dataUrl, analysis: null, analyzing: true, error: null };
    setPrints(prev => [...prev, newPrint]);
    if (!apiKey) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: 'API Key 미설정' } : p));
      return;
    }
    try {
      const analysis = await analyzePrint({ apiKey, printImageDataUrl: dataUrl });
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analysis, analyzing: false } : p));
    } catch (e) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: e.message } : p));
    }
  };

  const reanalyzePrint = async (id) => {
    const target = prints.find(p => p.id === id);
    if (!target || !apiKey) return;
    setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: true, error: null } : p));
    try {
      const analysis = await analyzePrint({ apiKey, printImageDataUrl: target.image });
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analysis, analyzing: false } : p));
    } catch (e) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: e.message } : p));
    }
  };

  const updatePrintType = (id, newType) => {
    setPrints(prev => prev.map(p => p.id === id
      ? { ...p, analysis: { ...(p.analysis || {}), type: newType, notes: p.analysis?.notes || '수동 지정' } }
      : p));
  };

  const removePrint = (id) => {
    setPrints(prev => prev.filter(p => p.id !== id));
    setPlacements(prev => prev.filter(pl => pl.printId !== id));
  };

  // ---------- placement handlers ----------
  const togglePlacement = (side) => {
    setPlacements(prev => {
      const has = prev.find(pl => pl.side === side);
      if (has) return prev.filter(pl => pl.side !== side);
      const defaultWidth = (side === 'left_sleeve' || side === 'right_sleeve') ? 8 : 25;
      const defaultPrintId = prints[0]?.id || null;
      return [...prev, { side, printId: defaultPrintId, widthCm: defaultWidth, offsetY: 'center', offsetX: 'center' }];
    });
  };

  const updatePlacement = (side, field, value) => {
    setPlacements(prev => prev.map(pl => pl.side === side ? { ...pl, [field]: value } : pl));
  };

  // ---------- compose ----------
  const handleCompose = async () => {
    if (!apiKey) return showNotification('API Key를 먼저 설정하세요', 'error');
    if (!productImage) return showNotification('제품컷을 업로드하세요', 'error');
    if (!productSize.chest || !productSize.length) return showNotification('가슴/총장 사이즈를 입력하세요', 'error');
    if (prints.length === 0) return showNotification('프린트를 1개 이상 업로드하세요', 'error');
    if (placements.length === 0) return showNotification('배치할 위치를 선택하세요', 'error');

    // placement별 print 매핑 + 분석 완료 확인
    for (const pl of placements) {
      const print = prints.find(p => p.id === pl.printId);
      if (!print) return showNotification(`${SIDES.find(s => s.key === pl.side)?.label}: 프린트가 선택되지 않음`, 'error');
      if (!print.analysis) return showNotification('아직 분석 중인 프린트가 있습니다', 'error');
    }

    // view별로 그 시점에서 보이는 placement들을 묶기
    const viewJobs = [];
    for (const view of VIEWS) {
      const items = placements
        .filter(pl => view.includes.includes(pl.side))
        .map(pl => {
          const print = prints.find(p => p.id === pl.printId);
          return { placement: pl, printImage: print.image, printType: print.analysis.type };
        });
      if (items.length > 0) viewJobs.push({ view, items });
    }
    if (viewJobs.length === 0) return showNotification('합성할 view가 없습니다', 'error');

    setIsComposing(true);
    const initial = {};
    viewJobs.forEach(({ view }) => { initial[view.key] = { status: 'pending' }; });
    setResults(initial);

    await Promise.all(viewJobs.map(async ({ view, items }) => {
      try {
        const dataUrl = await composeView({
          apiKey,
          productImageDataUrl: productImage,
          items,
          chestCm: productSize.chest,
          lengthCm: productSize.length,
          viewLabel: view.label,
          viewInstruction: view.viewInstruction,
        });
        setResults(r => ({ ...r, [view.key]: { status: 'done', dataUrl } }));
      } catch (e) {
        setResults(r => ({ ...r, [view.key]: { status: 'error', error: e.message } }));
      }
    }));

    setIsComposing(false);
    showNotification('합성 완료');
  };

  const downloadResult = (side, dataUrl) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `print_composer_${side}_${Date.now()}.jpg`;
    a.click();
  };

  const downloadAll = () => {
    Object.entries(results).forEach(([side, r], i) => {
      if (r.status === 'done') setTimeout(() => downloadResult(side, r.dataUrl), i * 200);
    });
  };

  // ==================== RENDER ====================
  return (
    <div className="flex flex-col h-screen bg-white text-black font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-white border-b border-black flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-black flex items-center justify-center">
            <LucideStamp className="w-5 h-5 text-white" />
          </div>
          <span className="font-extrabold text-xl tracking-tighter uppercase">Print Composer</span>
          <span className="text-xs text-gray-500 uppercase tracking-wider hidden md:inline">제품컷에 프린트 합성</span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold border rounded-full transition-colors ${
            apiKey ? 'bg-black text-white border-black' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200 hover:text-black'
          }`}
        >
          <LucideKey className="w-3 h-3" />
          <span>{apiKey ? 'API Key 설정됨' : 'API Key 설정'}</span>
        </button>
      </header>

      {/* Main 3-column layout */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden">

        {/* ============ Column 1: Inputs ============ */}
        <section className="col-span-3 border-r border-black overflow-y-auto p-5 bg-white">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">1. 입력</h2>

          <div className="space-y-6">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">제품컷</label>
              <ImageDropZone
                value={productImage}
                onChange={setProductImage}
                label="제품 이미지 업로드"
                icon={LucideUploadCloud}
                square
              />
              <p className="text-[10px] text-gray-400 mt-1">자동으로 1:1 정사각형으로 변환</p>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">제품 사이즈 (cm)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <input type="number" placeholder="가슴" value={productSize.chest}
                    onChange={(e) => setProductSize(p => ({ ...p, chest: e.target.value }))}
                    className="w-full border border-black px-3 py-2 text-sm focus:outline-none focus:bg-gray-50" />
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-1 block">가슴단면</span>
                </div>
                <div>
                  <input type="number" placeholder="총장" value={productSize.length}
                    onChange={(e) => setProductSize(p => ({ ...p, length: e.target.value }))}
                    className="w-full border border-black px-3 py-2 text-sm focus:outline-none focus:bg-gray-50" />
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider mt-1 block">총장</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">프린트 풀</label>
              {prints.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {prints.map((p, idx) => (
                    <div key={p.id} className="relative group aspect-square border border-black bg-gray-50 overflow-hidden">
                      <img src={p.image} alt="" className="w-full h-full object-contain" />
                      <div className="absolute top-0.5 left-0.5 bg-black text-white text-[9px] font-bold px-1">#{idx + 1}</div>
                      {p.analyzing && (
                        <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                          <LucideLoader2 className="w-4 h-4 animate-spin text-black" />
                        </div>
                      )}
                      <button onClick={() => removePrint(p.id)}
                        className="absolute top-0.5 right-0.5 bg-white border border-black p-0.5 opacity-0 group-hover:opacity-100 hover:bg-black hover:text-white">
                        <LucideX className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <ImageDropZone
                value={null}
                onChange={addPrint}
                label="프린트 추가"
                icon={LucidePlus}
              />
              <p className="text-[10px] text-gray-400 mt-2">여러 장 업로드 가능 · 자동 분석</p>
            </div>
          </div>
        </section>

        {/* ============ Column 2: Analysis & Placement ============ */}
        <section className="col-span-5 border-r border-black overflow-y-auto p-5 bg-white">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">2. 분석 / 배치</h2>

          {prints.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-20 border border-dashed border-gray-200">
              <LucideWand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>프린트를 업로드하면<br />여기에 분석 결과와 배치 옵션이 표시됩니다</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Analysis cards (per print) */}
              <div className="space-y-2">
                {prints.map((p, idx) => (
                  <div key={p.id} className="border border-black p-3 bg-white">
                    <div className="flex items-start gap-3">
                      <div className="w-14 h-14 border border-gray-200 shrink-0 overflow-hidden bg-gray-50">
                        <img src={p.image} alt="" className="w-full h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider">프린트 #{idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => reanalyzePrint(p.id)} disabled={p.analyzing}
                              className="p-1 hover:bg-gray-100 disabled:opacity-30" title="다시 분석">
                              <LucideRefreshCw className={`w-3.5 h-3.5 ${p.analyzing ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={() => removePrint(p.id)}
                              className="p-1 hover:bg-gray-100 text-gray-400 hover:text-black" title="삭제">
                              <LucideTrash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {p.analyzing ? (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <LucideLoader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>분석 중...</span>
                          </div>
                        ) : p.error ? (
                          <div className="text-xs text-red-600">{p.error}</div>
                        ) : p.analysis ? (
                          <div>
                            <select value={p.analysis.type}
                              onChange={(e) => updatePrintType(p.id, e.target.value)}
                              className="text-xs border border-gray-300 px-2 py-1 w-full focus:outline-none focus:border-black">
                              {PRINT_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                            {p.analysis.notes && (
                              <p className="text-[10px] text-gray-500 mt-1 leading-relaxed line-clamp-2">{p.analysis.notes}</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Placement cards */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">위치 / 크기</div>
                <div className="grid grid-cols-2 gap-2">
                  {SIDES.map(side => {
                    const placement = placements.find(pl => pl.side === side.key);
                    const checked = !!placement;
                    const yOpts = OFFSET_Y_BY_SIDE[side.key] || [];
                    const xOpts = OFFSET_X_BY_SIDE[side.key] || [];
                    const isSleeve = side.key === 'left_sleeve' || side.key === 'right_sleeve';
                    return (
                      <div key={side.key} className={`border p-3 ${checked ? 'border-black bg-gray-50' : 'border-gray-200'}`}>
                        <label className="flex items-center gap-2 cursor-pointer mb-1">
                          <input type="checkbox" checked={checked}
                            onChange={() => togglePlacement(side.key)}
                            className="accent-black" />
                          <span className="text-sm font-bold">{side.label}</span>
                        </label>
                        {checked && (
                          <div className="space-y-2 mt-3">
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">프린트 선택</span>
                              <div className="grid grid-cols-4 gap-1 mt-0.5">
                                {prints.map((p, idx) => (
                                  <button key={p.id}
                                    onClick={() => updatePlacement(side.key, 'printId', p.id)}
                                    className={`aspect-square border overflow-hidden bg-white relative ${
                                      placement.printId === p.id ? 'border-black border-2' : 'border-gray-200 hover:border-gray-400'
                                    }`}
                                    title={`프린트 #${idx + 1}`}>
                                    <img src={p.image} alt="" className="w-full h-full object-contain" />
                                    <div className="absolute top-0 left-0 bg-black text-white text-[8px] font-bold px-0.5">{idx + 1}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="number" value={placement.widthCm} min="1" max={isSleeve ? 15 : 60}
                                onChange={(e) => updatePlacement(side.key, 'widthCm', Number(e.target.value))}
                                className="w-16 border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:border-black" />
                              <span className="text-[11px] text-gray-500">cm 가로 (그래픽 실측)</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase tracking-wider">세로</span>
                              <select value={placement.offsetY}
                                onChange={(e) => updatePlacement(side.key, 'offsetY', e.target.value)}
                                className="w-full text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black mt-0.5">
                                {yOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            {xOpts.length > 1 && (
                              <div>
                                <span className="text-[10px] text-gray-400 uppercase tracking-wider">좌우</span>
                                <select value={placement.offsetX}
                                  onChange={(e) => updatePlacement(side.key, 'offsetX', e.target.value)}
                                  className="w-full text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black mt-0.5">
                                  {xOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleCompose}
            disabled={isComposing || prints.length === 0 || placements.length === 0}
            className="w-full mt-4 py-3 bg-black text-white text-sm font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-gray-800 flex items-center justify-center gap-2"
          >
            {isComposing ? <><LucideLoader2 className="w-4 h-4 animate-spin" /> 합성 중...</> : <><LucideWand2 className="w-4 h-4" /> 합성 생성</>}
          </button>
        </section>

        {/* ============ Column 3: Results ============ */}
        <section className="col-span-4 overflow-y-auto p-5 bg-gray-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">3. 결과</h2>
            {Object.values(results).some(r => r.status === 'done') && (
              <button onClick={downloadAll}
                className="text-[10px] font-bold uppercase tracking-wider border border-black px-2 py-1 hover:bg-black hover:text-white flex items-center gap-1">
                <LucideDownload className="w-3 h-3" /> 전체
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {VIEWS.map(view => {
              const r = results[view.key];
              return (
                <div key={view.key} className="aspect-square bg-white border border-gray-200 flex flex-col relative overflow-hidden">
                  {!r ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                      <LucideShirt className="w-8 h-8 mb-1" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">{view.label}</span>
                    </div>
                  ) : r.status === 'pending' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                      <LucideLoader2 className="w-6 h-6 animate-spin mb-1" />
                      <span className="text-[11px] font-bold uppercase tracking-wider">{view.label}</span>
                    </div>
                  ) : r.status === 'error' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-red-500 px-2 text-center">
                      <LucideXCircle className="w-6 h-6 mb-1" />
                      <span className="text-[11px] font-bold uppercase tracking-wider mb-1">{view.label}</span>
                      <span className="text-[9px] text-red-400 leading-tight">{r.error}</span>
                    </div>
                  ) : (
                    <>
                      <img src={r.dataUrl} alt={view.label} className="w-full h-full object-contain" />
                      <div className="absolute top-1 left-1 bg-black text-white text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
                        {view.label}
                      </div>
                      <button onClick={() => downloadResult(view.key, r.dataUrl)}
                        className="absolute bottom-1 right-1 bg-black text-white p-1 hover:bg-gray-800">
                        <LucideDownload className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Notification */}
      {notification && (
        <div className={`fixed bottom-6 right-6 px-6 py-4 border-2 border-black shadow-lg z-[999] flex items-center gap-2 ${
          notification.type === 'error' ? 'bg-white text-black' : 'bg-black text-white'
        }`}>
          {notification.type === 'error' ? <LucideXCircle className="w-5 h-5" /> : <LucideCheckCircle className="w-5 h-5" />}
          <span className="font-bold text-sm uppercase">{notification.message}</span>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000]" onClick={() => setShowSettings(false)}>
          <div className="bg-white border-2 border-black p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-lg uppercase tracking-tighter flex items-center gap-2">
                <LucideSettings className="w-5 h-5" /> 설정
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-black">
                <LucideX className="w-5 h-5" />
              </button>
            </div>
            <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">Gemini API Key</label>
            <input type="password" value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); localStorage.setItem('print_composer_api_key', e.target.value); }}
              className="w-full border border-black px-3 py-2 text-sm focus:outline-none focus:bg-gray-50"
              placeholder="AIza..." />
            <p className="text-[10px] text-gray-400 mt-2">localStorage에 저장됩니다 · Google AI Studio에서 발급</p>
          </div>
        </div>
      )}
    </div>
  );
}
