function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function escapeXml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function collectLines(content = {}) {
  const basics = content.basics || {};
  const lines = [
    { text: basics.name || 'Resume', heading: true },
    { text: basics.label || '' },
    { text: [basics.email, basics.phone].filter(Boolean).join(' · ') },
    { text: basics.summary || '' }
  ];
  const sections = [
    ['技能', (content.skills || []).flatMap((item) => [`${item.name || '技能'}：${(item.keywords || []).join('、')}`])],
    ['工作经历', (content.work || []).flatMap((item) => [
      [item.name, item.position, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean).join(' · '),
      item.summary,
      ...(item.highlights || []).map((entry) => typeof entry === 'string' ? entry : entry.text)
    ])],
    ['项目经历', (content.projects || []).flatMap((item) => [
      [item.name, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean).join(' · '),
      item.description,
      ...(item.highlights || []).map((entry) => typeof entry === 'string' ? entry : entry.text)
    ])],
    ['教育经历', (content.education || []).flatMap((item) => [
      [item.institution, item.area, [item.startDate, item.endDate].filter(Boolean).join(' - ')].filter(Boolean).join(' · ')
    ])]
  ];
  for (const [title, items] of sections) {
    const filtered = items.filter(Boolean);
    if (filtered.length) lines.push({ text: title, heading: true }, ...filtered.map((text) => ({ text })));
  }
  return lines.filter((line) => line.text);
}

export function createResumeDocx(content = {}) {
  const paragraphs = collectLines(content).map((line) =>
    `<w:p><w:pPr>${line.heading ? '<w:pStyle w:val="Heading1"/>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(line.text)}</w:t></w:r></w:p>`
  ).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  };
  return zipStore(files);
}
