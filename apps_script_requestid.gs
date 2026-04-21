function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: "No postData" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("logs");
  const data = JSON.parse(e.postData.contents);

  const name = String(data.name || "").trim();
  const memberNumber = String(data.memberNumber || "").trim();
  const affiliation = String(data.affiliation || "").trim();
  const requestId = String(data.requestId || "").trim();
  const ip = String(data.ip || "").trim();
  const userAgent = String(data.userAgent || "").trim();

  const lastRow = sheet.getLastRow();
  let existingNumbers = [];

  if (lastRow >= 2) {
    existingNumbers = sheet
      .getRange(2, 3, lastRow - 1, 1)
      .getDisplayValues()
      .flat()
      .map(v => String(v).trim());
  }

  const isReissue = existingNumbers.includes(memberNumber);

  const cache = CacheService.getScriptCache();
  const dedupeKey = "req_" + requestId;

  if (requestId && cache.get(dedupeKey)) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        skippedDuplicate: true,
        isReissue: isReissue
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (requestId) {
    cache.put(dedupeKey, "1", 600);
  }

  sheet.appendRow([
    new Date(),
    name,
    memberNumber,
    affiliation,
    ip,
    userAgent,
    isReissue
  ]);

  SpreadsheetApp.flush();
  updateDashboard();

  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      skippedDuplicate: false,
      isReissue: isReissue
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
