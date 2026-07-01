export const APPLICATION_STATUSES = [
  'saved',
  'preparing',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn'
];

const TRANSITIONS = {
  saved: ['preparing', 'withdrawn'],
  preparing: ['saved', 'applied', 'withdrawn'],
  applied: ['preparing', 'interviewing', 'rejected', 'withdrawn'],
  interviewing: ['applied', 'offer', 'rejected', 'withdrawn'],
  offer: ['withdrawn'],
  rejected: ['preparing'],
  withdrawn: ['saved', 'preparing']
};

export function normalizeApplicationStatus(value, fallback = 'saved') {
  return APPLICATION_STATUSES.includes(value) ? value : fallback;
}

export function canTransitionApplication(from, to) {
  if (from === to) return true;
  return Boolean(TRANSITIONS[normalizeApplicationStatus(from)]?.includes(to));
}

export function validateApplicationTransition(from, to) {
  const status = normalizeApplicationStatus(to, '');
  if (!status) return { ok: false, code: 'INVALID_APPLICATION_STATUS', message: '不支持的求职状态。' };
  if (!canTransitionApplication(from, status)) {
    return {
      ok: false,
      code: 'INVALID_APPLICATION_TRANSITION',
      message: `不能从 ${from} 直接切换到 ${status}。`
    };
  }
  return { ok: true, status };
}
