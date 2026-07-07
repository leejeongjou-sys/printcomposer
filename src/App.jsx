import React, { useState, useRef, useEffect } from 'react';
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
    viewInstruction: '의류의 뒷면(등판)이 정면에서 보이는 후면 컷. [제품 이미지]를 베이스로, 그 제품과 완전히 동일한 의류(같은 색상·원단·실루엣·비율·소매/밑단/카라 형태)의 뒷모습을 자연스럽게 상상해서 그릴 것 — 다른 옷을 새로 만드는 게 아니라 같은 옷을 뒤에서 본 모습으로 재구성. **특히 전체적인 아웃라인(옷이 놓인 형태·자세·프레이밍·크기·기울기)은 [제품 이미지]를 그대로 따라갈 것**: 같은 배치로 놓인 같은 옷을 그대로 뒤집어 본 컷이어야 하며, 실루엣 외곽선이 [제품 이미지]와 거의 일치해야 함. 앞면 전용 요소(앞지퍼·앞주머니·앞 그래픽 등)는 뒷면에 두지 말고 등판·뒷목 라벨·요크 등 뒷면 구조로 자연스럽게 배치. 형태·비율·색감이 앞모습과 어긋나거나 왜곡되지 않도록 일관 유지.',
  },
];

const MODEL_ID = 'gemini-3.1-flash-image-preview';

// 나염 부분 기본 배치값
const DEFAULT_PLACEMENT = { side: 'front', offsetY: 'center', offsetX: 'center', widthPct: 25 };

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
    // 투명 PNG 누끼 → JPEG 변환 시 투명 영역이 검정으로 깔리는 것 방지 (반드시 흰색 먼저)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
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

