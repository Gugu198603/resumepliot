function emit(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...payload
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const logger = {
  info(event, payload) {
    emit('info', event, payload);
  },
  warn(event, payload) {
    emit('warn', event, payload);
  },
  error(event, payload) {
    emit('error', event, payload);
  }
};
