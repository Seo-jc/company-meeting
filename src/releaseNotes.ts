export type ReleaseNote = {
  version: string;
  date: string;
  highlight?: string; // One-line headline for the version
  added?: string[];
  fixed?: string[];
  changed?: string[];
};

/**
 * Release notes shown in the "변경 사항 공지" modal that appears on the
 * first launch after an auto-update. Order: newest first.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.11.0',
    date: '2026-07-21',
    highlight: '새 로고와 영문 표기 적용',
    changed: [
      '새 로고 적용 — 모니터 안에 마이크가 들어간 형태 (화면 공유 + 음성 회의를 함께 상징)',
      '제품명 표기를 영문으로 통일: 픽미팅 → PikMeeting',
      '개발자 표기를 영문으로 변경: 서정천 → Seo Jeong-Cheon',
      '사용자 메뉴얼 표지와 본문도 새 로고·표기로 갱신',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-07-05',
    highlight: '프로그램 이름이 «픽미팅» 으로 바뀌었습니다',
    changed: [
      '프로그램 이름 변경: 사내 미팅 프로그램 → 픽미팅 (픽PDF·픽스텝과 같은 픽 제품군)',
      '바탕화면·시작 메뉴 바로가기 이름도 «픽미팅» 으로 변경',
      '설치 파일 이름 변경: PikMeeting-Setup-x.x.x.exe',
      '사용자 메뉴얼 내용도 새 이름으로 갱신',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-06-22',
    highlight: '회의 중 끊김 자동 복구',
    fixed: [
      '회의 중 음성/화면 공유가 끊긴 뒤 복구되지 않던 문제 — 이제 나갔다 다시 들어오지 않아도 자동으로 다시 연결됩니다',
      '네트워크가 잠깐 불안정할 때 연결이 끊어지던 문제 (회사 방화벽의 유휴 연결 차단 대응)',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-06-04',
    highlight: '참가자/화면 공유가 안 보이던 문제 해결',
    fixed: [
      '회의 입장 시 일부 기존 참가자가 보이지 않던 문제 (입장 타이밍 경쟁 조건)',
      '내가 들어가기 전부터 진행 중이던 화면 공유가 나에게 안 보이던 문제',
    ],
  },
  {
    version: '1.8.5',
    date: '2026-06-03',
    highlight: '일부 디자인 변경',
  },
  {
    version: '1.8.4',
    date: '2026-06-03',
    highlight: '저장된 회의 추가 시 이름 변경 가능',
    added: [
      '최근 회의의 📌 버튼 클릭 시 이름 입력 다이얼로그 표시',
      '예: "A1234" 코드를 "마케팅 정기 회의" 같은 의미있는 이름으로 저장 가능',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-06-03',
    highlight: '일부 디자인 변경',
  },
  {
    version: '1.8.0',
    date: '2026-06-03',
    highlight: '의견·기능 제안 보내기 기능 추가',
    added: [
      '로비 화면에 "💡 의견 보내기" 버튼 추가',
      '4가지 종류로 분류 가능: 🆕 기능 추가 / ✨ 기존 기능 개선 / 🤔 사용성 문제 / 💬 기타',
      '한 줄 요약 + 자세한 내용 + 이름(선택) 입력 후 전송',
      '개발자가 검토 후 향후 업데이트에 반영',
    ],
    changed: [
      '회의 화면에서 파일 전송 실패 시 정확한 사유 표시 (예: "받을 사람이 없습니다. 다른 참가자가 입장한 후 다시 시도해 주세요.")',
    ],
  },
  {
    version: '1.7.7',
    date: '2026-06-03',
    highlight: '회의 입장 시 검은 화면 긴급 수정',
    fixed: [
      'v1.7.6 줌 기능 추가 시 React Hook 순서 위반으로 회의 화면이 검게 나오던 문제',
    ],
  },
  {
    version: '1.7.6',
    date: '2026-06-03',
    highlight: '회의 화면 개선 + 설치 마법사 없는 무중단 업데이트',
    added: [
      '확대된 공유 화면을 마우스 휠로 줌인/줌아웃 가능 (최대 5배)',
      '확대 상태에서 마우스 드래그로 보이는 영역 이동 (팬)',
      '우측 하단에 줌 컨트롤 (−, 100%, +) 표시',
      '베트남 등 국제 P2P 연결을 위한 TURN 서버 지원',
      '버그 자동 수집 시스템 (개발자 전용)',
      '마이크/스피커 테스트 (오디오 설정에서 신호음 + 레벨 미터)',
    ],
    changed: [
      '확대 화면 시 다른 참가자 타일이 화면 하단 → 우측 세로 정렬로 이동 (메인 영역 가리지 않음)',
      '자동 업데이트 적용 시 NSIS 설치 마법사 표시 안 함 → 조용히 설치되고 자동 재실행',
      '신규 설치 시에도 마법사 없이 원클릭 설치',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-06-03',
    highlight: '회의 입장 시 화면이 검게 나오는 문제 긴급 수정',
    fixed: [
      'v1.7.0에서 회의방에 들어가면 빈 검은 화면만 보이던 버그 (React Hook 순서 위반)',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-06-03',
    highlight: '발언자 강조 + 파일 공유',
    added: [
      '현재 말하고 있는 참가자 타일에 청록색 펄스 테두리 표시',
      '채팅 패널에서 파일 첨부 (📎 버튼) 또는 드래그앤드롭으로 P2P 전송 (최대 200 MB)',
      '파일 전송/수신 진행률 실시간 표시 + 완료 시 "저장" 버튼',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-06-02',
    highlight: '디스크 공간 절약',
    changed: [
      '업데이트 적용 후 다운로드된 이전 버전 설치 파일을 자동으로 정리합니다 (약 80MB 절약)',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-06-02',
    highlight: '일부 기능 보완 및 디자인 개선',
  },
  {
    version: '1.5.0',
    date: '2026-06-02',
    highlight: '최근 참여한 회의를 한눈에 확인할 수 있습니다',
    added: [
      '로비 우측 상단에 "최근 회의" 패널 추가 (최대 10개, 자동 기록)',
      '최근 회의를 클릭하면 같은 코드로 다시 참가됩니다',
      '📌 버튼으로 최근 회의를 "저장된 회의"로 승격할 수 있습니다',
      '✕ 버튼으로 최근 목록에서 삭제 가능',
    ],
  },
  {
    version: '1.4.2',
    date: '2026-06-02',
    highlight: '변경 사항 안내 창이 정상적으로 표시되도록 수정',
    fixed: [
      'v1.4.1에서 도입된 변경 사항 팝업이 기존 사용자에게 표시되지 않던 문제 해결',
    ],
    added: [
      '좌측 하단의 버전 표시(v1.4.2 · 개발자 서정천)를 클릭하면 언제든 변경 이력을 볼 수 있습니다',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-06-02',
    highlight: '업데이트 후 변경 사항을 한눈에 확인하세요',
    added: [
      '새 버전으로 업데이트되면 자동으로 변경 사항 안내 창이 표시됩니다',
      '이전 버전들의 변경 이력도 함께 확인할 수 있습니다',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-06-02',
    highlight: '업데이트 진행 상황을 실시간으로 보여드립니다',
    added: [
      '상단 중앙에 업데이트 진행 배너 추가 (새 버전 발견 / 다운로드 진행률 / 준비 완료)',
      '"지금 적용" 버튼으로 즉시 새 버전으로 재시작 가능',
    ],
    changed: [
      '스크롤바를 어두운 테마에 맞게 얇고 부드럽게 변경',
      '로비 화면 카드 여백 조정으로 스크롤 필요성 감소',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-06-02',
    highlight: '사용자 메뉴얼이 추가되었습니다',
    added: [
      '로비 화면 하단에 "📖 사용자 메뉴얼" 버튼 추가',
      '10페이지 분량의 상세 메뉴얼 (사용법, 문제 해결, FAQ 포함)',
      '메뉴얼에서 "PDF 저장 / 인쇄" 기능으로 PDF 보관 가능',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-06-02',
    highlight: '채팅창에서 버전 표시가 가려지는 문제 해결',
    fixed: [
      '채팅 패널을 열었을 때 우측 하단의 버전 배지와 채팅 전송 버튼이 겹치는 문제',
    ],
    changed: ['버전 표시 위치를 우측 하단에서 좌측 하단으로 이동'],
  },
  {
    version: '1.2.0',
    date: '2026-06-02',
    highlight: '마이크 없는 PC에서도 회의 참여가 가능합니다',
    added: [
      '듣기 전용 모드 - 마이크가 없거나 권한이 없어도 회의 입장 가능',
      '듣기 전용 모드에서도 채팅, 화면 보기, 화면 공유는 정상 사용',
      '회의 상단에 듣기 전용 모드 안내 배너 표시',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-06-02',
    highlight: '마이크 에러를 더 친절하게 안내합니다',
    added: [
      '마이크 에러 유형별 한국어 안내 메시지 (권한 거부, 장치 없음, 사용 중 등)',
      '"Windows 마이크 설정 열기" 버튼 - 한 번 클릭으로 권한 페이지 이동',
      '"다시 시도" 버튼으로 앱 재시작 없이 재연결',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-06-02',
    highlight: '자동 업데이트가 도입되었습니다',
    added: [
      'GitHub Releases 기반 자동 업데이트 시스템',
      '백그라운드 다운로드 + 사용자 확인 후 적용',
      '향후 모든 버전이 별도 설치 없이 자동 배포',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-02',
    highlight: '사내 미팅 프로그램 정식 출시',
    added: [
      'P2P 방식의 다자간 음성 회의',
      '화면 공유 (전체 화면 / 특정 창 선택 가능)',
      '실시간 텍스트 채팅',
      '4~10자리 회의 코드 시스템',
      '저장된 회의 목록 + 실시간 참가자 수 표시',
      '마이크/스피커 장치 선택',
    ],
  },
];

/**
 * Find a release note for a specific version, or undefined if not listed.
 */
export function getReleaseNote(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((n) => n.version === version);
}

/**
 * Get all release notes newer than (or equal to) a given version,
 * so users who skipped several versions see everything they missed.
 */
export function getNotesAfter(version: string): ReleaseNote[] {
  const idx = RELEASE_NOTES.findIndex((n) => n.version === version);
  if (idx === -1) {
    // Unknown previous version - just show the latest one.
    return RELEASE_NOTES.slice(0, 1);
  }
  return RELEASE_NOTES.slice(0, idx);
}
