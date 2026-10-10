let csrf = '';
export async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  if (data?.csrf) csrf = data.csrf;
  return data;
}
export const query = (obj) =>
  new URLSearchParams(
    Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined && v !== null),
  ).toString();
export async function previewImport(file, branch, mode = 'new', sheet = '') {
  const res = await fetch(
    '/api/imports/preview?' + query({ filename: file.name, branch, mode, sheet }),
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf },
      body: file,
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}
export async function downloadTemplate() {
  const res = await fetch('/api/imports/template', { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json()).error || 'Template download failed');
  const url = URL.createObjectURL(await res.blob()),
    a = document.createElement('a');
  a.href = url;
  a.download = 'Moolai_Asset_Import_Template.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function download(kind, params, format) {
  const res = await fetch('/api/reports/' + kind + '?' + query({ ...params, format }), {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Export failed');
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = kind + '-' + (params.asOf || 'report') + '.' + format;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
