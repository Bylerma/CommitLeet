// Content script for LeetCode -> GitHub Tracker

const LANGUAGE_EXT_MAP = {
  'python3': 'py',
  'python': 'py',
  'java': 'java',
  'c++': 'cpp',
  'cpp': 'cpp',
  'javascript': 'js',
  'typescript': 'ts',
  'go': 'go',
  'rust': 'rs',
  'c': 'c',
  'kotlin': 'kt',
  'swift': 'swift'
};

let pollingInterval = null;
let pollingTimeout = null;
let isPolling = false;

// Helper to determine if an element is the Submit button
function isSubmitButton(el) {
  if (!el) return false;
  const button = el.closest('button');
  if (!button) return false;

  // 1. Check data attributes
  if (button.getAttribute('data-cy') === 'submit-code-btn') return true;
  if (button.getAttribute('data-e2e-locator') === 'console-submit-button') return true;

  // 2. Check text content (case insensitive match)
  const text = (button.innerText || button.textContent || '').trim().toLowerCase();
  if (text === 'submit' || text === 'submit code' || text.includes('submit')) return true;

  // 3. Check classes/IDs
  const id = (button.id || '').toLowerCase();
  const className = (button.className || '').toLowerCase();
  if (id.includes('submit') || className.includes('submit')) return true;

  return false;
}

// Attach click listener to Submit button
document.addEventListener('click', (e) => {
  if (isSubmitButton(e.target)) {
    startPolling();
  }
});

// Support Ctrl+Enter submission detection
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    setTimeout(startPolling, 500);
  }
});

// Detect URL changes to /submissions/ as secondary signal
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (lastUrl.toLowerCase().includes('/submissions/')) {
      startPolling();
    }
  }
}, 1500);

function startPolling() {
  if (isPolling) return;
  
  isPolling = true;
  console.log('[LeetCode Tracker] Started polling for Accepted status...');

  let attempts = 0;
  const maxAttempts = 150; // 5 minutes (150 * 2s)

  // Clear any existing intervals/timeouts
  if (pollingInterval) clearInterval(pollingInterval);
  if (pollingTimeout) clearTimeout(pollingTimeout);

  pollingInterval = setInterval(() => {
    attempts++;
    
    const acceptedEl = findAcceptedIndicator();
    if (acceptedEl) {
      console.log('[LeetCode Tracker] Submission Accepted detected!');
      clearInterval(pollingInterval);
      pollingInterval = null;
      isPolling = false;

      // Wait 1.5 seconds for stats to render
      setTimeout(async () => {
        try {
          const problemData = await scrapeSubmissionData();
          sendSubmissionToBackground(problemData);
        } catch (err) {
          console.error('[LeetCode Tracker] Error scraping submission data:', err);
          showToast('Failed to scrape submission details', false);
        }
      }, 1500);
      return;
    }

    if (attempts >= maxAttempts) {
      console.log('[LeetCode Tracker] Polling timed out (5 minutes).');
      clearInterval(pollingInterval);
      pollingInterval = null;
      isPolling = false;
    }
  }, 2000);
}

function findAcceptedIndicator() {
  // Check common LeetCode elements for "Accepted" status
  const e2e = document.querySelector('[data-e2e-locator="submission-result"]');
  if (e2e && e2e.textContent.trim().includes('Accepted')) {
    return e2e;
  }

  // Iterate over elements looking for exact match
  const selectors = ['span', 'div', 'p', 'a', 'h4', 'h3'];
  for (const sel of selectors) {
    const elements = document.querySelectorAll(sel);
    for (const el of elements) {
      if (el.textContent.trim() === 'Accepted') {
        return el;
      }
    }
  }
  return null;
}

// Scrape code from the main window's Monaco Editor using event-based communication
function getCodeFromMonaco() {
  return new Promise((resolve) => {
    const eventName = 'LEETCODE_TRACKER_EXTRACT_CODE_' + Math.random().toString(36).substring(2);
    
    // Safety timeout: if main-world.js isn't active (e.g. tab not refreshed), fall back
    const timeoutId = setTimeout(() => {
      window.removeEventListener(eventName, handleResponse);
      console.warn('[LeetCode Tracker] Monaco extraction timed out, falling back to DOM scraping...');
      resolve('');
    }, 500);

    const handleResponse = (e) => {
      clearTimeout(timeoutId);
      window.removeEventListener(eventName, handleResponse);
      resolve(e.detail);
    };
    
    window.addEventListener(eventName, handleResponse);

    // Dispatch request to main-world.js
    window.dispatchEvent(new CustomEvent('LEETCODE_TRACKER_REQUEST_CODE', { 
      detail: { eventName } 
    }));
  });
}

