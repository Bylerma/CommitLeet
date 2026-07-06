// Popup Logic for LeetCode -> GitHub Tracker

document.addEventListener('DOMContentLoaded', () => {
  const ownerInput = document.getElementById('ownerInput');
  const repoInput = document.getElementById('repoInput');
  const tokenInput = document.getElementById('tokenInput');
  
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const feedbackBox = document.getElementById('feedbackBox');

  // Load saved config
  chrome.storage.sync.get(['githubToken', 'githubOwner', 'githubRepo'], (items) => {
    if (items.githubOwner) ownerInput.value = items.githubOwner;
    if (items.githubRepo) repoInput.value = items.githubRepo;
    if (items.githubToken) tokenInput.value = items.githubToken;
    
    updateStatusAndStats();
  });

  // Save button click
  saveBtn.addEventListener('click', () => {
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const token = tokenInput.value.trim();

    if (!owner || !repo || !token) {
      showFeedback('All configuration fields are required.', false);
      return;
    }

    if (!token.startsWith('gh')) {
      showFeedback('Invalid GitHub token. Must start with "gh" (e.g., ghp_ or github_pat_).', false);
      return;
    }

    // Save to storage
    chrome.storage.sync.set({
      githubOwner: owner,
      githubRepo: repo,
      githubToken: token
    }, () => {
      showFeedback('Configuration saved successfully!', true);
      updateStatusAndStats();
    });
  });

  // Test button click
  testBtn.addEventListener('click', async () => {
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const token = tokenInput.value.trim();

    if (!owner || !repo || !token) {
      showFeedback('Fill in all fields to test the connection.', false);
      return;
    }

    // Disable inputs and buttons
    setUIBusy(true);
    showFeedback('Testing connection...', true);

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (response.status === 200) {
        const repoData = await response.json();
        const visibility = repoData.private ? 'Private' : 'Public';
        showFeedback(`✓ Connected! Repo: ${repoData.name} (${visibility})`, true);
      } else if (response.status === 401) {
        showFeedback('✗ Error 401: Unauthorized. Bad/expired token.', false);
      } else if (response.status === 404) {
        showFeedback('✗ Error 404: Repository not found. Check Owner/Repo names.', false);
      } else {
        showFeedback(`✗ Error: Connection failed with status ${response.status}.`, false);
      }
    } catch (e) {
      console.error(e);
      showFeedback('✗ Network error. Failed to reach api.github.com.', false);
    } finally {
      setUIBusy(false);
    }
  });

  // Update Status LED and request stats from background
  function updateStatusAndStats() {
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const token = tokenInput.value.trim();

    if (owner && repo && token && token.startsWith('gh')) {
      statusDot.className = 'status-dot ready';
      statusText.textContent = 'Ready to Track';
      loadStats();
    } else {
      statusDot.className = 'status-dot';
      statusText.textContent = 'Unconfigured';
      resetStatsGrid();
    }
  }

  // Load stats from background worker
  function loadStats() {
    // Show '-' placeholders during reload
    resetStatsGrid();

    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Message failed:', chrome.runtime.lastError);
        return;
      }

      if (response) {
        document.getElementById('statTotal').textContent = response.total ?? 0;
        document.getElementById('statEasy').textContent = response.easy ?? 0;
        document.getElementById('statMedium').textContent = response.medium ?? 0;
        document.getElementById('statHard').textContent = response.hard ?? 0;
        document.getElementById('todayCount').textContent = response.todayCount ?? 0;
      }
    });
  }

  function resetStatsGrid() {
    document.getElementById('statTotal').textContent = '–';
    document.getElementById('statEasy').textContent = '–';
    document.getElementById('statMedium').textContent = '–';
    document.getElementById('statHard').textContent = '–';
    document.getElementById('todayCount').textContent = '–';
  }

  // Helper to show alert inline feedback
  function showFeedback(msg, isSuccess) {
    feedbackBox.textContent = msg;
    if (isSuccess) {
      feedbackBox.className = 'feedback-msg success';
    } else {
      feedbackBox.className = 'feedback-msg error';
    }
  }

  // Disable UI elements during connection testing
  function setUIBusy(isBusy) {
    saveBtn.disabled = isBusy;
    testBtn.disabled = isBusy;
    ownerInput.disabled = isBusy;
    repoInput.disabled = isBusy;
    tokenInput.disabled = isBusy;
  }
});