const analyzePrint = async ({ apiKey, images }) => {
  const imgs = Array.isArray(images) ? images : [images];
  const prompt = `아래 이미지들은 의류에 쓰이는 하나의 프린트(또는 자수) 부분을 여러 각도·거리에서 찍은 사진입니다 (총 ${imgs.length}장).

작업 1: 종류 판별
다음 종류 중 가장 가까운 것을 정확히 1개 선택하세요.

종류 목록 (value: 설명):
${PRINT_TYPES.map(t => `- ${t.value}: ${t.label} — ${t.desc}`).join('\n')}

판단 근거(광택, 입체감, 실 구조, 잉크 두께, 가장자리 등)를 1~2문장으로 적어주세요.

작업 2: 위치·크기 추천
이 프린트가 의류의 어디에 들어가는 게 일반적·자연스러운지, 그리고 크기를 추천하세요.
- side: "front" (앞면 — 가슴, 앞판) 또는 "back" (뒷면 — 등판)
- vertical: "top" / "center" / "bottom"
- horizontal: "left" / "center" / "right"
- width_pct: 의류 가로 폭 대비 프린트 가로 폭의 % (정수)
  - 작은 가슴 로고/와펜류: 8-15
  - 중간 가슴 그래픽: 18-30
  - 등판 큰 그래픽/대형 레터링: 40-70

**크기 산정 시 중요**: 제공된 여러 장 중에는 프린트가 실제 의류/사람 위에 있어 크기를 가늠할 수 있는 사진(전체 착장샷, 자·손 등 스케일 기준이 함께 찍힌 사진)이 섞여 있을 수 있습니다. 그런 사진이 있으면 그것을 **우선 근거**로 삼아 의류 가로폭 대비 프린트 가로폭을 실제 비율로 추정하세요. 클로즈업만 있으면 그래픽 종류·복잡도·관행으로 추정합니다.

반드시 다음 JSON 형식으로만 응답:
{
  "type": "<위 value 중 하나>",
  "notes": "<판단 근거 (크기 근거로 삼은 사진이 있으면 언급)>",
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
      ...imgs.map(img => ({ inlineData: { mimeType: 'image/jpeg', data: stripBase64(img) } })),
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
      product_image: '제품 누끼 (의류만 오려낸 사진). 제품의 실루엣·색상·형태·비율을 사용.',
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
      resolution: '4K',
      background: '순백색 #FFFFFF — 제품을 배경에서 완전히 오려낸 누끼로 흰 배경 위에 얹은 형태 (스튜디오/그림자/바닥/환경 없음).',
      composition: '제품을 정사각형 캔버스 중앙에 배치. 제품의 실루엣/색상/형태는 [제품 이미지]를 그대로 따를 것 (제품 비율 자체는 변경 금지, 캔버스만 1:1).',
    },
    must_preserve: ['제품의 실루엣', '제품 원래 색상', '제품의 형태와 비율', '제품의 모든 디테일(지퍼·슬라이더·봉제선/스티치·단추·끈·시보리(리브)·카라·소매단·라벨·포켓 등)을 [제품 이미지] 그대로 — 형태·개수·위치·마감을 절대 변형/재디자인하지 말 것'],
    must_apply: [
      '제품을 배경에서 완전히 오려내어(누끼) 순백색 #FFFFFF 배경 위에 그대로 얹을 것. 제품 실루엣 바깥은 전부 균일한 순백색이며, 스튜디오·그림자·바닥 등 다른 배경 요소는 넣지 말 것.',
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
5. 결과 이미지는 반드시 1:1 정사각형 캔버스. 제품은 캔버스 중앙에 자연스럽게 배치하되 제품 자체의 형태/비율은 [제품 이미지]를 따를 것.
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
이 사진을 **각도·시점·구도·프레이밍을 그대로 유지한 채** 깔끔하게 보정(리터칭)만 해주세요. 새로 촬영하거나 다른 앵글로 다시 그리지 마세요.

핵심 원칙 — 변형 금지:
- 카메라 앵글·시점·거리·원근·프레이밍, 그리고 프린트의 위치/크기/형태를 [참고 이미지]와 **동일하게** 유지. 탑뷰로 바꾸거나 회전·이동·확대·축소·재구성하지 말 것.
- 프린트의 색상/형태/질감/잉크 두께/실 결/광택, 원단의 색상과 결도 원본 그대로 보존. 색이 빠지거나 흰색으로 빛바래지 않게.
- 원단 색상 유지 (검정 후드면 검정 그대로, 회색이면 회색 그대로). 흰 원단으로 바꾸지 말 것.

적용할 보정 (이것만):
- 노이즈·먼지·티끌·얼룩·잡티 제거로 깨끗하게
- 조명/노출 균일화 (얼룩진 그림자나 번들거림 정리, 디테일이 고르게 보이도록)
- 화이트밸런스·색감 자연스럽게 정리, 선명도(샤프닝) 약간 향상
- 초점이 흐린 부분이 있으면 또렷하게

엄수 사항:
- 프린트 외 다른 요소(로고/텍스트/배경 소품) 추가 금지
- 원본의 비율·구도를 그대로 유지하되 4K 고화질로 디테일·텍스처가 살아있도록
${typeInfo ? `\n프린트 종류: ${typeInfo.label} — 시각 특성: ${typeInfo.desc}` : ''}`;

  // 원본 각도·프레이밍 유지를 위해 1:1 강제 대신 원본에 가장 가까운 비율로
  const aspectRatio = await detectClosestAspect(sourceImage);
  const data = await callGemini({
    apiKey,
    parts: [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: stripBase64(sourceImage) } },
    ],
    expectImage: true,
    imageConfig: { aspectRatio, imageSize: '4K' },
  });
  const imgPart = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (imgPart?.inlineData?.data) return `data:image/jpeg;base64,${imgPart.inlineData.data}`;
  const txtPart = data?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  throw new Error(txtPart || '디테일 이미지 생성 실패');
};

// ==================== UI HELPERS ====================
const ImageDropZone = ({ value, onChange, onMultiple, label, icon: Icon, height = 'aspect-square', multiple = false }) => {
  const inputRef = useRef(null);
  const processFile = async (file) => {
    const dataUrl = await fileToDataUrl(file);
    return await compressImage(dataUrl);
  };
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f && f.type?.startsWith('image/'));
    if (files.length === 0) return;
    if (multiple) {
      const urls = [];
      for (const f of files) urls.push(await processFile(f));
      if (onMultiple) onMultiple(urls);
      else urls.forEach(u => onChange(u));
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
const PRINT_TYPE_PRESETS = ['나염', '자수', '나염/자수'];
const COLOR_PRESETS = ['블랙', '화이트', '그레이'];

const DETAIL_PAGE_DEFAULTS = {
  title: '',
  productName: '',
  category: '맨투맨',
  printType: '나염',
  color: '블랙',
};

// 이미지 보정 (CSS filter 기반)
const ADJ_DEFAULTS = { brightness: 100, hue: 0, saturate: 100, contrast: 100 };
const ADJ_CONTROLS = [
  { key: 'brightness', label: '밝기', min: 0,    max: 200, unit: '%' },
  { key: 'hue',        label: '색조', min: -180, max: 180, unit: '°' },
  { key: 'saturate',   label: '채도', min: 0,    max: 200, unit: '%' },
  { key: 'contrast',   label: '명도', min: 0,    max: 200, unit: '%' },
];
const adjToFilter = (adj) => {
  const a = { ...ADJ_DEFAULTS, ...(adj || {}) };
  return `brightness(${a.brightness}%) saturate(${a.saturate}%) contrast(${a.contrast}%) hue-rotate(${a.hue}deg)`;
};
const isDefaultAdj = (adj) =>
  ADJ_CONTROLS.every(c => (adj?.[c.key] ?? ADJ_DEFAULTS[c.key]) === ADJ_DEFAULTS[c.key]);

// 보정값을 이미지에 영구 적용한 dataURL 생성 (export 시 사용)
const applyAdjustments = (dataUrl, adj) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.filter = adjToFilter(adj);
    ctx.drawImage(img, 0, 0);
    resolve(canvas.toDataURL('image/jpeg', 0.95));
  };
  img.onerror = reject;
  img.src = dataUrl;
});