// Scrape DOM for CodeMirror lines
function getCodeFromCodeMirror() {
  const cmLines = document.querySelectorAll('.CodeMirror-line');
  if (cmLines.length > 0) {
    return Array.from(cmLines).map(line => line.textContent).join('\n');
  }
  
  const viewLines = document.querySelectorAll('.view-line');
  if (viewLines.length > 0) {
    return Array.from(viewLines).map(line => line.textContent).join('\n');
  }
  
  return '';
}

// Scrape DOM for fallback pre tags
function getCodeFromPre() {
  const preEl = document.querySelector('pre');
  return preEl ? preEl.textContent : '';
}

async function scrapeSubmissionData() {
  // 1. Scrape Title
  let titleText = '';
  const titleEl = document.querySelector('[data-cy="question-title"]') || 
                  document.querySelector('div[class*="title-large"]') ||
                  document.querySelector('div[class*="text-title-large"]');
  
  if (titleEl) {
    titleText = titleEl.textContent.trim();
  } else {
    titleText = document.title.replace('- LeetCode', '').trim();
  }

  // 2. Parse Number and Title Name
  let number = '';
  let title = titleText;
  
  // Title can be "1. Two Sum"
  const titleMatch = titleText.match(/^(\d+)\.\s*(.*)$/);
  if (titleMatch) {
    number = titleMatch[1];
    title = titleMatch[2];
  } else {
    // Try to parse number from page element if available
    const numEl = document.querySelector('span[class*="question-title"]') || 
                  document.querySelector('div[class*="question-title"]');
    if (numEl) {
      const numMatch = numEl.textContent.match(/^(\d+)/);
      if (numMatch) number = numMatch[1];
    }
  }

  // 3. Difficulty
  let difficulty = 'Easy'; // default fallback
  const spansAndDivs = document.querySelectorAll('span, div');
  for (const el of spansAndDivs) {
    const text = el.textContent.trim();
    if (text === 'Easy' || text === 'Medium' || text === 'Hard') {
      difficulty = text;
      break;
    }
  }

  // 4. Tags
  const tagEls = document.querySelectorAll('a[href*="/tag/"]');
  const tags = Array.from(tagEls).map(el => el.textContent.trim()).filter(Boolean);

  // 5. Description
  const descEl = document.querySelector('[data-track-load="description_content"]') || 
                 document.querySelector('div[class*="description__"]') ||
                 document.querySelector('.elfjS');
  const description = descEl ? descEl.innerText.trim() : '';

  // 6. Code
  let code = await getCodeFromMonaco();
  if (!code) {
    console.log('[LeetCode Tracker] Monaco empty, falling back to CodeMirror lines...');
    code = getCodeFromCodeMirror();
  }
  if (!code) {
    console.log('[LeetCode Tracker] CodeMirror empty, falling back to pre tag...');
    code = getCodeFromPre();
  }

  // 7. Language
  let language = 'JavaScript';
  const knownLanguages = ['C++', 'Java', 'Python', 'Python3', 'C#', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'Kotlin', 'Swift', 'PHP', 'Ruby', 'Scala', 'C'];
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent.trim();
    if (knownLanguages.includes(text)) {
      language = text;
      break;
    }
  }

  // 8. Runtime & Memory Stats
  const stats = scrapeStats();

  // 9. Slug and URL
  const pathParts = window.location.pathname.split('/');
  const slug = pathParts[2] || 'unknown-slug';
  const url = `https://leetcode.com/problems/${slug}/`;

  return {
    number,
    title,
    slug,
    difficulty,
    tags,
    description,
    code,
    language,
    runtime: stats.runtime,
    memory: stats.memory,
    url,
    timestamp: new Date().toISOString()
  };
}

