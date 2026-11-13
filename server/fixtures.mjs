// Deliberately synthetic fixtures. Never imported into the operational database.
// They do not describe actual Geumjeongsan routes and cannot be departure advice.
export const demoCourses = Object.freeze([
  { id: 'demo-short', title: '[가상 예시] 짧은 산책 코스', summary: '화면과 추천 조건을 확인하는 가상 데이터입니다. 실제 길·거리·시간 안내로 사용하지 마세요.', durationMinutes: 45, difficulty: 'easy', themes: ['nature'], startPoint: '가상 출발지 A', translations: {
    en: { title: '[Fictional example] Short walking route', summary: 'Synthetic data for testing screens and recommendation conditions. Do not use it as guidance for real paths, distances, or travel times.', startPoint: 'Fictional starting point A' },
    'zh-TW': { title: '[虛構範例] 短程散步路線', summary: '這是用於測試畫面及推薦條件的虛構資料，請勿作為實際道路、距離或所需時間的指引。', startPoint: '虛構起點 A' }
  } },
  { id: 'demo-culture', title: '[가상 예시] 문화 탐방 코스', summary: '실제 관광지나 연결 경로가 아닙니다. 검수된 운영 코스와 분리된 화면 시험 자료입니다.', durationMinutes: 90, difficulty: 'moderate', themes: ['culture'], startPoint: '가상 출발지 B', translations: {
    en: { title: '[Fictional example] Cultural exploration route', summary: 'This is not a real attraction or connecting route. It is screen-testing data kept separate from reviewed operational routes.', startPoint: 'Fictional starting point B' },
    'zh-TW': { title: '[虛構範例] 文化探索路線', summary: '這並非實際景點或連接路線，而是與經審核的正式路線分開保存的畫面測試資料。', startPoint: '虛構起點 B' }
  } },
  { id: 'demo-view', title: '[가상 예시] 전망 탐방 코스', summary: '조건 변경과 카드 화면을 시험하기 위한 가상 예시입니다. 현장 이용을 위한 정보가 아닙니다.', durationMinutes: 150, difficulty: 'hard', themes: ['views'], startPoint: '가상 출발지 C', translations: {
    en: { title: '[Fictional example] Scenic exploration route', summary: 'A fictional example for testing condition changes and route cards. It is not information for use on an actual trip.', startPoint: 'Fictional starting point C' },
    'zh-TW': { title: '[虛構範例] 景觀探索路線', summary: '這是用於測試條件變更與路線卡片的虛構範例，並非供實地旅遊使用的資訊。', startPoint: '虛構起點 C' }
  } },
].map(course => Object.freeze({ ...course, sourceUrl: '', sourceEffectiveAt: null, fetchedAt: null, reviewedAt: null, reviewer: null, reviewed: false, sourceFingerprint: null, translationSourceFingerprint: null, translationContentFingerprint: null, status: 'draft', condition: 'unknown', conditionValidUntil: null, translationStatus: 'pending', isFixture: true, recommendationEligible: false, version: 1 })));
