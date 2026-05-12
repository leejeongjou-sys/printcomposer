import React, { useState, useRef } from 'react';
import {
  LucideStamp, LucideUploadCloud, LucideImage, LucideWand2,
  LucideShirt, LucideSettings, LucideKey, LucideDownload,
  LucideCheckCircle, LucideXCircle, LucideLoader2,
  LucideTrash2, LucideRefreshCw, LucidePlus, LucideX,
  LucideFileText, LucideArrowUp, LucideArrowDown
} from 'lucide-react';
import html2canvas from 'html2canvas';

// ==================== CONSTANTS ====================
const PRINT_TYPES = [
  { value: 'screen_print', label: '나염', desc: '잉크가 원단 표면에 인쇄된 형태. 평평하거나 살짝 두께감 있는 잉크 면, 무광~반광 표면. 픽셀 수준의 또렷한 가장자리.' },
  { value: 'embroidery',   label: '자수', desc: '실이 원단에 박혀 입체감을 만드는 형태. 실 한 가닥 한 가닥의 결과 새틴 스티치 광택, 1~3mm 입체, 가장자리에 실 마무리.' },
];

const SIDES = [
  { key: 'front', label: '앞면' },
  { key: 'back',  label: '뒷면' },
];

// 면별 세로 위치 옵션
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
};

// 면별 좌우 옵션
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
};

// 결과 view 정의 — 정면/후면 2개
const VIEWS = [
  {
    key: 'front_view',
    label: '정면',
    sides: ['front'],
    viewInstruction: '의류의 정면이 보이는 시점. 앞면 가슴이 정면에서 보이는 컷.',
  },
  {
    key: 'back_view',
    label: '후면',
    sides: ['back'],
    viewInstruction: '의류의 뒷면이 보이는 시점. 등판이 정면에서 보이는 후면 컷.',
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

// 입력 이미지의 가장 가까운 Gemini 지원 비율 감지
const detectClosestAspect = (dataUrl) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const r = img.width / img.height;
    const supported = [
      { name: '1:1',  val: 1 },
      { name: '3:4',  val: 0.75 },
      { name: '4:3',  val: 4 / 3 },
      { name: '9:16', val: 9 / 16 },
      { name: '16:9', val: 16 / 9 },
    ];
    let best = supported[0], minDiff = Infinity;
    for (const s of supported) {
      const d = Math.abs(s.val - r);
      if (d < minDiff) { minDiff = d; best = s; }
    }
    resolve(best.name);
  };
  img.onerror = () => resolve('1:1');
  img.src = dataUrl;
});

const stripBase64 = (dataUrl) => dataUrl.split(',')[1];

// ==================== GEMINI API ====================
const callGemini = async ({ apiKey, parts, expectImage, imageConfig }) => {
  if (!apiKey) throw new Error('API Key가 설정되지 않았습니다');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${apiKey}`;
  const generationConfig = {
    responseModalities: expectImage ? ['TEXT', 'IMAGE'] : ['TEXT']
  };
  if (expectImage && imageConfig) {
    generationConfig.imageConfig = imageConfig;
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig
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

작업 1: 종류 판별
다음 종류 중 가장 가까운 것을 정확히 1개 선택하세요.

종류 목록 (value: 설명):
${PRINT_TYPES.map(t => `- ${t.value}: ${t.label} — ${t.desc}`).join('\n')}

판단 근거(광택, 입체감, 실 구조, 잉크 두께, 가장자리 등)를 1~2문장으로 적어주세요.

작업 2: 위치 추천
이 프린트가 의류의 어디에 들어가는 게 일반적·자연스러운지 추천하세요.
- side: "front" (앞면 — 가슴, 앞판) 또는 "back" (뒷면 — 등판)
- vertical: "top" / "center" / "bottom"
- horizontal: "left" / "center" / "right"
- width_pct: 의류 가로 폭 대비 프린트 가로 폭의 % (정수)
  - 작은 가슴 로고/와펜류: 8-15
  - 중간 가슴 그래픽: 18-30
  - 등판 큰 그래픽/대형 레터링: 40-70
판단 기준: 그래픽의 종류·크기·복잡도·텍스트 유무·일반적인 의류 디자인 관행.

반드시 다음 JSON 형식으로만 응답:
{
  "type": "<위 value 중 하나>",
  "notes": "<판단 근거>",
  "suggested_placement": {
    "side": "front" | "back",
    "vertical": "top" | "center" | "bottom",
    "horizontal": "left" | "center" | "right",
    "width_pct": <integer>
  }
}`;

  const data = await callGemini({
    apiKey,
    parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64(printImageDataUrl) } }
    ],
    expectImage: false
  });
  const text = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('분석 결과 파싱 실패');
  const parsed = JSON.parse(match[0]);
  if (!PRINT_TYPES.find(t => t.value === parsed.type)) {
    parsed.type = 'screen_print';
  }
  // suggested_placement 검증
  if (parsed.suggested_placement) {
    const sp = parsed.suggested_placement;
    if (!['front', 'back'].includes(sp.side)) sp.side = 'front';
    if (!['top', 'center', 'bottom'].includes(sp.vertical)) sp.vertical = 'center';
    if (!['left', 'center', 'right'].includes(sp.horizontal)) sp.horizontal = 'center';
    sp.width_pct = Math.max(5, Math.min(80, Math.round(Number(sp.width_pct) || 25)));
  }
  return parsed;
};

