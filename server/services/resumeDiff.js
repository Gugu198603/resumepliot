function flatten(value, path = '', output = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => flatten(item, path ? `${path}.${key}` : key, output));
  } else if (path) {
    output[path] = value ?? '';
  }
  return output;
}

export function diffResumeVersions(before = {}, after = {}) {
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changes = paths.flatMap((path) => {
    if (!(path in left)) return [{ path, type: 'added', before: null, after: right[path] }];
    if (!(path in right)) return [{ path, type: 'removed', before: left[path], after: null }];
    if (JSON.stringify(left[path]) !== JSON.stringify(right[path])) {
      return [{ path, type: 'changed', before: left[path], after: right[path] }];
    }
    return [];
  });
  return {
    changed: changes.length,
    added: changes.filter((item) => item.type === 'added').length,
    removed: changes.filter((item) => item.type === 'removed').length,
    updated: changes.filter((item) => item.type === 'changed').length,
    changes
  };
}
