// 회의록 화면용 훅 — MinutesSession 의 상태를 React 가 구독한다.
// 겹침 확인: electron/minutesExcel.ts 와 다름 — 그건 메인 프로세스의 엑셀 만들기이고, 이 파일은 렌더러 화면이 회의록 상태를 구독하는 React 훅이다.

import { useSyncExternalStore } from 'react';
import type { MinutesSession } from './session';
import type { MinutesViewState } from './types';

export function useMinutesState(session: MinutesSession): MinutesViewState {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