// 컨테이너 내 모든 <img> 로드 완료 대기
const waitForImages = (el) => {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(imgs.map(img =>
    (img.complete && img.naturalWidth) ? null : new Promise(res => { img.onload = res; img.onerror = res; })
  ));
};

// 정사각 썸네일 생성 (중앙 크롭 cover + 보정 적용)
const makeThumbnail = (dataUrl, adj, size = 500, quality = 0.92) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.filter = adjToFilter(adj);
    const w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.max(size / w, size / h); // cover
    const dw = w * scale, dh = h * scale;
    ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    resolve(canvas.toDataURL('image/jpeg', quality));
  };
  img.onerror = reject;
  img.src = dataUrl;
});

// 프리셋 + 직접입력 셀렉트
const PresetSelect = ({ value, onChange, options, placeholder, label }) => {
  const valueMatchesPreset = options.includes(value);
  // 직접입력 모드를 명시적으로 추적 — 사용자가 선택한 즉시 input이 떠야 함 (값이 비어 있어도)
  const [customMode, setCustomMode] = useState(!valueMatchesPreset && value !== '');

  // 외부에서 value가 프리셋으로 바뀌면 커스텀 모드 해제
  useEffect(() => {
    if (valueMatchesPreset) setCustomMode(false);
    else if (value !== '') setCustomMode(true);
  }, [value, valueMatchesPreset]);

  const showCustom = customMode || (!valueMatchesPreset && value !== '');
  const selectValue = showCustom ? '__custom' : value;

  return (
    <div className="space-y-1">
      <label className="text-[10px] text-gray-500 block mb-0.5">{label}</label>
      <select
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__custom') {
            setCustomMode(true);
            if (valueMatchesPreset) onChange('');
          } else {
            setCustomMode(false);
            onChange(e.target.value);
          }
        }}
        className="w-full border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:border-black bg-white"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        <option value="__custom">직접입력</option>
      </select>
      {showCustom && (
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
          <img src={s.src} alt="" style={{ width: '100%', height: 'auto', display: 'block', filter: adjToFilter(s.adj) }} />
        </div>
      ))}
    </section>
  </div>
);