// items: [{ printImages: [...], printType, placement: { side, widthPct, offsetY, offsetX } }]
const composeView = async ({
  apiKey, productImageDataUrl, items,
  viewLabel, viewInstruction, extraPrompt, aspectRatio
}) => {
  // 모든 참고 이미지를 글로벌 번호로 매핑
  let globalIdx = 0;
  const placementsSpec = items.map((item, i) => {
    const placementIdx = i + 1;
    const { placement, printType, printImages } = item;
    const typeInfo = PRINT_TYPES.find(t => t.value === printType);
    const sideLabel = SIDES.find(s => s.key === placement.side)?.label || placement.side;
    const yLabel = OFFSET_Y_BY_SIDE[placement.side]?.find(o => o.value === placement.offsetY)?.label || '';
    const xLabel = OFFSET_X_BY_SIDE[placement.side]?.find(o => o.value === placement.offsetX)?.label || '';
    const ratioPct = Math.round(Number(placement.widthPct));

    const orientationNote =
      placement.side === 'front' && placement.offsetX === 'left' ? '착용자 기준 왼쪽 가슴 = 보는 사람 기준 오른쪽 (좌측 가슴 로고 자리)' :
      placement.side === 'front' && placement.offsetX === 'right' ? '착용자 기준 오른쪽 가슴 = 보는 사람 기준 왼쪽' :
      null;

    const imageRefs = printImages.map((_, j) => {
      globalIdx++;
      return {
        id: `프린트 이미지 #${globalIdx}`,
        role: j === 0
          ? '메인 — 위치/크기/형태의 기본 참고'
          : `추가 참고 #${j} — 같은 프린트의 다른 시점/거리 (멀리서 또는 가까이서). 질감/디테일/색상 정확도를 위해 종합적으로 활용`,
      };
    });

    return {
      index: placementIdx,
      image_refs: imageRefs,
      image_refs_note: imageRefs.length > 1
        ? '여러 장은 같은 프린트의 다른 시점 사진. 위치는 메인을 기준으로 하되, 질감·잉크 두께·실 결·미세 색상은 추가 참고 사진에서 보이는 디테일을 최대한 반영할 것.'
        : '단일 참고 사진.',
      side: placement.side,
      side_label: sideLabel,
      position: {
        vertical: placement.offsetY,
        vertical_label: yLabel,
        horizontal: placement.offsetX,
        horizontal_label: xLabel,
        ...(orientationNote ? { orientation_note: orientationNote } : {}),
      },
      size: {
        width_pct_of_garment_width: ratioPct,
      },
      print: {
        type_key: printType,
        type_label: typeInfo?.label,
        visual_traits: typeInfo?.desc,
      },
      rendering_note: '명시된 크기 비율과 위치를 정확히 지켜 정면으로 또렷이 합성',
    };
  });
  const totalRefImages = globalIdx;

  const spec = {
    input_format: {
      product_image: '제품 누끼 (배경이 흰색이거나 투명한 의류 사진). 이 비율과 구도를 그대로 출력에 유지할 것.',
      print_images: '실제 제작된 프린트의 클로즈업 사진. 각 프린트의 색상/형태/질감/잉크 두께/실 결이 그대로 보임.',
    },
    view: {
      key: viewLabel,
      instruction: viewInstruction,
    },
    placements: placementsSpec,
    output: {
      aspect_ratio: '1:1',
      aspect_ratio_note: '결과 캔버스는 정확히 정사각형(1:1). 앞면/뒷면 모두 같은 크기로 출력되어야 함.',
      background: '#FFFFFF',
      background_note: '배경은 반드시 순백색 #FFFFFF (RGB 255,255,255). 그라데이션, 텍스처, 그림자, 회색 톤 일체 없이 완전히 깨끗한 흰색.',
      resolution: '4K',
      composition: '제품을 정사각형 캔버스 중앙에 배치. 제품의 실루엣/색상/형태는 [제품 이미지]를 그대로 따를 것 (제품 비율 자체는 변경 금지, 캔버스만 1:1).',
    },
    must_preserve: ['제품의 실루엣', '제품 원래 색상', '제품의 형태와 비율', '제품 이미지의 구도'],
    must_apply: [
      '배경은 반드시 #FFFFFF 순백색 (다른 색·그라데이션·그림자 절대 금지)',
      '프린트는 [프린트 이미지 #N]에 보이는 색상/형태/질감/잉크특성을 그대로 옮길 것 (재해석/재생성/스타일화 금지)',
      '원단의 주름·음영·결이 프린트 위에 자연스럽게 반영',
      '각 placement의 size.width_pct_of_garment_width 값을 픽셀 단위로 정확히 반영 (의류 가로 폭의 X%)',
      '4K 화질, 디테일과 텍스처가 살아있도록',
    ],
    ...(extraPrompt && extraPrompt.trim() ? { user_extra_instructions: extraPrompt.trim() } : {}),
  };

  const prompt = `다음 JSON 명세에 따라 [제품 이미지]에 총 ${totalRefImages}장의 [프린트 이미지 #1]~[프린트 이미지 #${totalRefImages}]를 참고해서 ${items.length}개의 placement를 합성하세요.

\`\`\`json
${JSON.stringify(spec, null, 2)}
\`\`\`

해석 규칙:
1. 각 placement의 \`image_refs\` 배열은 같은 프린트의 여러 참고 사진(메인 + 다른 시점/거리). 위치는 메인을 기준으로 잡되, 질감·잉크 특성·실 결 등 시각 디테일은 모든 참고 사진을 종합해서 정확히 재현할 것.
2. 어떤 참고 사진의 시각 특성도 절대 변형/재해석하지 말고 그대로 옮길 것.
3. \`size.width_pct_of_garment_width\`는 의류 가로 폭 대비 프린트 가로 폭의 % — 화면에서 의류 폭을 측정하고 그 N%로 정확히 합성할 것 (임의로 키우거나 줄이지 말 것).
4. \`must_preserve\` 항목은 절대 수정 금지.
5. 결과 이미지는 반드시 1:1 정사각형 캔버스, 배경은 #FFFFFF 순백색. 제품은 캔버스 중앙에 자연스럽게 배치하되 제품 자체의 형태/비율은 [제품 이미지]를 따를 것.
6. \`user_extra_instructions\`가 있다면 사용자가 직접 추가한 디테일 요구사항이므로, 위 규칙과 충돌하지 않는 한 우선적으로 반영할 것 (특히 크기·위치 미세조정).`;

  const allImages = items.flatMap(item => item.printImages);
  const parts = [
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: stripBase64(productImageDataUrl) } },
    ...allImages.map(img => ({ inlineData: { mimeType: 'image/jpeg', data: stripBase64(img) } })),
  ];

  const data = await callGemini({
    apiKey,
    parts,
    expectImage: true,
    imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), imageSize: '4K' },
  });
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (imgPart?.inlineData?.data) return `data:image/jpeg;base64,${imgPart.inlineData.data}`;
  const txtPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  throw new Error(txtPart || '이미지가 생성되지 않았습니다');
};

