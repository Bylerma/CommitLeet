// Background Service Worker for LeetCode -> GitHub Tracker

// Helpers for Storage config
function getStorageConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['githubToken', 'githubOwner', 'githubRepo'], (items) => {
      resolve(items || {});
    });
  });
}

// Unicode-safe base64 encoding/decoding
function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(b64) {
  const sanitized = b64.replace(/\s/g, '');
  return decodeURIComponent(escape(atob(sanitized)));
}

// Map LeetCode language name to extension
function getExtension(language) {
  const lang = language.toLowerCase().trim();
  if (lang.includes('python3') || lang.includes('python')) return 'py';
  if (lang.includes('javascript') || lang === 'js') return 'js';
  if (lang.includes('typescript') || lang === 'ts') return 'ts';
  if (lang.includes('java')) return 'java';
  if (lang.includes('c++') || lang.includes('cpp')) return 'cpp';
  if (lang.includes('go')) return 'go';
  if (lang.includes('rust')) return 'rs';
  if (lang === 'c') return 'c';
  if (lang.includes('kotlin')) return 'kt';
  if (lang.includes('swift')) return 'swift';
  return 'txt'; // fallback
}

// Format local date as YYYY-MM-DD
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// GitHub API helper
async function githubRequest(path, method, body, token) {
  const url = `https://api.github.com${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Accept': 'application/vnd.github+json'
  };

  const options = {
    method,
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await response.json();
  }
  return {};
}

// File upsert
async function upsertFile(token, owner, repo, filePath, content, commitMsg) {
  const existingFile = await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, 'GET', null, token);
  const sha = existingFile ? existingFile.sha : null;
  const base64Content = encodeBase64(content);

  const body = {
    message: commitMsg,
    content: base64Content
  };
  if (sha) {
    body.sha = sha;
  }

  return await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, 'PUT', body, token);
}

// Generate solution file content
function generateSolutionContent(data, paddedNumber) {
  const commentHeader = [
    `Number: ${paddedNumber}`,
    `Title: ${data.title}`,
    `Difficulty: ${data.difficulty}`,
    `Tags: ${data.tags.join(', ')}`,
    `Language: ${data.language}`,
    `URL: ${data.url}`,
    `Date: ${getLocalDateString()}`,
    `Runtime: ${data.runtime}`,
    `Memory: ${data.memory}`
  ];

  const ext = getExtension(data.language);
  if (ext === 'py') {
    const headerStr = commentHeader.map(line => `# ${line}`).join('\n');
    return `${headerStr}\n\n${data.code}`;
  } else {
    const headerStr = '/*\n' + commentHeader.map(line => ` * ${line}`).join('\n') + '\n */';
    return `${headerStr}\n\n${data.code}`;
  }
}

// Generate per-problem README.md
function generateProblemReadmeContent(data) {
  const diffColorMap = {
    'Easy': 'brightgreen',
    'Medium': 'orange',
    'Hard': 'red'
  };
  const diffColor = diffColorMap[data.difficulty] || 'blue';

  const diffBadge = `![Difficulty: ${data.difficulty}](https://img.shields.io/badge/Difficulty-${data.difficulty}-${diffColor})`;
  const tagBadges = data.tags.map(tag => {
    const encodedTag = encodeURIComponent(tag.replace(/-/g, '_'));
    return `![Tag: ${tag}](https://img.shields.io/badge/Tag-${encodedTag}-blue)`;
  }).join(' ');

  const date = getLocalDateString();

  return `# ${data.number}. ${data.title}

${diffBadge} ${tagBadges}

## 🔗 Link
[LeetCode Problem URL](${data.url})

## 📝 Problem Description
${data.description || 'No description provided.'}

## 💡 Approach & Notes
<!-- Describe your approach, notes, and complexity here (e.g., O(n) time, O(1) space) -->

## 📊 Submission Stats
| Language | Runtime | Memory | Date |
| --- | --- | --- | --- |
| ${data.language} | ${data.runtime} | ${data.memory} | ${date} |
`;
}

