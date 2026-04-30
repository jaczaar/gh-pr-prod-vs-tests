const ta = document.getElementById('patterns');
const tokenInput = document.getElementById('token');
const status = document.getElementById('status');

chrome.storage.sync.get(['testPatterns', 'githubToken']).then(({ testPatterns, githubToken }) => {
  if (Array.isArray(testPatterns)) ta.value = testPatterns.join('\n');
  if (typeof githubToken === 'string') tokenInput.value = githubToken;
});

document.getElementById('save').addEventListener('click', async () => {
  const lines = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const bad = [];
  for (const l of lines) {
    try { new RegExp(l); } catch { bad.push(l); }
  }
  if (bad.length) {
    status.textContent = `Invalid regex: ${bad.join(', ')}`;
    status.className = 'status err';
    return;
  }
  await chrome.storage.sync.set({
    testPatterns: lines,
    githubToken: tokenInput.value.trim(),
  });
  status.textContent = `Saved.`;
  status.className = 'status ok';
});