// 프린트 참고 사진 → 탑뷰 DSLR 소프트박스 디테일 컷
const composeDetail = async ({ apiKey, sourceImage, printType }) => {
  const typeInfo = PRINT_TYPES.find(t => t.value === printType);
  const prompt = `다음 [참고 이미지]는 의류에 적용된 프린트(${typeInfo?.label || ''})의 클로즈업 사진입니다.
이 프린트를 동일한 원단 위에 펼쳐 놓고 위에서 아래로 촬영한 듯한 디테일 사진을 새로 생성하세요.

촬영 조건:
- **시점**: 탑뷰 (카메라가 원단 바로 위에서 수직으로 내려다본 시점, 평면 정사각 프레이밍)
- **카메라**: 풀프레임 DSLR + 매크로 렌즈 (f/8 정도, 전체적으로 또렷한 초점)
- **조명**: 좌우 또는 상단에 소프트박스 1~2개 (부드럽고 균일한 빛, 강한 그림자 없음, 하이라이트도 절제됨)
- **배경**: 프린트가 박힌 원단 자체. 원단의 결과 질감이 자연스럽게 보여야 함. 빈 흰 배경/스튜디오 사이클로라마 X.
- **컴포지션**: 프린트가 프레임 중앙에 균형있게, 약간의 원단 여백 포함

엄수 사항:
- 프린트의 색상/형태/질감/잉크 두께/실 결/광택을 참고 이미지 그대로 보존. **절대 흰색으로 빛바래거나 색이 빠지면 안 됨.**
- 원단 색상도 참고 이미지의 원래 색상 유지 (검정 후드면 검정 원단 위, 회색이면 회색 위 등). 흰 원단으로 바꾸지 말 것.
- 프린트 외 다른 요소(로고/텍스트/배경 소품) 추가 금지
- 1:1 정사각형 비율, 4K 고화질, 디테일·텍스처 살아있도록
${typeInfo ? `\n프린트 종류: ${typeInfo.label} — 시각 특성: ${typeInfo.desc}` : ''}`;

  const data = await callGemini({
    apiKey,
    parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64(sourceImage) } },
    ],
    expectImage: true,
    imageConfig: { aspectRatio: '1:1', imageSize: '4K' },
  });
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (imgPart?.inlineData?.data) return `data:image/jpeg;base64,${imgPart.inlineData.data}`;
  const txtPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  throw new Error(txtPart || '디테일 이미지 생성 실패');
};

// ==================== UI HELPERS ====================
const ImageDropZone = ({ value, onChange, label, icon: Icon, height = 'aspect-square', multiple = false }) => {
  const inputRef = useRef(null);
  const processFile = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    return await compressImage(dataUrl);
  };
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f && f.type?.startsWith('image/'));
    if (files.length === 0) return;
    if (multiple) {
      for (const f of files) {
        const processed = await processFile(f);
        onChange(processed);
      }
    } else {
      const processed = await processFile(files[0]);
      onChange(processed);
    }
  };
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
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

// ==================== DETAIL PAGE ====================
const CATEGORY_PRESETS = ['집업', '후드', '맨투맨', '긴팔', '반팔'];
const PRINT_TYPE_PRESETS = ['나염', '자수'];
const COLOR_PRESETS = ['블랙', '화이트', '그레이'];

const DETAIL_PAGE_DEFAULTS = {
  title: '',
  productName: '',
  category: '맨투맨',
  printType: '나염',
  color: '블랙',
};

// 프리셋 + 직접입력 셀렉트
const PresetSelect = ({ value, onChange, options, placeholder, label }) => {
  const isCustom = value !== '' && !options.includes(value);
  const selectValue = isCustom ? '__custom' : value;
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-gray-500 block mb-0.5">{label}</label>
      <select
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__custom') {
            if (!isCustom) onChange('');
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:border-black bg-white"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        <option value="__custom">직접입력</option>
      </select>
      {isCustom && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus
          className="w-full border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:border-black"
        />
      )}
    </div>
  );
};