// Calculate current streak
function calculateStreak(log) {
  if (log.length === 0) return 0;

  const uniqueDates = Array.from(new Set(log.map(item => item.date))).sort().reverse();
  if (uniqueDates.length === 0) return 0;

  const todayStr = getLocalDateString();
  const yesterdayStr = getLocalDateString(new Date(Date.now() - 86400000));

  let streak = 0;
  let checkDate = new Date();
  let checkStr = getLocalDateString(checkDate);

  if (!uniqueDates.includes(checkStr)) {
    if (uniqueDates.includes(yesterdayStr)) {
      checkDate.setDate(checkDate.getDate() - 1);
      checkStr = getLocalDateString(checkDate);
    } else {
      return 0; // Streak broken
    }
  }

  while (uniqueDates.includes(checkStr)) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
    checkStr = getLocalDateString(checkDate);
  }

  return streak;
}

// Helper to build ASCII progress bar
function getProgressBar(count, total) {
  if (total === 0) return '░'.repeat(20);
  const filledCount = Math.round((count / total) * 20);
  return '█'.repeat(filledCount) + '░'.repeat(20 - filledCount);
}

// Generate root dashboard README.md
function generateRootReadmeContent(log, username) {
  const total = log.length;
  const easy = log.filter(item => item.difficulty === 'Easy').length;
  const medium = log.filter(item => item.difficulty === 'Medium').length;
  const hard = log.filter(item => item.difficulty === 'Hard').length;
  
  const streak = calculateStreak(log);
  const lastUpdated = getLocalDateString();

  const easyBar = getProgressBar(easy, total);
  const mediumBar = getProgressBar(medium, total);
  const hardBar = getProgressBar(hard, total);

  const easyPct = total > 0 ? Math.round((easy / total) * 100) : 0;
  const mediumPct = total > 0 ? Math.round((medium / total) * 100) : 0;
  const hardPct = total > 0 ? Math.round((hard / total) * 100) : 0;

  // Build last 20 table rows
  const tableRows = log
    .slice(-20)
    .reverse()
    .map(item => {
      const diffEmoji = item.difficulty === 'Easy' ? '🟢 Easy' : item.difficulty === 'Medium' ? '🟡 Medium' : '🔴 Hard';
      const paddedNumber = String(item.number).padStart(4, '0');
      const folderLink = `solutions/${item.date}/${paddedNumber}-${item.slug}/`;
      return `| [${item.number}. ${item.title}](${folderLink}) | ${diffEmoji} | ${item.language} | ${item.runtime} | ${item.date} |`;
    })
    .join('\n');

  return `# ⚡ LeetCode Solutions Tracker

Auto-synced via [LeetCode → GitHub Tracker](https://github.com/swetaverse) Chrome Extension.

## 📊 Stats Dashboard

| Metric | Value |
| --- | --- |
| 🔥 Current Streak | **${streak} Days** |
| 🚀 Total Solved | **${total}** |
| 🟢 Easy Solved | **${easy}** |
| 🟡 Medium Solved | **${medium}** |
| 🔴 Hard Solved | **${hard}** |
| 📅 Last Updated | **${lastUpdated}** |

### 📈 Progress Bar Breakdown

- **Easy:** \`[${easyBar}]\` **${easy}/${total}** (${easyPct}%)
- **Medium:** \`[${mediumBar}]\` **${medium}/${total}** (${mediumPct}%)
- **Hard:** \`[${hardBar}]\` **${hard}/${total}** (${hardPct}%)

---

## 📂 Repository Directory Layout

\`\`\`
.
├── .tracker/
│   └── log.json
├── solutions/
│   └── [YYYY-MM-DD]/
│       └── [paddedNumber]-[slug]/
│           ├── README.md
│           └── solution.[ext]
└── README.md
\`\`\`

---

## 🕒 Recently Solved Problems (Last 20)

| Problem | Difficulty | Language | Runtime | Date |
| --- | --- | --- | --- | --- |
${tableRows || '| - | - | - | - | - |'}
`;
}

