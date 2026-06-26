import * as manualSource from './manualSource.js';
import * as urlSource from './urlSource.js';
import * as greenhouseSource from './greenhouseSource.js';
import * as leverSource from './leverSource.js';

const registry = new Map([
  [manualSource.id, manualSource],
  [urlSource.id, urlSource],
  [greenhouseSource.id, greenhouseSource],
  [leverSource.id, leverSource]
]);

export function listSources() {
  return [...registry.keys()];
}

export function getSource(id) {
  return registry.get(id) || null;
}

export function registerSource(source) {
  if (!source?.id || typeof source.fetchJobs !== 'function') {
    throw new Error('Invalid job source: must have id and fetchJobs().');
  }
  registry.set(source.id, source);
}

export async function fetchFromSource(id, config = {}) {
  const source = getSource(id);
  if (!source) throw new Error(`Unknown job source: ${id}`);
  return await source.fetchJobs(config);
}