// 동적 슬롯: shots는 [{ id, src }] 배열 (개수 무제한)
// 모든 가운데 정렬은 text-align/inline-block 기반 (html2canvas 호환성)
const DetailPage = ({ meta, shots }) => (
  <div id="detail-capture" style={{ width: 1000, background: '#ffffff', fontFamily: "'Inter','Noto Sans KR',system-ui,sans-serif", color: '#0a0a0a' }}>
    {/* HERO */}
    <section style={{ padding: '60px 56px 32px', textAlign: 'center' }}>
      <div style={{ marginBottom: 20, textAlign: 'center', fontSize: 0 }}>
        {meta.category && <span className="dp-pill" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', margin: '0 4px', padding: '8px 16px', borderRadius: 999, fontSize: 14, fontWeight: 500, lineHeight: 1, color: '#fff', background: '#0a0a0a' }}><span className="dp-pill-text">{meta.category}</span></span>}
        {meta.printType && <span className="dp-pill" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', margin: '0 4px', padding: '8px 16px', borderRadius: 999, fontSize: 14, fontWeight: 500, lineHeight: 1, color: '#3a3a3a', background: '#f6f6f4', border: '1px solid #e8e6e0' }}><span className="dp-pill-text">{meta.printType}</span></span>}
        {meta.color && <span className="dp-pill" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', margin: '0 4px', padding: '8px 16px', borderRadius: 999, fontSize: 14, fontWeight: 500, lineHeight: 1, color: '#3a3a3a', background: '#f6f6f4', border: '1px solid #e8e6e0' }}><span className="dp-pill-text">{meta.color}</span></span>}
      </div>
      <h1 style={{ fontSize: 54, lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 700, marginBottom: 0, textAlign: 'center' }}>{meta.title || '제목 없음'}</h1>
      {meta.productName && (
        <div style={{ fontSize: 16, color: '#8a8a8a', textAlign: 'center', marginTop: 24 }}>{meta.productName}</div>
      )}
    </section>

    {/* PHOTOS */}
    <section style={{ padding: '24px 56px 60px' }}>
      {shots.filter(s => s.src).map(s => (
        <div key={s.id} style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 20, background: '#f6f6f4' }}>
          <img src={s.src} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </div>
      ))}
    </section>
  </div>
);

// ==================== APP ====================
export default function App() {
  const [productImage, setProductImage] = useState(null);
  const [prints, setPrints] = useState([]); // [{ id, images: [dataUrl, ...], analysis, analyzing, error }]
  const [placements, setPlacements] = useState([]); // [{ side, printId, widthPct, offsetY, offsetX }]
  const [results, setResults] = useState({}); // { [side]: { status, dataUrl, error } }
  const [detailShotResults, setDetailShotResults] = useState({ d1: null, d2: null }); // 매거진 디테일 컷 (자동 생성)
  const [composeCount, setComposeCount] = useState(0);
  const isComposing = composeCount > 0;
  const [extraPrompt, setExtraPrompt] = useState('');
  const [showDetailPage, setShowDetailPage] = useState(false);
  const [detailMeta, setDetailMeta] = useState(DETAIL_PAGE_DEFAULTS);
  const [detailShots, setDetailShots] = useState([]); // [{ id, src }] 동적 슬롯
  const [isCapturing, setIsCapturing] = useState(false);
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
    const newPrint = { id, images: [dataUrl], analysis: null, analyzing: true, error: null };
    setPrints(prev => [...prev, newPrint]);
    if (!apiKey) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: 'API Key 미설정' } : p));
      return;
    }
    try {
      const analysis = await analyzePrint({ apiKey, printImageDataUrl: dataUrl });
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analysis, analyzing: false } : p));
      // 자동 placement: 추천된 면이 비어있으면 자동 생성
      if (analysis.suggested_placement) {
        const sp = analysis.suggested_placement;
        setPlacements(prev => {
          if (prev.find(pl => pl.side === sp.side)) return prev; // 이미 있으면 유지
          return [...prev, {
            side: sp.side,
            printId: id,
            widthPct: sp.width_pct,
            offsetY: sp.vertical,
            offsetX: sp.horizontal,
          }];
        });
      }
    } catch (e) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: e.message } : p));
    }
  };

  const addPrintRef = (printId) => async (dataUrl) => {
    setPrints(prev => prev.map(p => p.id === printId
      ? { ...p, images: [...p.images, dataUrl] }
      : p));
  };

  const removePrintRef = (printId, imgIdx) => {
    setPrints(prev => prev.map(p => {
      if (p.id !== printId) return p;
      const newImages = p.images.filter((_, i) => i !== imgIdx);
      if (newImages.length === 0) return p;
      return { ...p, images: newImages };
    }));
  };

  const reanalyzePrint = async (id) => {
    const target = prints.find(p => p.id === id);
    if (!target || !apiKey) return;
    setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: true, error: null } : p));
    try {
      const analysis = await analyzePrint({ apiKey, printImageDataUrl: target.images[0] });
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
      const defaultPrintId = prints[0]?.id || null;
      return [...prev, { side, printId: defaultPrintId, widthPct: 30, offsetY: 'center', offsetX: 'center' }];
    });
  };

  const updatePlacement = (side, field, value) => {
    setPlacements(prev => prev.map(pl => pl.side === side ? { ...pl, [field]: value } : pl));
  };

  // ---------- compose ----------
  // 공통 검증
  const validateCompose = () => {
    if (!apiKey) { showNotification('API Key를 먼저 설정하세요', 'error'); return false; }
    if (!productImage) { showNotification('제품컷을 업로드하세요', 'error'); return false; }
    if (prints.length === 0) { showNotification('프린트를 1개 이상 업로드하세요', 'error'); return false; }
    if (placements.length === 0) { showNotification('배치할 위치를 선택하세요', 'error'); return false; }
    for (const pl of placements) {
      const print = prints.find(p => p.id === pl.printId);
      if (!print) { showNotification(`${SIDES.find(s => s.key === pl.side)?.label}: 프린트가 선택되지 않음`, 'error'); return false; }
      if (!print.analysis) { showNotification('아직 분석 중인 프린트가 있습니다', 'error'); return false; }
    }
    return true;
  };

  // 내부: view 1개 합성 (isComposing 카운트 관리 X)
  const composeViewInternal = async (viewKey) => {
    const view = VIEWS.find(v => v.key === viewKey);
    if (!view) return;
    const items = placements
      .filter(pl => view.sides.includes(pl.side))
      .map(pl => {
        const print = prints.find(p => p.id === pl.printId);
        return { placement: pl, printImages: print.images, printType: print.analysis.type };
      });
    if (items.length === 0) return null;

    setResults(r => ({ ...r, [view.key]: { status: 'pending' } }));
    try {
      const dataUrl = await composeView({
        apiKey,
        productImageDataUrl: productImage,
        items,
        viewLabel: view.label,
        viewInstruction: view.viewInstruction,
        extraPrompt,
        aspectRatio: '1:1',
      });
      setResults(r => ({ ...r, [view.key]: { status: 'done', dataUrl } }));
      return 'done';
    } catch (e) {
      setResults(r => ({ ...r, [view.key]: { status: 'error', error: e.message } }));
      return 'error';
    }
  };

  // 단일 view 합성 (개별 버튼)
  const composeOneView = async (viewKey) => {
    if (!validateCompose()) return;
    const view = VIEWS.find(v => v.key === viewKey);
    if (!view) return;
    const hasItems = placements.some(pl => view.sides.includes(pl.side));
    if (!hasItems) {
      showNotification(`${view.label}에 합성할 placement가 없습니다`, 'error');
      return;
    }
    setComposeCount(c => c + 1);
    try {
      const result = await composeViewInternal(viewKey);
      if (result === 'done') showNotification(`${view.label} 합성 완료`);
      else if (result === 'error') showNotification(`${view.label} 합성 실패`, 'error');
    } finally {
      setComposeCount(c => c - 1);
    }
  };

  // 내부: 디테일 생성 (isComposing 카운트 관리 X)
  const composeDetailShotsInternal = async () => {
    const detailSources = [];
    prints.forEach(p => p.images.slice(1).forEach(img => detailSources.push({ img, type: p.analysis?.type })));
    prints.forEach(p => detailSources.push({ img: p.images[0], type: p.analysis?.type }));
    const detailJobs = detailSources.slice(0, 2);
    if (detailJobs.length === 0) return;

    const initial = { d1: null, d2: null };
    detailJobs.forEach((_, i) => { initial[i === 0 ? 'd1' : 'd2'] = { status: 'pending' }; });
    setDetailShotResults(initial);

    await Promise.all(detailJobs.map(async ({ img, type }, i) => {
      const slot = i === 0 ? 'd1' : 'd2';
      try {
        const dataUrl = await composeDetail({ apiKey, sourceImage: img, printType: type });
        setDetailShotResults(r => ({ ...r, [slot]: { status: 'done', dataUrl } }));
      } catch (e) {
        setDetailShotResults(r => ({ ...r, [slot]: { status: 'error', error: e.message } }));
      }
    }));
  };

  // 디테일 생성 (개별 버튼)
  const composeDetailShots = async () => {
    if (!apiKey) { showNotification('API Key를 먼저 설정하세요', 'error'); return; }
    if (prints.length === 0) { showNotification('프린트를 1개 이상 업로드하세요', 'error'); return; }
    for (const p of prints) {
      if (!p.analysis) { showNotification('아직 분석 중인 프린트가 있습니다', 'error'); return; }
    }
    setComposeCount(c => c + 1);
    try {
      await composeDetailShotsInternal();
      showNotification('디테일 생성 완료');
    } finally {
      setComposeCount(c => c - 1);
    }
  };

  // 전체 합성 (앞면 + 뒷면 + 디테일 동시)
  const composeAllViews = async () => {
    if (!validateCompose()) return;
    setComposeCount(c => c + 1);
    try {
      await Promise.all([
        composeViewInternal('front_view'),
        composeViewInternal('back_view'),
        composeDetailShotsInternal(),
      ]);
      showNotification('전체 합성 완료');
    } finally {
      setComposeCount(c => c - 1);
    }
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

  // ---------- detail page ----------
  const newSlotId = () => `slot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 자동 채움 콘텐츠 빌드 (현재 합성 결과 기준)
  const buildAutoFillShots = () => {
    const initial = [];
    const push = (src) => { if (src) initial.push({ id: newSlotId(), src }); };
    push(results.front_view?.dataUrl);
    push(results.back_view?.dataUrl);
    push(prints[0]?.images?.[0]);
    push(detailShotResults.d1?.dataUrl);
    push(detailShotResults.d2?.dataUrl);
    return initial;
  };

  const openDetailPage = () => {
    // 모든 슬롯이 비어있으면(또는 슬롯 자체가 없으면) 현재 합성 결과로 자동 채움.
    // 사용자가 직접 업로드한 슬롯이 하나라도 있으면 유지.
    const allEmpty = detailShots.length === 0 || detailShots.every(s => !s.src);
    if (allEmpty) {
      const initial = buildAutoFillShots();
      if (initial.length === 0) initial.push({ id: newSlotId(), src: null });
      setDetailShots(initial);
    }
    // 프린트 종류 라벨 자동 추정
    const firstAnalysisType = prints[0]?.analysis?.type;
    const printLabel = PRINT_TYPES.find(t => t.value === firstAnalysisType)?.label;
    if (printLabel) setDetailMeta(m => ({ ...m, printType: printLabel }));
    setShowDetailPage(true);
  };

  // 합성 결과로 강제 재채움 (사용자 업로드 슬롯 모두 대체)
  const refillDetailShotsFromResults = () => {
    const initial = buildAutoFillShots();
    if (initial.length === 0) {
      showNotification('아직 합성 결과가 없습니다', 'error');
      return;
    }
    setDetailShots(initial);
    showNotification(`${initial.length}개 슬롯을 합성 결과로 채웠습니다`);
  };

  const addDetailShot = () => {
    setDetailShots(prev => [...prev, { id: newSlotId(), src: null }]);
  };

  const updateDetailShot = (id) => async (dataUrl) => {
    setDetailShots(prev => prev.map(s => s.id === id ? { ...s, src: dataUrl } : s));
  };

  const removeDetailShot = (id) => {
    setDetailShots(prev => prev.filter(s => s.id !== id));
  };

  const moveDetailShot = (id, direction) => {
    setDetailShots(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  };

  const captureDetailPage = async (format) => {
    const el = document.getElementById('detail-capture');
    if (!el) return showNotification('캡처 영역을 찾을 수 없습니다', 'error');
    setIsCapturing(true);
    // 캡처 모드 클래스 — html2canvas가 한글 baseline 위치를 잘못 잡는 걸 보정
    el.classList.add('dp-capture-mode');
    try {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const canvas = await html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        windowWidth: 1000,
        width: 1000,
        logging: false,
      });

      const target = document.createElement('canvas');
      target.width = 1000;
      target.height = Math.round(canvas.height * (1000 / canvas.width));
      const ctx = target.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.drawImage(canvas, 0, 0, target.width, target.height);

      const isJpg = format === 'jpg';
      const dataUrl = target.toDataURL(isJpg ? 'image/jpeg' : 'image/png', isJpg ? 0.92 : undefined);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      const safeTitle = (detailMeta.title || 'detail').replace(/[^\w가-힣-]/g, '_').slice(0, 30);
      a.href = dataUrl;
      a.download = `${safeTitle}_${ts}.${isJpg ? 'jpg' : 'png'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showNotification(`${isJpg ? 'JPG' : 'PNG'} 다운로드 완료 (${target.width}×${target.height})`);
    } catch (e) {
      console.error(e);
      showNotification('캡처 실패: ' + (e.message || e), 'error');
    } finally {
      el.classList.remove('dp-capture-mode');
      setIsCapturing(false);
    }
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
        <div className="flex items-center gap-2">
          <button
            onClick={openDetailPage}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold border border-black rounded-full hover:bg-black hover:text-white transition-colors"
          >
            <LucideFileText className="w-3 h-3" />
            <span>상세페이지</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold border rounded-full transition-colors ${
              apiKey ? 'bg-black text-white border-black' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200 hover:text-black'
            }`}
          >
            <LucideKey className="w-3 h-3" />
            <span>{apiKey ? 'API Key 설정됨' : 'API Key 설정'}</span>
          </button>
        </div>
      </header>

      {/* Main 3-column layout */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden">

        {/* ============ Column 1: Inputs ============ */}
        <section className="col-span-3 border-r border-black overflow-y-auto p-5 bg-white">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">1. 입력</h2>

          <div className="space-y-6">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">제품 누끼</label>
              <ImageDropZone
                value={productImage}
                onChange={setProductImage}
                label="제품 누끼 업로드"
                icon={LucideUploadCloud}
              />
              <p className="text-[10px] text-gray-400 mt-1">결과 비율은 이 이미지 비율을 그대로 따릅니다 · 흰 배경/누끼 권장</p>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">프린트 풀</label>
              {prints.length > 0 && (
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {prints.map((p, idx) => (
                    <div key={p.id} className="relative group aspect-square border border-black bg-gray-50 overflow-hidden">
                      <img src={p.images[0]} alt="" className="w-full h-full object-contain" />
                      <div className="absolute top-0.5 left-0.5 bg-black text-white text-[9px] font-bold px-1">#{idx + 1}</div>
                      {p.images.length > 1 && (
                        <div className="absolute bottom-0.5 left-0.5 bg-black text-white text-[9px] font-bold px-1">+{p.images.length - 1}</div>
                      )}
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
                label="프린트 추가 (드래그 다중 가능)"
                icon={LucidePlus}
                multiple
              />
              <p className="text-[10px] text-gray-400 mt-2">여러 장 한꺼번에 드래그 OK · 각각 자동 분석</p>
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
            <div className="space-y-3">
              {/* 컴팩트 분석 행 — 프린트별 1줄 (썸네일 + 종류 셀렉트 + 참고사진 +) */}
              <div className="space-y-1.5">
                {prints.map((p, idx) => (
                  <details key={p.id} className="border border-gray-200 bg-white open:border-black">
                    <summary className="flex items-center gap-2 p-2 cursor-pointer list-none hover:bg-gray-50">
                      <div className="w-9 h-9 border border-gray-200 shrink-0 overflow-hidden bg-gray-50">
                        <img src={p.images[0]} alt="" className="w-full h-full object-contain" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider shrink-0">#{idx + 1}</span>
                      {p.analyzing ? (
                        <span className="text-xs text-gray-500 flex items-center gap-1"><LucideLoader2 className="w-3 h-3 animate-spin" /> 분석 중...</span>
                      ) : p.error ? (
                        <span className="text-xs text-red-600 truncate">{p.error}</span>
                      ) : p.analysis ? (
                        <select value={p.analysis.type}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updatePrintType(p.id, e.target.value)}
                          className="text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black">
                          {PRINT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      ) : null}
                      {p.images.length > 1 && (
                        <span className="text-[10px] text-gray-400 ml-1">참고 +{p.images.length - 1}</span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); reanalyzePrint(p.id); }} disabled={p.analyzing}
                          className="p-1 hover:bg-gray-100 disabled:opacity-30" title="다시 분석">
                          <LucideRefreshCw className={`w-3.5 h-3.5 ${p.analyzing ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); removePrint(p.id); }}
                          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-black" title="삭제">
                          <LucideTrash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </summary>
                    <div className="border-t border-gray-200 p-2 bg-gray-50">
                      {p.analysis?.notes && (
                        <p className="text-[10px] text-gray-600 leading-relaxed mb-2">{p.analysis.notes}</p>
                      )}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">참고 사진 ({p.images.length}장)</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.images.map((img, imgIdx) => (
                          <div key={imgIdx} className="relative group w-12 h-12 border border-gray-300 bg-white overflow-hidden">
                            <img src={img} alt="" className="w-full h-full object-contain" />
                            <div className="absolute top-0 left-0 bg-black text-white text-[8px] font-bold px-0.5">
                              {imgIdx === 0 ? '메인' : imgIdx + 1}
                            </div>
                            {p.images.length > 1 && (
                              <button onClick={() => removePrintRef(p.id, imgIdx)}
                                className="absolute top-0 right-0 bg-white border border-black p-0.5 opacity-0 group-hover:opacity-100 hover:bg-black hover:text-white">
                                <LucideX className="w-2 h-2" />
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="w-12 h-12">
                          <ImageDropZone
                            value={null}
                            onChange={addPrintRef(p.id)}
                            label="+"
                            icon={LucidePlus}
                            multiple
                          />
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
              </div>

              {/* 위치 / 크기 — 분리 헤더 없이 바로 카드 */}
              <div>
                <div className="grid grid-cols-2 gap-2">
                  {SIDES.map(side => {
                    const placement = placements.find(pl => pl.side === side.key);
                    const checked = !!placement;
                    const yOpts = OFFSET_Y_BY_SIDE[side.key] || [];
                    const xOpts = OFFSET_X_BY_SIDE[side.key] || [];
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
                                    title={`프린트 #${idx + 1}${p.images.length > 1 ? ` (+${p.images.length - 1})` : ''}`}>
                                    <img src={p.images[0]} alt="" className="w-full h-full object-contain" />
                                    <div className="absolute top-0 left-0 bg-black text-white text-[8px] font-bold px-0.5">{idx + 1}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="number" value={placement.widthPct} min="1" max="80"
                                onChange={(e) => updatePlacement(side.key, 'widthPct', Number(e.target.value))}
                                className="w-16 border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:border-black" />
                              <span className="text-[11px] text-gray-500">% (의류 가로폭 대비)</span>
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

          <div className="mt-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">추가 프롬프트 (선택)</label>
            <textarea
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              rows={3}
              placeholder="예) 좌측 가슴 로고는 정확히 셔츠 가슴포켓 위치에 6.5cm로, 윗선이 겨드랑이 라인보다 5cm 아래에 오도록"
              className="w-full border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-black resize-none"
            />
            <p className="text-[10px] text-gray-400 mt-1">크기/위치 미세조정, 재질 디테일 등 자유 서술. JSON spec의 user_extra_instructions로 들어감.</p>
          </div>

          <button
            onClick={composeAllViews}
            disabled={isComposing || prints.length === 0 || placements.length === 0}
            className="w-full mt-3 py-3 bg-black text-white text-sm font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-gray-800 flex items-center justify-center gap-2"
          >
            {isComposing
              ? <><LucideLoader2 className="w-4 h-4 animate-spin" /> 전체 합성 중...</>
              : <><LucideWand2 className="w-4 h-4" /> 전체 합성 (앞·뒤·디테일)</>}
          </button>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button
              onClick={() => composeOneView('front_view')}
              disabled={isComposing || prints.length === 0 || placements.length === 0}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title="앞면만 합성"
            >
              {results.front_view?.status === 'pending'
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 앞면</>
                : <>앞면</>}
            </button>
            <button
              onClick={() => composeOneView('back_view')}
              disabled={isComposing || prints.length === 0 || placements.length === 0}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title="뒷면만 합성"
            >
              {results.back_view?.status === 'pending'
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 뒷면</>
                : <>뒷면</>}
            </button>
            <button
              onClick={composeDetailShots}
              disabled={isComposing || prints.length === 0}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title="디테일 컷만 생성"
            >
              {(detailShotResults.d1?.status === 'pending' || detailShotResults.d2?.status === 'pending')
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 디테일</>
                : <>디테일</>}
            </button>
          </div>
        </section>

        {/* ============ Column 3: Results ============ */}
        <section className="col-span-4 overflow-y-auto p-5 bg-gray-50">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">3. 결과</h2>
            {Object.values(results).some(r => r.status === 'done') && (
              <div className="flex gap-1.5">
                <button onClick={openDetailPage}
                  className="text-[10px] font-bold uppercase tracking-wider border border-black px-2 py-1 hover:bg-black hover:text-white flex items-center gap-1">
                  <LucideFileText className="w-3 h-3" /> 상세페이지
                </button>
                <button onClick={downloadAll}
                  className="text-[10px] font-bold uppercase tracking-wider border border-black px-2 py-1 hover:bg-black hover:text-white flex items-center gap-1">
                  <LucideDownload className="w-3 h-3" /> 전체
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            {VIEWS.map(view => {
              const r = results[view.key];
              return (
                <div key={view.key} className="aspect-square bg-white border border-gray-200 flex flex-col relative overflow-hidden">
                  {!r ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                      <LucideShirt className="w-10 h-10 mb-1" />
                      <span className="text-xs font-bold uppercase tracking-wider">{view.label}</span>
                    </div>
                  ) : r.status === 'pending' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                      <LucideLoader2 className="w-7 h-7 animate-spin mb-1" />
                      <span className="text-xs font-bold uppercase tracking-wider">{view.label}</span>
                    </div>
                  ) : r.status === 'error' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-red-500 px-2 text-center">
                      <LucideXCircle className="w-7 h-7 mb-1" />
                      <span className="text-xs font-bold uppercase tracking-wider mb-1">{view.label}</span>
                      <span className="text-[10px] text-red-400 leading-tight">{r.error}</span>
                    </div>
                  ) : (
                    <>
                      <img src={r.dataUrl} alt={view.label} className="w-full h-full object-contain" />
                      <div className="absolute top-1.5 left-1.5 bg-black text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">
                        {view.label}
                      </div>
                      <button onClick={() => downloadResult(view.key, r.dataUrl)}
                        className="absolute bottom-1.5 right-1.5 bg-black text-white p-1.5 hover:bg-gray-800">
                        <LucideDownload className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Auto-generated detail shots (1:1) */}
          {(detailShotResults.d1 || detailShotResults.d2) && (
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">디테일 (자동 생성)</div>
              <div className="grid grid-cols-2 gap-3">
                {['d1', 'd2'].map(slot => {
                  const r = detailShotResults[slot];
                  if (!r) return null;
                  return (
                    <div key={slot} className="aspect-square bg-white border border-gray-200 flex flex-col relative overflow-hidden">
                      {r.status === 'pending' ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                          <LucideLoader2 className="w-6 h-6 animate-spin mb-1" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">디테일 {slot === 'd1' ? '01' : '02'}</span>
                        </div>
                      ) : r.status === 'error' ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-red-500 px-2 text-center">
                          <LucideXCircle className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-bold uppercase tracking-wider mb-1">디테일 {slot === 'd1' ? '01' : '02'}</span>
                          <span className="text-[9px] text-red-400 leading-tight">{r.error}</span>
                        </div>
                      ) : (
                        <>
                          <img src={r.dataUrl} alt={`디테일 ${slot}`} className="w-full h-full object-contain" />
                          <div className="absolute top-1 left-1 bg-black text-white text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
                            디테일 {slot === 'd1' ? '01' : '02'}
                          </div>
                          <button onClick={() => downloadResult(`detail_${slot}`, r.dataUrl)}
                            className="absolute bottom-1 right-1 bg-black text-white p-1 hover:bg-gray-800">
                            <LucideDownload className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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

      {/* Detail Page Modal */}
      {showDetailPage && (
        <div className="fixed inset-0 bg-black/40 z-[1000] flex flex-col">
          <header className="h-14 bg-white border-b border-black flex items-center justify-between px-5 shrink-0">
            <div className="flex items-center gap-2">
              <LucideFileText className="w-4 h-4" />
              <span className="font-extrabold text-sm uppercase tracking-tighter">상세페이지 생성</span>
              <span className="text-[10px] text-gray-400 ml-2">1000px 고정 · JPG/PNG 다운로드</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => captureDetailPage('png')} disabled={isCapturing}
                className="text-[11px] font-bold uppercase tracking-wider border border-black px-3 py-1.5 hover:bg-black hover:text-white disabled:opacity-50 flex items-center gap-1">
                <LucideDownload className="w-3 h-3" /> PNG
              </button>
              <button onClick={() => captureDetailPage('jpg')} disabled={isCapturing}
                className="text-[11px] font-bold uppercase tracking-wider bg-black text-white px-3 py-1.5 hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1">
                <LucideDownload className="w-3 h-3" /> JPG
              </button>
              <button onClick={() => setShowDetailPage(false)} className="p-1 ml-2 hover:bg-gray-100">
                <LucideX className="w-5 h-5" />
              </button>
            </div>
          </header>

          <div className="flex-1 grid grid-cols-12 overflow-hidden">
            {/* Form panel */}
            <aside className="col-span-4 bg-gray-50 border-r border-gray-200 overflow-y-auto p-5 space-y-5">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">메타 정보</h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">제목</label>
                    <input type="text" value={detailMeta.title}
                      onChange={(e) => setDetailMeta(m => ({ ...m, title: e.target.value }))}
                      placeholder="예) 나인티 맨투맨"
                      className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:border-black" />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <PresetSelect
                      label="품목"
                      value={detailMeta.category}
                      onChange={(v) => setDetailMeta(m => ({ ...m, category: v }))}
                      options={CATEGORY_PRESETS}
                      placeholder="품목 입력"
                    />
                    <PresetSelect
                      label="프린트"
                      value={detailMeta.printType}
                      onChange={(v) => setDetailMeta(m => ({ ...m, printType: v }))}
                      options={PRINT_TYPE_PRESETS}
                      placeholder="프린트 입력"
                    />
                    <PresetSelect
                      label="색상"
                      value={detailMeta.color}
                      onChange={(v) => setDetailMeta(m => ({ ...m, color: v }))}
                      options={COLOR_PRESETS}
                      placeholder="색상 입력"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-0.5">제품명 (선택)</label>
                    <input type="text" value={detailMeta.productName}
                      onChange={(e) => setDetailMeta(m => ({ ...m, productName: e.target.value }))}
                      placeholder="예) FP-142"
                      className="w-full border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:border-black" />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 gap-1.5 flex-wrap">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-gray-400">사진 슬롯 ({detailShots.length}장)</h3>
                  <div className="flex gap-1.5">
                    <button onClick={refillDetailShotsFromResults}
                      className="text-[10px] font-bold uppercase tracking-wider border border-gray-300 text-gray-700 px-2 py-1 hover:bg-gray-100 flex items-center gap-1" title="현재 합성 결과로 슬롯 재구성">
                      <LucideRefreshCw className="w-3 h-3" /> 다시 채우기
                    </button>
                    <button onClick={addDetailShot}
                      className="text-[10px] font-bold uppercase tracking-wider border border-black px-2 py-1 hover:bg-black hover:text-white flex items-center gap-1">
                      <LucidePlus className="w-3 h-3" /> 슬롯 추가
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {detailShots.map((slot, idx) => (
                    <div key={slot.id} className="flex items-start gap-2 p-2 border border-gray-200 bg-white">
                      <span className="text-[10px] text-gray-400 font-bold pt-1 w-5">{idx + 1}</span>
                      <div className="w-20 shrink-0">
                        <ImageDropZone
                          value={slot.src}
                          onChange={updateDetailShot(slot.id)}
                          label="업로드"
                          icon={LucideUploadCloud}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5 ml-auto">
                        <button onClick={() => moveDetailShot(slot.id, 'up')} disabled={idx === 0}
                          className="p-1 hover:bg-gray-100 disabled:opacity-30" title="위로">
                          <LucideArrowUp className="w-3 h-3" />
                        </button>
                        <button onClick={() => moveDetailShot(slot.id, 'down')} disabled={idx === detailShots.length - 1}
                          className="p-1 hover:bg-gray-100 disabled:opacity-30" title="아래로">
                          <LucideArrowDown className="w-3 h-3" />
                        </button>
                        <button onClick={() => removeDetailShot(slot.id)}
                          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-black" title="슬롯 삭제">
                          <LucideTrash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {detailShots.length === 0 && (
                    <div className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200">
                      슬롯이 없습니다. 위 "슬롯 추가" 클릭
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Preview panel */}
            <main className="col-span-8 bg-gray-200 overflow-auto p-6 flex justify-center">
              <div className="shadow-2xl">
                <DetailPage meta={detailMeta} shots={detailShots} />
              </div>
            </main>
          </div>
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
