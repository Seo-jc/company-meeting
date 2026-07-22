import type { Lang } from './i18n';

/** Bilingual single line. */
type L = { ko: string; en: string };
/** Bilingual list of lines. */
type LL = { ko: string[]; en: string[] };

export type ReleaseNote = {
  version: string;
  date: string;
  highlight?: L;
  added?: LL;
  fixed?: LL;
  changed?: LL;
};

/** Flattened, single-language shape the UI renders. */
export type LocalReleaseNote = {
  version: string;
  date: string;
  highlight?: string;
  added?: string[];
  fixed?: string[];
  changed?: string[];
};

export function localizeNote(n: ReleaseNote, lang: Lang): LocalReleaseNote {
  return {
    version: n.version,
    date: n.date,
    highlight: n.highlight?.[lang],
    added: n.added?.[lang],
    fixed: n.fixed?.[lang],
    changed: n.changed?.[lang],
  };
}

/**
 * Release notes shown in the changelog modal that appears on the
 * first launch after an auto-update. Order: newest first.
 */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.12.0',
    date: '2026-07-22',
    highlight: {
      ko: '한국어 / 영어 언어 전환 기능 추가',
      en: 'Added Korean / English language switching',
    },
    added: {
      ko: [
        '로비 오른쪽 위 🌐 버튼으로 한국어 ↔ English 를 즉시 전환',
        '선택한 언어는 저장되어 다음 실행에도 그대로 유지됩니다',
        '영문 사용자 메뉴얼 추가 (영어 모드에서 메뉴얼을 열면 영문판이 나옵니다)',
      ],
      en: [
        'Switch between Korean and English instantly with the 🌐 button at the top-right of the lobby',
        'Your chosen language is saved and kept on the next launch',
        'English user manual added (opens automatically when the app is in English mode)',
      ],
    },
    changed: {
      ko: [
        '앱 전체 화면(로비·회의실·채팅·설정·팝업·알림)을 선택한 언어로 표시',
        '베트남 법인 등 해외 사용자를 위한 준비 — 이후 다른 언어도 추가할 수 있는 구조',
      ],
      en: [
        'The entire app (lobby, meeting room, chat, settings, popups, notifications) now follows the selected language',
        'Groundwork for overseas users such as the Vietnam branch — the structure allows adding more languages later',
      ],
    },
  },
  {
    version: '1.11.0',
    date: '2026-07-21',
    highlight: {
      ko: '새 로고와 영문 표기 적용',
      en: 'New logo and English naming',
    },
    changed: {
      ko: [
        '새 로고 적용 — 모니터 안에 마이크가 들어간 형태 (화면 공유 + 음성 회의를 함께 상징)',
        '제품명 표기를 영문으로 통일: 픽미팅 → PikMeeting',
        '개발자 표기를 영문으로 변경: 서정천 → Seo Jeong-Cheon',
        '사용자 메뉴얼 표지와 본문도 새 로고·표기로 갱신',
      ],
      en: [
        'New logo — a microphone inside a monitor (symbolizing screen sharing + voice meetings)',
        'Product name unified in English: PikMeeting',
        'Developer credit changed to English: Seo Jeong-Cheon',
        'User manual cover and body updated with the new logo and naming',
      ],
    },
  },
  {
    version: '1.10.0',
    date: '2026-07-05',
    highlight: {
      ko: '프로그램 이름이 «픽미팅» 으로 바뀌었습니다',
      en: 'The app is now named «PikMeeting»',
    },
    changed: {
      ko: [
        '프로그램 이름 변경: 사내 미팅 프로그램 → 픽미팅 (픽PDF·픽스텝과 같은 픽 제품군)',
        '바탕화면·시작 메뉴 바로가기 이름도 «픽미팅» 으로 변경',
        '설치 파일 이름 변경: PikMeeting-Setup-x.x.x.exe',
        '사용자 메뉴얼 내용도 새 이름으로 갱신',
      ],
      en: [
        'Renamed to PikMeeting (same Pik product family as PikPDF and PikStep)',
        'Desktop and Start Menu shortcut renamed to «PikMeeting»',
        'Installer renamed: PikMeeting-Setup-x.x.x.exe',
        'User manual updated with the new name',
      ],
    },
  },
  {
    version: '1.9.1',
    date: '2026-06-22',
    highlight: {
      ko: '회의 중 끊김 자동 복구',
      en: 'Automatic recovery from mid-meeting drops',
    },
    fixed: {
      ko: [
        '회의 중 음성/화면 공유가 끊긴 뒤 복구되지 않던 문제 — 이제 나갔다 다시 들어오지 않아도 자동으로 다시 연결됩니다',
        '네트워크가 잠깐 불안정할 때 연결이 끊어지던 문제 (회사 방화벽의 유휴 연결 차단 대응)',
      ],
      en: [
        'Voice/screen sharing not recovering after a drop mid-meeting — it now reconnects automatically without leaving and rejoining',
        'Connection dropping during brief network instability (handles idle-connection blocking by corporate firewalls)',
      ],
    },
  },
  {
    version: '1.9.0',
    date: '2026-06-04',
    highlight: {
      ko: '참가자/화면 공유가 안 보이던 문제 해결',
      en: 'Fixed participants/screen share not appearing',
    },
    fixed: {
      ko: [
        '회의 입장 시 일부 기존 참가자가 보이지 않던 문제 (입장 타이밍 경쟁 조건)',
        '내가 들어가기 전부터 진행 중이던 화면 공유가 나에게 안 보이던 문제',
      ],
      en: [
        'Some existing participants not showing up when joining a meeting (a join-timing race condition)',
        'A screen share already in progress before you joined not being visible to you',
      ],
    },
  },
  {
    version: '1.8.5',
    date: '2026-06-03',
    highlight: { ko: '일부 디자인 변경', en: 'Minor design changes' },
  },
  {
    version: '1.8.4',
    date: '2026-06-03',
    highlight: {
      ko: '저장된 회의 추가 시 이름 변경 가능',
      en: 'Rename a meeting when saving it',
    },
    added: {
      ko: [
        '최근 회의의 📌 버튼 클릭 시 이름 입력 다이얼로그 표시',
        '예: "A1234" 코드를 "마케팅 정기 회의" 같은 의미있는 이름으로 저장 가능',
      ],
      en: [
        'Clicking the 📌 button on a recent meeting opens a name-input dialog',
        'e.g. save code "A1234" under a meaningful name like "Marketing Weekly"',
      ],
    },
  },
  {
    version: '1.8.2',
    date: '2026-06-03',
    highlight: { ko: '일부 디자인 변경', en: 'Minor design changes' },
  },
  {
    version: '1.8.0',
    date: '2026-06-03',
    highlight: {
      ko: '의견·기능 제안 보내기 기능 추가',
      en: 'Added feedback / feature suggestions',
    },
    added: {
      ko: [
        '로비 화면에 "💡 의견 보내기" 버튼 추가',
        '4가지 종류로 분류 가능: 🆕 기능 추가 / ✨ 기존 기능 개선 / 🤔 사용성 문제 / 💬 기타',
        '한 줄 요약 + 자세한 내용 + 이름(선택) 입력 후 전송',
        '개발자가 검토 후 향후 업데이트에 반영',
      ],
      en: [
        'Added a "💡 Send Feedback" button on the lobby screen',
        'Four categories: 🆕 Feature request / ✨ Improvement / 🤔 Usability / 💬 Other',
        'Send a one-line summary + details + optional name',
        'The developer reviews it and applies it in future updates',
      ],
    },
    changed: {
      ko: [
        '회의 화면에서 파일 전송 실패 시 정확한 사유 표시 (예: "받을 사람이 없습니다. 다른 참가자가 입장한 후 다시 시도해 주세요.")',
      ],
      en: [
        'File transfer failures now show the exact reason (e.g. "No one to receive it. Try again after another participant joins.")',
      ],
    },
  },
  {
    version: '1.7.7',
    date: '2026-06-03',
    highlight: {
      ko: '회의 입장 시 검은 화면 긴급 수정',
      en: 'Hotfix: black screen when joining a meeting',
    },
    fixed: {
      ko: ['v1.7.6 줌 기능 추가 시 React Hook 순서 위반으로 회의 화면이 검게 나오던 문제'],
      en: ['The meeting screen going black due to a React Hook ordering issue introduced with the v1.7.6 zoom feature'],
    },
  },
  {
    version: '1.7.6',
    date: '2026-06-03',
    highlight: {
      ko: '회의 화면 개선 + 설치 마법사 없는 무중단 업데이트',
      en: 'Meeting-screen improvements + wizard-free updates',
    },
    added: {
      ko: [
        '확대된 공유 화면을 마우스 휠로 줌인/줌아웃 가능 (최대 5배)',
        '확대 상태에서 마우스 드래그로 보이는 영역 이동 (팬)',
        '우측 하단에 줌 컨트롤 (−, 100%, +) 표시',
        '베트남 등 국제 P2P 연결을 위한 TURN 서버 지원',
        '버그 자동 수집 시스템 (개발자 전용)',
        '마이크/스피커 테스트 (오디오 설정에서 신호음 + 레벨 미터)',
      ],
      en: [
        'Zoom in/out on an enlarged shared screen with the mouse wheel (up to 5×)',
        'Pan the visible area by dragging while zoomed in',
        'Zoom controls (−, 100%, +) shown at the bottom right',
        'TURN server support for international P2P connections (e.g. Vietnam)',
        'Automatic bug-collection system (developer only)',
        'Mic/speaker test (test tone + level meter in audio settings)',
      ],
    },
    changed: {
      ko: [
        '확대 화면 시 다른 참가자 타일이 화면 하단 → 우측 세로 정렬로 이동 (메인 영역 가리지 않음)',
        '자동 업데이트 적용 시 NSIS 설치 마법사 표시 안 함 → 조용히 설치되고 자동 재실행',
        '신규 설치 시에도 마법사 없이 원클릭 설치',
      ],
      en: [
        'While a screen is enlarged, other participant tiles move from the bottom to a vertical strip on the right (no longer covering the main area)',
        'Auto-updates no longer show the NSIS install wizard — they install silently and relaunch automatically',
        'Fresh installs are also one-click, with no wizard',
      ],
    },
  },
  {
    version: '1.7.1',
    date: '2026-06-03',
    highlight: {
      ko: '회의 입장 시 화면이 검게 나오는 문제 긴급 수정',
      en: 'Hotfix: black screen when joining a meeting',
    },
    fixed: {
      ko: ['v1.7.0에서 회의방에 들어가면 빈 검은 화면만 보이던 버그 (React Hook 순서 위반)'],
      en: ['A blank black screen when entering a meeting room in v1.7.0 (React Hook ordering violation)'],
    },
  },
  {
    version: '1.7.0',
    date: '2026-06-03',
    highlight: {
      ko: '발언자 강조 + 파일 공유',
      en: 'Active speaker highlight + file sharing',
    },
    added: {
      ko: [
        '현재 말하고 있는 참가자 타일에 청록색 펄스 테두리 표시',
        '채팅 패널에서 파일 첨부 (📎 버튼) 또는 드래그앤드롭으로 P2P 전송 (최대 200 MB)',
        '파일 전송/수신 진행률 실시간 표시 + 완료 시 "저장" 버튼',
      ],
      en: [
        'A teal pulsing border on the tile of whoever is currently speaking',
        'Attach files in the chat panel (📎 button) or drag-and-drop for P2P transfer (up to 200 MB)',
        'Live send/receive progress + a "Save" button when complete',
      ],
    },
  },
  {
    version: '1.6.1',
    date: '2026-06-02',
    highlight: { ko: '디스크 공간 절약', en: 'Save disk space' },
    changed: {
      ko: ['업데이트 적용 후 다운로드된 이전 버전 설치 파일을 자동으로 정리합니다 (약 80MB 절약)'],
      en: ['Automatically cleans up downloaded old-version installers after an update (saves about 80 MB)'],
    },
  },
  {
    version: '1.6.0',
    date: '2026-06-02',
    highlight: {
      ko: '일부 기능 보완 및 디자인 개선',
      en: 'Minor feature and design improvements',
    },
  },
  {
    version: '1.5.0',
    date: '2026-06-02',
    highlight: {
      ko: '최근 참여한 회의를 한눈에 확인할 수 있습니다',
      en: 'See your recent meetings at a glance',
    },
    added: {
      ko: [
        '로비 우측 상단에 "최근 회의" 패널 추가 (최대 10개, 자동 기록)',
        '최근 회의를 클릭하면 같은 코드로 다시 참가됩니다',
        '📌 버튼으로 최근 회의를 "저장된 회의"로 승격할 수 있습니다',
        '✕ 버튼으로 최근 목록에서 삭제 가능',
      ],
      en: [
        'Added a "Recent" panel at the top right of the lobby (up to 10, recorded automatically)',
        'Click a recent meeting to rejoin with the same code',
        'Promote a recent meeting to "Saved" with the 📌 button',
        'Remove from the recent list with the ✕ button',
      ],
    },
  },
  {
    version: '1.4.2',
    date: '2026-06-02',
    highlight: {
      ko: '변경 사항 안내 창이 정상적으로 표시되도록 수정',
      en: 'Fixed the changelog popup not showing',
    },
    fixed: {
      ko: ['v1.4.1에서 도입된 변경 사항 팝업이 기존 사용자에게 표시되지 않던 문제 해결'],
      en: ['The changelog popup introduced in v1.4.1 not appearing for existing users'],
    },
    added: {
      ko: ['좌측 하단의 버전 표시(v1.4.2 · 개발자 서정천)를 클릭하면 언제든 변경 이력을 볼 수 있습니다'],
      en: ['Click the version badge at the bottom left to view the changelog anytime'],
    },
  },
  {
    version: '1.4.1',
    date: '2026-06-02',
    highlight: {
      ko: '업데이트 후 변경 사항을 한눈에 확인하세요',
      en: 'See what changed after each update',
    },
    added: {
      ko: [
        '새 버전으로 업데이트되면 자동으로 변경 사항 안내 창이 표시됩니다',
        '이전 버전들의 변경 이력도 함께 확인할 수 있습니다',
      ],
      en: [
        'A changelog window appears automatically after updating to a new version',
        'You can also review the changelog of previous versions',
      ],
    },
  },
  {
    version: '1.4.0',
    date: '2026-06-02',
    highlight: {
      ko: '업데이트 진행 상황을 실시간으로 보여드립니다',
      en: 'Live update progress',
    },
    added: {
      ko: [
        '상단 중앙에 업데이트 진행 배너 추가 (새 버전 발견 / 다운로드 진행률 / 준비 완료)',
        '"지금 적용" 버튼으로 즉시 새 버전으로 재시작 가능',
      ],
      en: [
        'A top-center update banner (new version found / download progress / ready)',
        'Restart into the new version immediately with the "Apply now" button',
      ],
    },
    changed: {
      ko: [
        '스크롤바를 어두운 테마에 맞게 얇고 부드럽게 변경',
        '로비 화면 카드 여백 조정으로 스크롤 필요성 감소',
      ],
      en: [
        'Thinner, subtler scrollbars matching the dark theme',
        'Adjusted lobby card spacing to reduce the need to scroll',
      ],
    },
  },
  {
    version: '1.3.0',
    date: '2026-06-02',
    highlight: { ko: '사용자 메뉴얼이 추가되었습니다', en: 'Added a user manual' },
    added: {
      ko: [
        '로비 화면 하단에 "📖 사용자 메뉴얼" 버튼 추가',
        '10페이지 분량의 상세 메뉴얼 (사용법, 문제 해결, FAQ 포함)',
        '메뉴얼에서 "PDF 저장 / 인쇄" 기능으로 PDF 보관 가능',
      ],
      en: [
        'Added a "📖 User Manual" button at the bottom of the lobby',
        'A detailed 10-page manual (usage, troubleshooting, FAQ)',
        'Keep a PDF copy via the manual’s "Save as PDF / Print" feature',
      ],
    },
  },
  {
    version: '1.2.1',
    date: '2026-06-02',
    highlight: {
      ko: '채팅창에서 버전 표시가 가려지는 문제 해결',
      en: 'Fixed the version badge being hidden by the chat panel',
    },
    fixed: {
      ko: ['채팅 패널을 열었을 때 우측 하단의 버전 배지와 채팅 전송 버튼이 겹치는 문제'],
      en: ['The bottom-right version badge overlapping the chat send button when the chat panel was open'],
    },
    changed: {
      ko: ['버전 표시 위치를 우측 하단에서 좌측 하단으로 이동'],
      en: ['Moved the version badge from the bottom right to the bottom left'],
    },
  },
  {
    version: '1.2.0',
    date: '2026-06-02',
    highlight: {
      ko: '마이크 없는 PC에서도 회의 참여가 가능합니다',
      en: 'Join meetings even from a PC without a microphone',
    },
    added: {
      ko: [
        '듣기 전용 모드 - 마이크가 없거나 권한이 없어도 회의 입장 가능',
        '듣기 전용 모드에서도 채팅, 화면 보기, 화면 공유는 정상 사용',
        '회의 상단에 듣기 전용 모드 안내 배너 표시',
      ],
      en: [
        'Listen-only mode — join even without a microphone or mic permission',
        'Chat, viewing, and screen sharing all work normally in listen-only mode',
        'A listen-only banner is shown at the top of the meeting',
      ],
    },
  },
  {
    version: '1.1.1',
    date: '2026-06-02',
    highlight: {
      ko: '마이크 에러를 더 친절하게 안내합니다',
      en: 'Friendlier microphone-error guidance',
    },
    added: {
      ko: [
        '마이크 에러 유형별 한국어 안내 메시지 (권한 거부, 장치 없음, 사용 중 등)',
        '"Windows 마이크 설정 열기" 버튼 - 한 번 클릭으로 권한 페이지 이동',
        '"다시 시도" 버튼으로 앱 재시작 없이 재연결',
      ],
      en: [
        'Clear messages per microphone-error type (permission denied, no device, in use, etc.)',
        '"Open Windows mic settings" button — one click to the permission page',
        '"Try again" button to reconnect without restarting the app',
      ],
    },
  },
  {
    version: '1.1.0',
    date: '2026-06-02',
    highlight: { ko: '자동 업데이트가 도입되었습니다', en: 'Auto-update introduced' },
    added: {
      ko: [
        'GitHub Releases 기반 자동 업데이트 시스템',
        '백그라운드 다운로드 + 사용자 확인 후 적용',
        '향후 모든 버전이 별도 설치 없이 자동 배포',
      ],
      en: [
        'Auto-update system based on GitHub Releases',
        'Background download, applied after your confirmation',
        'All future versions are delivered automatically without a separate install',
      ],
    },
  },
  {
    version: '1.0.0',
    date: '2026-06-02',
    highlight: { ko: '정식 출시', en: 'Official release' },
    added: {
      ko: [
        'P2P 방식의 다자간 음성 회의',
        '화면 공유 (전체 화면 / 특정 창 선택 가능)',
        '실시간 텍스트 채팅',
        '4~10자리 회의 코드 시스템',
        '저장된 회의 목록 + 실시간 참가자 수 표시',
        '마이크/스피커 장치 선택',
      ],
      en: [
        'Multi-party P2P voice meetings',
        'Screen sharing (full screen or a specific window)',
        'Real-time text chat',
        '4–10 character meeting code system',
        'Saved meeting list + live participant count',
        'Microphone/speaker device selection',
      ],
    },
  },
];

/** Find a release note for a specific version, or undefined if not listed. */
export function getReleaseNote(version: string): ReleaseNote | undefined {
  return RELEASE_NOTES.find((n) => n.version === version);
}

/**
 * Get all release notes newer than a given version, so users who skipped
 * several versions see everything they missed.
 */
export function getNotesAfter(version: string): ReleaseNote[] {
  const idx = RELEASE_NOTES.findIndex((n) => n.version === version);
  if (idx === -1) {
    // Unknown previous version - just show the latest one.
    return RELEASE_NOTES.slice(0, 1);
  }
  return RELEASE_NOTES.slice(0, idx);
}