function scrapeStats() {
  let runtime = 'N/A';
  let memory = 'N/A';

  const divs = Array.from(document.querySelectorAll('span, div, p'));
  
  let runtimeVal = '';
  let runtimeBeats = '';
  let memoryVal = '';
  let memoryBeats = '';

  for (const div of divs) {
    const text = div.textContent.trim();

    // Scan for Runtime
    if (text.includes('ms') && !runtimeVal) {
      const match = text.match(/(\d+)\s*ms/);
      if (match) {
        runtimeVal = match[0];
        const beatsMatch = text.match(/beats\s*([\d\.]+)\s*%/i);
        if (beatsMatch) {
          runtimeBeats = `(Beats ${beatsMatch[1]}%)`;
        }
      }
    }

    // Scan for Memory
    if (text.includes('MB') && !memoryVal) {
      const match = text.match(/(\d+(?:\.\d+)?)\s*MB/);
      if (match) {
        memoryVal = match[0];
        const beatsMatch = text.match(/beats\s*([\d\.]+)\s*%/i);
        if (beatsMatch) {
          memoryBeats = `(Beats ${beatsMatch[1]}%)`;
        }
      }
    }
  }

  // If beats were in separate sibling elements, let's scan for separate "beats X%" indicators
  if (!runtimeBeats || !memoryBeats) {
    let foundRuntimeBeats = false;
    let foundMemoryBeats = false;
    for (const div of divs) {
      const text = div.textContent.trim();
      const match = text.match(/beats\s*([\d\.]+)\s*%/i);
      if (match) {
        if (!foundRuntimeBeats) {
          runtimeBeats = `(Beats ${match[1]}%)`;
          foundRuntimeBeats = true;
        } else if (!foundMemoryBeats) {
          memoryBeats = `(Beats ${match[1]}%)`;
          foundMemoryBeats = true;
          break;
        }
      }
    }
  }

  if (runtimeVal) runtime = runtimeVal + (runtimeBeats ? ' ' + runtimeBeats : '');
  if (memoryVal) memory = memoryVal + (memoryBeats ? ' ' + memoryBeats : '');

  return { runtime, memory };
}

function sendSubmissionToBackground(data) {
  chrome.runtime.sendMessage({ type: 'SUBMISSION_ACCEPTED', data }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('[LeetCode Tracker] Message failed:', chrome.runtime.lastError);
      showToast('Error connecting to background page', false);
      return;
    }
    
    if (response && response.success) {
      showToast(`Successfully pushed! Total solved: ${response.totalSolved}`, true);
    } else {
      const errorMsg = response?.error || 'Failed to push to GitHub';
      showToast(errorMsg, false);
    }
  });
}

function showToast(message, isSuccess) {
  // Remove existing toasts
  const existingToasts = document.querySelectorAll('.leetcode-tracker-toast');
  existingToasts.forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'leetcode-tracker-toast';
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.zIndex = '99999';
  toast.style.padding = '14px 24px';
  toast.style.borderRadius = '8px';
  toast.style.color = '#ffffff';
  toast.style.fontFamily = 'system-ui, -apple-system, sans-serif';
  toast.style.fontWeight = '500';
  toast.style.fontSize = '14px';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '10px';
  toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25)';
  toast.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  toast.style.transform = 'translateY(100px) scale(0.8)';
  toast.style.opacity = '0';
  
  if (isSuccess) {
    toast.style.backgroundColor = '#0d1117'; // Github Dark background
    toast.style.border = '1px solid #2ea44f'; // Github Green border
    toast.innerHTML = `<span style="color: #2ea44f; font-size: 16px; font-weight: bold;">✓</span> ${message}`;
  } else {
    toast.style.backgroundColor = '#0d1117';
    toast.style.border = '1px solid #f85149'; // Github Red border
    toast.innerHTML = `<span style="color: #f85149; font-size: 16px; font-weight: bold;">✗</span> ${message}`;
  }
  
  document.body.appendChild(toast);
  
  // Slide up and fade in
  setTimeout(() => {
    toast.style.transform = 'translateY(0) scale(1)';
    toast.style.opacity = '1';
  }, 50);
  
  // Fade out and remove after 4 seconds
  setTimeout(() => {
    toast.style.transform = 'translateY(-20px) scale(0.9)';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 4000);
}
