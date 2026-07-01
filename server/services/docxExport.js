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

export function normalizeResumeDocument(content = {}) {
  const basics = content.basics || {};
  const blocks = [
    { type: 'name', text: basics.name || 'Resume' },
    { type: 'subtitle', text: basics.label || '' },
    { type: 'contact', text: [basics.email, basics.phone, basics.location?.address || basics.location].filter((item) => typeof item === 'string' && item).join(' · ') },
    { type: 'summary', text: basics.summary || '' }
  ];
  const sections = [
    ['技能', (content.skills || []).flatMap((item) => [{ type: 'body', text: `${item.name || '技能'}：${(item.keywords || []).join('、')}` }])],
    ['工作经历', (content.work || []).flatMap((item) => [
      { type: 'entry', text: [item.name, item.position].filter(Boolean).join(' · '), trailing: [item.startDate, item.endDate].filter(Boolean).join(' - ') },
      { type: 'summary', text: item.summary },
      ...(item.highlights || []).map((entry) => ({ type: 'bullet', text: typeof entry === 'string' ? entry : entry.text }))
    ])],
    ['项目经历', (content.projects || []).flatMap((item) => [
      { type: 'entry', text: item.name, trailing: [item.startDate, item.endDate].filter(Boolean).join(' - ') },
      { type: 'summary', text: item.description },
      ...(item.highlights || []).map((entry) => ({ type: 'bullet', text: typeof entry === 'string' ? entry : entry.text }))
    ])],
    ['教育经历', (content.education || []).flatMap((item) => [
      { type: 'entry', text: [item.institution, item.area, item.studyType].filter(Boolean).join(' · '), trailing: [item.startDate, item.endDate].filter(Boolean).join(' - ') }
    ])]
  ];
  for (const [title, items] of sections) {
    const filtered = items.filter((item) => item.text);
    if (filtered.length) blocks.push({ type: 'section', text: title }, ...filtered);
  }
  return { blocks: blocks.filter((block) => block.text) };
}

export function createResumeDocx(content = {}) {
  const document = normalizeResumeDocument(content);
  const paragraph = (block) => {
    const style = {
      name: 'ResumeName',
      subtitle: 'ResumeSubtitle',
      contact: 'ResumeContact',
      section: 'ResumeSection',
      entry: 'ResumeEntry',
      summary: 'Normal',
      body: 'Normal',
      bullet: 'Normal'
    }[block.type] || 'Normal';
    const bullet = block.type === 'bullet' ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
    const tabs = block.trailing ? '<w:tabs><w:tab w:val="right" w:pos="10440"/></w:tabs>' : '';
    const trailing = block.trailing
      ? `<w:r><w:tab/></w:r><w:r><w:rPr><w:color w:val="666666"/></w:rPr><w:t>${escapeXml(block.trailing)}</w:t></w:r>`
      : '';
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${bullet}${tabs}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r>${trailing}</w:p>`;
  };
  const paragraphs = document.blocks.map(paragraph).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>',
    'word/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Microsoft YaHei" w:hAnsi="Arial"/><w:sz w:val="19"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="260" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="ResumeName"><w:name w:val="Resume Name"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ResumeSubtitle"><w:name w:val="Resume Subtitle"/><w:rPr><w:b/><w:color w:val="444444"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ResumeContact"><w:name w:val="Resume Contact"/><w:rPr><w:color w:val="666666"/><w:sz w:val="17"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ResumeSection"><w:name w:val="Resume Section"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="70"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="3" w:color="999999"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ResumeEntry"><w:name w:val="Resume Entry"/><w:pPr><w:keepNext/><w:spacing w:before="80" w:after="30"/></w:pPr><w:rPr><w:b/><w:sz w:val="19"/></w:rPr></w:style></w:styles>',
    'word/numbering.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  };
  return zipStore(files);
}
