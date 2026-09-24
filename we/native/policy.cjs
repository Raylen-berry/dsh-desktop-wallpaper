const path = require('node:path');
function localOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('实时背景仅支持本机 DSH 页面');
  return url.origin;
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function sameFrame(a,b) { return !!a && !!b && a.processId === b.processId && a.routingId === b.routingId; }
// Electron 43 identifies getDisplayMedia as media with no camera/mic types.
// Never grant ordinary camera/microphone checks while a WE grant is pending.
function capturePermission(s, owner, permission, rawUrl, details, now = Date.now()) {
  if (!s || s.closed || s.owner !== owner || !s.source || s.grantUntil < now || details?.isMainFrame !== true) return false;
  if (permission === 'media') {
    if (!Array.isArray(details.mediaTypes) || details.mediaTypes.length !== 0) return false;
  } else if (permission === 'display-capture') {
    if (details.mediaTypes?.includes('audio')) return false;
  } else return false;
  try { return localOrigin(rawUrl) === s.origin; } catch { return false; }
}
module.exports = {localOrigin,inside,sameFrame,capturePermission};
