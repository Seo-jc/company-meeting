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