// Handle SUBMISSION_ACCEPTED message sequence
async function handleSubmission(data) {
  const config = await getStorageConfig();
  if (!config.githubToken || !config.githubOwner || !config.githubRepo) {
    throw new Error('Extension is not configured. Please open settings and fill in Owner, Repo, and Token.');
  }

  const { githubToken, githubOwner, githubRepo } = config;

  // 1. Fetch existing log
  let log = [];
  const logPath = '.tracker/log.json';
  const logFile = await githubRequest(`/repos/${githubOwner}/${githubRepo}/contents/${logPath}`, 'GET', null, githubToken);

  if (logFile && logFile.content) {
    try {
      const decodedLog = decodeBase64(logFile.content);
      log = JSON.parse(decodedLog);
    } catch (e) {
      console.error('Error decoding log file, initializing empty log', e);
    }
  }

  // 2. Prep current problem log entry
  const todayStr = getLocalDateString();
  const newEntry = {
    number: data.number || '0',
    title: data.title || 'Untitled',
    slug: data.slug,
    difficulty: data.difficulty,
    tags: data.tags || [],
    language: data.language,
    runtime: data.runtime,
    memory: data.memory,
    url: data.url,
    date: todayStr
  };

  // 3. Update or append
  const existingIdx = log.findIndex(item => item.slug === data.slug);
  if (existingIdx !== -1) {
    log[existingIdx] = newEntry;
  } else {
    log.push(newEntry);
  }

  // 4. File Paths
  const paddedNumber = String(data.number || '0').padStart(4, '0');
  const folder = `solutions/${todayStr}/${paddedNumber}-${data.slug}`;
  const ext = getExtension(data.language);
  
  const solutionPath = `${folder}/solution.${ext}`;
  const readmePath = `${folder}/README.md`;

  // 5. Generate and Upsert files sequentially
  console.log(`[Background] Uploading solution code to ${solutionPath}`);
  const solutionContent = generateSolutionContent(data, paddedNumber);
  await upsertFile(githubToken, githubOwner, githubRepo, solutionPath, solutionContent, `Add solution for ${data.number}. ${data.title}`);

  console.log(`[Background] Uploading problem README to ${readmePath}`);
  const problemReadmeContent = generateProblemReadmeContent(data);
  await upsertFile(githubToken, githubOwner, githubRepo, readmePath, problemReadmeContent, `Add README description for ${data.number}. ${data.title}`);

  console.log(`[Background] Uploading log database to ${logPath}`);
  const logContent = JSON.stringify(log, null, 2);
  await upsertFile(githubToken, githubOwner, githubRepo, logPath, logContent, `Update log for ${data.number}. ${data.title}`);

  console.log(`[Background] Uploading root README.md`);
  const rootReadmeContent = generateRootReadmeContent(log, githubOwner);
  await upsertFile(githubToken, githubOwner, githubRepo, 'README.md', rootReadmeContent, `Update tracker dashboard stats [${data.number}. ${data.title}]`);

  const uniqueSolved = new Set(log.map(item => item.slug)).size;
  return { totalSolved: uniqueSolved };
}

// Handle GET_STATS message sequence
async function handleGetStats() {
  const config = await getStorageConfig();
  if (!config.githubToken || !config.githubOwner || !config.githubRepo) {
    return { total: 0, easy: 0, medium: 0, hard: 0, todayCount: 0 };
  }

  const { githubToken, githubOwner, githubRepo } = config;
  const logPath = '.tracker/log.json';
  const logFile = await githubRequest(`/repos/${githubOwner}/${githubRepo}/contents/${logPath}`, 'GET', null, githubToken);

  let log = [];
  if (logFile && logFile.content) {
    try {
      const decodedLog = decodeBase64(logFile.content);
      log = JSON.parse(decodedLog);
    } catch (e) {
      console.error('Error decoding log file for stats dashboard', e);
    }
  }

  const total = log.length;
  const easy = log.filter(item => item.difficulty === 'Easy').length;
  const medium = log.filter(item => item.difficulty === 'Medium').length;
  const hard = log.filter(item => item.difficulty === 'Hard').length;

  const todayStr = getLocalDateString();
  const todayCount = log.filter(item => item.date === todayStr).length;

  return { total, easy, medium, hard, todayCount };
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUBMISSION_ACCEPTED') {
    handleSubmission(message.data)
      .then(res => sendResponse({ success: true, totalSolved: res.totalSolved }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open
  }

  if (message.type === 'GET_STATS') {
    handleGetStats()
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ total: 0, easy: 0, medium: 0, hard: 0, todayCount: 0 }));
    return true; // Keep channel open
  }
});

// Automatically inject content.js on install/update into existing LeetCode tabs
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: '*://leetcode.com/*' }, (tabs) => {
    for (const tab of tabs) {
      if (tab.url && tab.url.includes('/problems/')) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(err => console.error('[Background] Failed to inject content script on install:', err));
      }
    }
  });
});
