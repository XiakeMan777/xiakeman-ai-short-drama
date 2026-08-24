function isPrivateHostname(hostname) {
  const lower = String(hostname || '').toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === '0.0.0.0') return true;
  if (lower === '::1' || lower === '[::1]') return true;

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const [a, b] = ipv4.slice(1).map(Number);
  if ([a, b].some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

function isHostnameAllowed(hostname, allowedDomains) {
  const lower = String(hostname || '').toLowerCase();
  return allowedDomains.some((domain) => {
    const allowed = String(domain || '').toLowerCase();
    return lower === allowed || lower.endsWith(`.${allowed}`);
  });
}

module.exports = {
  isHostnameAllowed,
  isPrivateHostname,
};