// ==================== APP ====================
export default function App() {
  const [productImage, setProductImage] = useState(null);
  const [prints, setPrints] = useState([]); // [{ id, images: [dataUrl, ...], placement: {side, offsetY, offsetX, widthPct}, analysis, analyzing, error }]
  const [results, setResults] = useState({}); // { [side]: { status, dataUrl, error } }
  const [detailShotResults, setDetailShotResults] = useState({}); // { [sourceKey]: { status, dataUrl, error } } — 매거진 디테일 컷
  const [detailSelectionKeys, setDetailSelectionKeys] = useState([]); // ["printId|imgIdx", ...] — 디테일 소스로 선택된 사진 키들
  const [composeCount, setComposeCount] = useState(0);
  const isComposing = composeCount > 0;
  const [extraPrompt, setExtraPrompt] = useState('');
  const [showDetailPage, setShowDetailPage] = useState(false);
  const [detailMeta, setDetailMeta] = useState(DETAIL_PAGE_DEFAULTS);
  const [detailShots, setDetailShots] = useState([]); // [{ id, src }] 동적 슬롯
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureShots, setCaptureShots] = useState(null); // export 시 보정 구운 슬롯
  const [notification, setNotification] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('print_composer_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  // ---------- 나염 부분 handlers ----------
  // 배치 추천 → placement 형태로 변환
  const placementFromSuggestion = (sp, fallback) => sp ? {
    side: ['front', 'back'].includes(sp.side) ? sp.side : 'front',
    offsetY: sp.vertical,
    offsetX: sp.horizontal,
    widthPct: sp.width_pct,
  } : fallback;

  // 한 나염 부분 추가 (사진 여러 장 = 한 부분)
  const addPrintPart = async (dataUrls) => {
    const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
    if (urls.length === 0) return;
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newPrint = { id, images: urls, placement: { ...DEFAULT_PLACEMENT }, analysis: null, analyzing: true, error: null };
    setPrints(prev => [...prev, newPrint]);
    if (!apiKey) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: 'API Key 미설정' } : p));
      return;
    }
    try {
      const analysis = await analyzePrint({ apiKey, images: urls });
      setPrints(prev => prev.map(p => p.id === id
        ? { ...p, analysis, analyzing: false, placement: placementFromSuggestion(analysis.suggested_placement, p.placement) }
        : p));
    } catch (e) {
      setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: false, error: e.message } : p));
    }
  };

  // 한 부분에 사진 더 추가
  const addPrintRefs = (printId) => (dataUrls) => {
    const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
    setPrints(prev => prev.map(p => p.id === printId
      ? { ...p, images: [...p.images, ...urls] }
      : p));
  };

  const removePrintRef = (printId, imgIdx) => {
    setPrints(prev => prev.map(p => {
      if (p.id !== printId) return p;
      const newImages = p.images.filter((_, i) => i !== imgIdx);
      if (newImages.length === 0) return p;
      return { ...p, images: newImages };
    }));
    // 인덱스 시프트: 삭제된 idx의 키는 제거, 그보다 큰 idx는 -1
    setDetailSelectionKeys(prev => prev.flatMap(k => {
      const [pId, idxStr] = k.split('|');
      if (pId !== printId) return [k];
      const i = Number(idxStr);
      if (i === imgIdx) return [];
      if (i > imgIdx) return [`${pId}|${i - 1}`];
      return [k];
    }));
    setDetailShotResults(r => {
      const next = {};
      for (const [k, v] of Object.entries(r)) {
        const [pId, idxStr] = k.split('|');
        if (pId !== printId) { next[k] = v; continue; }
        const i = Number(idxStr);
        if (i === imgIdx) continue;
        if (i > imgIdx) next[`${pId}|${i - 1}`] = v;
        else next[k] = v;
      }
      return next;
    });
  };

  const reanalyzePrint = async (id) => {
    const target = prints.find(p => p.id === id);
    if (!target || !apiKey) return;
    setPrints(prev => prev.map(p => p.id === id ? { ...p, analyzing: true, error: null } : p));
    try {
      const analysis = await analyzePrint({ apiKey, images: target.images });
      setPrints(prev => prev.map(p => p.id === id
        ? { ...p, analysis, analyzing: false, placement: placementFromSuggestion(analysis.suggested_placement, p.placement) }
        : p));
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
    // 해당 print의 모든 디테일 소스 선택/결과 제거
    setDetailSelectionKeys(prev => prev.filter(k => !k.startsWith(`${id}|`)));
    setDetailShotResults(r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith(`${id}|`))));
  };

  // ---------- detail source selection ----------
  const sourceKey = (printId, imgIdx) => `${printId}|${imgIdx}`;
  const isDetailSelected = (printId, imgIdx) => detailSelectionKeys.includes(sourceKey(printId, imgIdx));
  const toggleDetailSelection = (printId, imgIdx) => {
    const key = sourceKey(printId, imgIdx);
    setDetailSelectionKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  // ---------- placement handlers (부분별) ----------
  const updatePrintPlacement = (printId, field, value) => {
    setPrints(prev => prev.map(p => {
      if (p.id !== printId) return p;
      const placement = { ...(p.placement || DEFAULT_PLACEMENT), [field]: value };
      // side 변경 시 세로/좌우 값이 해당 면에 없으면 center로 보정
      if (field === 'side') {
        if (!(OFFSET_Y_BY_SIDE[value] || []).some(o => o.value === placement.offsetY)) placement.offsetY = 'center';
        if (!(OFFSET_X_BY_SIDE[value] || []).some(o => o.value === placement.offsetX)) placement.offsetX = 'center';
      }
      return { ...p, placement };
    }));
  };

  // ---------- compose ----------
  // 공통 검증
  const validateCompose = () => {
    if (!apiKey) { showNotification('API Key를 먼저 설정하세요', 'error'); return false; }
    if (!productImage) { showNotification('제품컷을 업로드하세요', 'error'); return false; }
    if (prints.length === 0) { showNotification('나염 부분을 1개 이상 추가하세요', 'error'); return false; }
    if (prints.some(p => p.analyzing)) { showNotification('아직 분석 중인 나염 부분이 있습니다', 'error'); return false; }
    if (!prints.some(p => p.analysis)) { showNotification('분석 완료된 나염 부분이 없습니다', 'error'); return false; }
    return true;
  };

  // 내부: view 1개 합성 (isComposing 카운트 관리 X)
  const composeViewInternal = async (viewKey) => {
    const view = VIEWS.find(v => v.key === viewKey);
    if (!view) return;
    const items = prints
      .filter(p => p.analysis && p.placement && view.sides.includes(p.placement.side))
      .map(p => ({ placement: p.placement, printImages: p.images, printType: p.analysis.type }));
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
    const hasItems = prints.some(p => p.analysis && p.placement && view.sides.includes(p.placement.side));
    if (!hasItems) {
      showNotification(`${view.label}에 배치된 나염 부분이 없습니다`, 'error');
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

  // 내부: 디테일 생성 (선택된 소스만, isComposing 카운트 관리 X)
  const composeDetailShotsInternal = async () => {
    if (detailSelectionKeys.length === 0) return;

    const initial = { ...detailShotResults };
    detailSelectionKeys.forEach(k => { initial[k] = { status: 'pending' }; });
    setDetailShotResults(initial);

    await Promise.all(detailSelectionKeys.map(async (key) => {
      const [printId, idxStr] = key.split('|');
      const print = prints.find(p => p.id === printId);
      const img = print?.images?.[Number(idxStr)];
      if (!img) {
        setDetailShotResults(r => ({ ...r, [key]: { status: 'error', error: '소스 이미지 없음' } }));
        return;
      }
      try {
        const dataUrl = await composeDetail({ apiKey, sourceImage: img, printType: print.analysis?.type });
        setDetailShotResults(r => ({ ...r, [key]: { status: 'done', dataUrl } }));
      } catch (e) {
        setDetailShotResults(r => ({ ...r, [key]: { status: 'error', error: e.message } }));
      }
    }));
  };

  // 디테일 생성 (개별 버튼)
  const composeDetailShots = async () => {
    if (!apiKey) { showNotification('API Key를 먼저 설정하세요', 'error'); return; }
    if (prints.length === 0) { showNotification('프린트를 1개 이상 업로드하세요', 'error'); return; }
    if (detailSelectionKeys.length === 0) { showNotification('디테일 소스를 1장 이상 체크하세요 (분석/배치 카드 안에서 사진에 체크)', 'error'); return; }
    // 선택된 키의 print 들만 분석 완료 확인
    const involvedPrintIds = new Set(detailSelectionKeys.map(k => k.split('|')[0]));
    for (const pid of involvedPrintIds) {
      const p = prints.find(pp => pp.id === pid);
      if (!p) continue;
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
  const newSlot = (src = null) => ({ id: newSlotId(), src, adj: { ...ADJ_DEFAULTS } });

  // 자동 채움 콘텐츠 빌드 (합성 결과만 — 정면/후면 + AI 디테일 컷)
  const buildAutoFillShots = () => {
    const initial = [];
    const push = (src) => { if (src) initial.push(newSlot(src)); };
    push(results.front_view?.dataUrl);
    push(results.back_view?.dataUrl);
    // AI가 생성한 디테일 컷만 (프린트 풀 원본은 포함 X)
    Object.values(detailShotResults).forEach(r => {
      if (r?.status === 'done') push(r.dataUrl);
    });
    return initial;
  };

  const openDetailPage = () => {
    // 모든 슬롯이 비어있으면(또는 슬롯 자체가 없으면) 현재 합성 결과로 자동 채움.
    // 사용자가 직접 업로드한 슬롯이 하나라도 있으면 유지.
    const allEmpty = detailShots.length === 0 || detailShots.every(s => !s.src);
    if (allEmpty) {
      const initial = buildAutoFillShots();
      if (initial.length === 0) initial.push(newSlot());
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
    setDetailShots(prev => [...prev, newSlot()]);
  };

  const updateDetailShot = (id) => async (dataUrl) => {
    setDetailShots(prev => prev.map(s => s.id === id ? { ...s, src: dataUrl } : s));
  };

  const updateDetailShotAdj = (id, key, value) => {
    setDetailShots(prev => prev.map(s => s.id === id
      ? { ...s, adj: { ...ADJ_DEFAULTS, ...(s.adj || {}), [key]: value } }
      : s));
  };

  const resetDetailShotAdj = (id) => {
    setDetailShots(prev => prev.map(s => s.id === id ? { ...s, adj: { ...ADJ_DEFAULTS } } : s));
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
      // 보정값을 이미지에 미리 굽기 (html2canvas는 CSS filter를 신뢰성 있게 렌더하지 못함)
      const baked = await Promise.all(detailShots.map(async (s) => {
        if (!s.src || isDefaultAdj(s.adj)) return { ...s, adj: { ...ADJ_DEFAULTS } };
        try {
          const src = await applyAdjustments(s.src, s.adj);
          return { ...s, src, adj: { ...ADJ_DEFAULTS } };
        } catch {
          return { ...s, adj: { ...ADJ_DEFAULTS } };
        }
      }));
      setCaptureShots(baked);

      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) {}
      }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await waitForImages(el);

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
      setCaptureShots(null);
      setIsCapturing(false);
    }
  };

  // 1번 슬롯 사진 → 500x500 JPG (th.jpg)
  const downloadThumbnail = async () => {
    const first = detailShots[0];
    if (!first?.src) { showNotification('1번 사진이 없습니다', 'error'); return; }
    try {
      const dataUrl = await makeThumbnail(first.src, first.adj, 500);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'th.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showNotification('썸네일 다운로드 완료 (th.jpg · 500×500)');
    } catch (e) {
      showNotification('썸네일 생성 실패: ' + (e.message || e), 'error');
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

        {/* ============ Left: Inputs + Analysis/Placement ============ */}
        <section className="col-span-7 border-r border-black overflow-y-auto p-5 bg-white">
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">1. 입력</h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">제품 누끼</label>
              <ImageDropZone
                value={productImage}
                onChange={setProductImage}
                label="제품 누끼 업로드"
                icon={LucideUploadCloud}
              />
              <p className="text-[10px] text-gray-400 mt-1">결과 비율은 이 이미지 비율을 따릅니다 · 흰 배경/누끼 권장</p>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block">나염 부분 추가</label>
              <ImageDropZone
                value={null}
                onMultiple={addPrintPart}
                label="한 부분의 사진들을 한꺼번에 드래그"
                icon={LucidePlus}
                multiple
              />
              <p className="text-[10px] text-gray-400 mt-1">같은 나염(예: 앞가슴)의 사진 여러 장을 <b>한 번에</b> → 한 부분으로 묶여 자동 분석. 크기 참고 사진(착장샷·자 등)도 같이 넣으면 크기 자동 산정.</p>
            </div>
          </div>

          <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4 pt-3 border-t border-gray-200">2. 분석 / 배치</h2>

          {prints.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-20 border border-dashed border-gray-200">
              <LucideWand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>왼쪽에서 나염 부분을 추가하면<br />여기에 사진·종류·크기·위치 카드가 표시됩니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {prints.map((p, idx) => {
                const pl = p.placement || DEFAULT_PLACEMENT;
                const yOpts = OFFSET_Y_BY_SIDE[pl.side] || [];
                const xOpts = OFFSET_X_BY_SIDE[pl.side] || [];
                return (
                  <div key={p.id} className="border border-black bg-white">
                    {/* 헤더: 썸네일 + 종류 + 재분석/삭제 */}
                    <div className="flex items-center gap-2 p-2 border-b border-gray-200 bg-gray-50">
                      <div className="w-9 h-9 border border-gray-200 shrink-0 overflow-hidden bg-white">
                        <img src={p.images[0]} alt="" className="w-full h-full object-contain" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider shrink-0">나염 #{idx + 1}</span>
                      {p.analyzing ? (
                        <span className="text-xs text-gray-500 flex items-center gap-1"><LucideLoader2 className="w-3 h-3 animate-spin" /> 분석 중...</span>
                      ) : p.error ? (
                        <span className="text-xs text-red-600 truncate">{p.error}</span>
                      ) : p.analysis ? (
                        <select value={p.analysis.type}
                          onChange={(e) => updatePrintType(p.id, e.target.value)}
                          className="text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black">
                          {PRINT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      ) : null}
                      <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => reanalyzePrint(p.id)} disabled={p.analyzing}
                          className="p-1 hover:bg-gray-100 disabled:opacity-30" title="다시 분석 (모든 사진 참고)">
                          <LucideRefreshCw className={`w-3.5 h-3.5 ${p.analyzing ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={() => removePrint(p.id)}
                          className="p-1 hover:bg-gray-100 text-gray-400 hover:text-black" title="이 나염 부분 삭제">
                          <LucideTrash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="p-2 space-y-3">
                      {p.analysis?.notes && (
                        <p className="text-[10px] text-gray-500 leading-relaxed">{p.analysis.notes}</p>
                      )}

                      {/* 사진들 + 디테일 출력 선택 */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">사진 ({p.images.length}장)</span>
                          <span className="text-[10px] text-gray-400">★ = 디테일로 출력</span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {p.images.map((img, imgIdx) => {
                            const selected = isDetailSelected(p.id, imgIdx);
                            return (
                              <div key={imgIdx}
                                className={`relative group w-14 h-14 border bg-white overflow-hidden cursor-pointer ${selected ? 'border-black border-2' : 'border-gray-300'}`}
                                onClick={() => toggleDetailSelection(p.id, imgIdx)}
                                title={selected ? '디테일 출력에서 제외' : '디테일로 출력할 사진으로 선택'}>
                                <img src={img} alt="" className="w-full h-full object-contain" />
                                <div className="absolute top-0 left-0 bg-black text-white text-[8px] font-bold px-0.5">
                                  {imgIdx === 0 ? '메인' : imgIdx + 1}
                                </div>
                                {selected && (
                                  <div className="absolute bottom-0 left-0 bg-black text-white text-[9px] font-bold px-1 leading-none py-0.5">★</div>
                                )}
                                {p.images.length > 1 && (
                                  <button onClick={(e) => { e.stopPropagation(); removePrintRef(p.id, imgIdx); }}
                                    className="absolute top-0 right-0 bg-white border border-black p-0.5 opacity-0 group-hover:opacity-100 hover:bg-black hover:text-white">
                                    <LucideX className="w-2 h-2" />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                          <div className="w-14 h-14">
                            <ImageDropZone
                              value={null}
                              onMultiple={addPrintRefs(p.id)}
                              label="+"
                              icon={LucidePlus}
                              multiple
                            />
                          </div>
                        </div>
                      </div>

                      {/* 위치 / 크기 */}
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                        <div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">면</span>
                          <select value={pl.side}
                            onChange={(e) => updatePrintPlacement(p.id, 'side', e.target.value)}
                            className="w-full text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black mt-0.5">
                            {SIDES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">크기 (자동·수정가능)</span>
                          <div className="flex items-center gap-1 mt-0.5">
                            <input type="number" value={pl.widthPct} min="1" max="80"
                              onChange={(e) => updatePrintPlacement(p.id, 'widthPct', Number(e.target.value))}
                              className="w-full border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:border-black" />
                            <span className="text-[10px] text-gray-400 shrink-0">% 폭</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">세로</span>
                          <select value={pl.offsetY}
                            onChange={(e) => updatePrintPlacement(p.id, 'offsetY', e.target.value)}
                            className="w-full text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black mt-0.5">
                            {yOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">좌우</span>
                          <select value={pl.offsetX}
                            onChange={(e) => updatePrintPlacement(p.id, 'offsetX', e.target.value)}
                            className="w-full text-xs border border-gray-300 px-2 py-1 focus:outline-none focus:border-black mt-0.5">
                            {xOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
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
            disabled={isComposing || !prints.some(p => p.analysis)}
            className="w-full mt-3 py-3 bg-black text-white text-sm font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-gray-800 flex items-center justify-center gap-2"
          >
            {isComposing
              ? <><LucideLoader2 className="w-4 h-4 animate-spin" /> 전체 합성 중...</>
              : <><LucideWand2 className="w-4 h-4" /> 전체 합성 (앞·뒤·디테일)</>}
          </button>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button
              onClick={() => composeOneView('front_view')}
              disabled={isComposing || !prints.some(p => p.analysis && p.placement?.side === 'front')}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title="앞면만 합성"
            >
              {results.front_view?.status === 'pending'
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 앞면</>
                : <>앞면</>}
            </button>
            <button
              onClick={() => composeOneView('back_view')}
              disabled={isComposing || !prints.some(p => p.analysis && p.placement?.side === 'back')}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title="뒷면만 합성"
            >
              {results.back_view?.status === 'pending'
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 뒷면</>
                : <>뒷면</>}
            </button>
            <button
              onClick={composeDetailShots}
              disabled={isComposing || prints.length === 0 || detailSelectionKeys.length === 0}
              className="py-2 border border-black text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-30 hover:bg-black hover:text-white flex items-center justify-center gap-1"
              title={detailSelectionKeys.length === 0 ? '체크된 사진 없음' : `${detailSelectionKeys.length}장 디테일 생성`}
            >
              {Object.values(detailShotResults).some(r => r?.status === 'pending')
                ? <><LucideLoader2 className="w-3 h-3 animate-spin" /> 디테일</>
                : <>디테일 ({detailSelectionKeys.length})</>}
            </button>
          </div>
        </section>

        {/* ============ Right: Results ============ */}
        <section className="col-span-5 overflow-y-auto p-5 bg-gray-50">
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

          {/* Generated detail shots (1:1, dynamic count from selection) */}
          {Object.keys(detailShotResults).length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">디테일 ({Object.keys(detailShotResults).length}장)</div>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(detailShotResults).map(([key, r], i) => {
                  const [printId, idxStr] = key.split('|');
                  const printIdx = prints.findIndex(p => p.id === printId);
                  const refLabel = idxStr === '0' ? '메인' : `참고 ${idxStr}`;
                  const labelText = printIdx >= 0 ? `#${printIdx + 1} ${refLabel}` : `디테일 ${i + 1}`;
                  return (
                    <div key={key} className="aspect-square bg-white border border-gray-200 flex flex-col relative overflow-hidden">
                      {r.status === 'pending' ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                          <LucideLoader2 className="w-6 h-6 animate-spin mb-1" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">{labelText}</span>
                        </div>
                      ) : r.status === 'error' ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-red-500 px-2 text-center">
                          <LucideXCircle className="w-6 h-6 mb-1" />
                          <span className="text-[10px] font-bold uppercase tracking-wider mb-1">{labelText}</span>
                          <span className="text-[9px] text-red-400 leading-tight">{r.error}</span>
                        </div>
                      ) : (
                        <>
                          <img src={r.dataUrl} alt={labelText} className="w-full h-full object-contain" />
                          <div className="absolute top-1 left-1 bg-black text-white text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5">
                            {labelText}
                          </div>
                          <button onClick={() => downloadResult(`detail_${i + 1}`, r.dataUrl)}
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
              <span className="text-[10px] text-gray-400 ml-2">1000px 고정 · JPG/PNG · 썸네일 500px</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={downloadThumbnail} disabled={isCapturing}
                className="text-[11px] font-bold uppercase tracking-wider border border-black px-3 py-1.5 hover:bg-black hover:text-white disabled:opacity-50 flex items-center gap-1">
                <LucideDownload className="w-3 h-3" /> 썸네일
              </button>
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
                  {detailShots.map((slot, idx) => {
                    const adjusted = !isDefaultAdj(slot.adj);
                    return (
                    <div key={slot.id} className="p-2 border border-gray-200 bg-white space-y-2">
                      <div className="flex items-start gap-2">
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
                      {slot.src && (
                        <details className="border-t border-gray-100 pt-1.5">
                          <summary className="text-[10px] font-bold uppercase tracking-wider text-gray-400 cursor-pointer list-none flex items-center gap-1">
                            <LucideSettings className="w-3 h-3" />
                            <span>보정</span>
                            {adjusted && <span className="w-1.5 h-1.5 rounded-full bg-black inline-block ml-0.5" />}
                          </summary>
                          <div className="space-y-1.5 mt-2">
                            {ADJ_CONTROLS.map(c => (
                              <div key={c.key}>
                                <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                                  <span>{c.label}</span>
                                  <span className="tabular-nums">{slot.adj?.[c.key] ?? ADJ_DEFAULTS[c.key]}{c.unit}</span>
                                </div>
                                <input type="range" min={c.min} max={c.max}
                                  value={slot.adj?.[c.key] ?? ADJ_DEFAULTS[c.key]}
                                  onChange={(e) => updateDetailShotAdj(slot.id, c.key, Number(e.target.value))}
                                  className="w-full accent-black h-1" />
                              </div>
                            ))}
                            <button onClick={() => resetDetailShotAdj(slot.id)} disabled={!adjusted}
                              className="mt-1 text-[10px] font-bold uppercase tracking-wider border border-gray-300 text-gray-600 px-2 py-1 hover:bg-gray-100 disabled:opacity-30 w-full flex items-center justify-center gap-1">
                              <LucideRefreshCw className="w-3 h-3" /> 보정 초기화
                            </button>
                          </div>
                        </details>
                      )}
                    </div>
                  );})}
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
                <DetailPage meta={detailMeta} shots={captureShots || detailShots} />
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
