// --- DOM Elements ---
const timeLimitInput = document.getElementById('timeLimit');
const newEntryInput = document.getElementById('newEntry');
const addEntryBtn = document.getElementById('addEntryBtn');
const blockListUl = document.getElementById('blockList');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const statusDiv = document.getElementById('status');
const blockNowBtn = document.getElementById('blockNowBtn');
const timerValueSpan = document.getElementById('timer-value');
const timerContainer = document.getElementById('timer-container');

const BREAK_URL = 'https://www.google.com/';

// Variables for local timer tracking
let localTimeSpent = 0;
let localTimerInterval = null;
let isOnBlockedSite = false;

// --- Functions ---

/**
 * Renders the block list in the popup UI.
 * @param {string[]} list - Array of blocked URLs/keywords.
 * @param {boolean} isInBreak - Whether we're currently in a break period.
 */
function renderBlockList(list, isInBreak = false) {
    blockListUl.innerHTML = ''; // Clear existing list
    if (!list || list.length === 0) {
        blockListUl.innerHTML = '<li>No sites/keywords blocked yet.</li>';
        return;
    }
    list.forEach((entry, index) => {
        const li = document.createElement('li');
        const textSpan = document.createElement('span');
        textSpan.textContent = entry;

        li.appendChild(textSpan);

        if (!isInBreak) {
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.dataset.index = index;
            removeBtn.addEventListener('click', handleRemoveEntry);
            li.appendChild(removeBtn);
        }

        li.classList.add('fade-in');
        setTimeout(() => li.classList.remove('fade-in'), 500);

        blockListUl.appendChild(li);
    });
}

/**
 * Loads settings from chrome.storage and updates the UI.
 */
async function loadSettings() {
    try {
        const data = await chrome.storage.sync.get(['blockedEntries', 'allowedTimeMinutes', 'timeSpent', 'breakEndTime']);
        const allowedTime = data.allowedTimeMinutes ?? 30;
        const blockedEntries = data.blockedEntries ?? [];
        const timeSpent = data.timeSpent ?? 0;
        const breakEndTime = data.breakEndTime ?? null;

        const now = Date.now();
        const isInBreak = breakEndTime && now < breakEndTime;

        if (!isInBreak && breakEndTime) {
            localTimeSpent = 0;
        }

        localTimeSpent = timeSpent;

        timeLimitInput.value = allowedTime;
        renderBlockList(blockedEntries, isInBreak);
        updateStatus(allowedTime, timeSpent, breakEndTime);

    } catch (error) {
        console.error("Error loading settings:", error);
        statusDiv.textContent = "Error loading settings.";
    }
}

/**
 * Saves the current settings from the UI to chrome.storage.
 */
async function saveSettings() {
    const allowedTime = parseInt(timeLimitInput.value, 10);
    if (isNaN(allowedTime) || allowedTime < 1) {
        alert("Please enter a valid time limit (minimum 1 minute).");
        return;
    }

    const data = await chrome.storage.sync.get(['blockedEntries']);
    const currentBlockedEntries = data.blockedEntries ?? [];

    try {
        await chrome.storage.sync.set({
            allowedTimeMinutes: allowedTime,
            blockedEntries: currentBlockedEntries
        });
        statusDiv.textContent = "Settings saved!";
        setTimeout(() => updateStatus(allowedTime, data.timeSpent ?? 0, data.breakEndTime ?? null), 1500);
    } catch (error) {
        console.error("Error saving settings:", error);
        statusDiv.textContent = "Error saving settings.";
    }
}

/**
 * Handles adding a new entry to the block list.
 */
async function handleAddEntry() {
    const newEntry = newEntryInput.value.trim().toLowerCase();
    if (!newEntry) {
        alert("Please enter a URL or keyword to block.");
        return;
    }

    try {
        const data = await chrome.storage.sync.get(['blockedEntries', 'breakEndTime']);
        const currentList = data.blockedEntries ?? [];
        const breakEndTime = data.breakEndTime ?? null;
        const now = Date.now();
        const isInBreak = breakEndTime && now < breakEndTime;

        if (!currentList.includes(newEntry)) {
            const updatedList = [...currentList, newEntry];
            await chrome.storage.sync.set({
                blockedEntries: updatedList,
                allowedTimeMinutes: parseInt(timeLimitInput.value, 10)
            });
            renderBlockList(updatedList, isInBreak);
            newEntryInput.value = '';
            statusDiv.textContent = `${newEntry} added. ⚠️ Click "Save Settings" to apply changes!`;
        } else {
            alert(`${newEntry} is already in the block list.`);
        }
    } catch (error) {
        console.error("Error adding entry:", error);
        statusDiv.textContent = "Error adding entry.";
    }
}

/**
 * Handles removing an entry from the block list based on button click.
 * @param {Event} event - The click event from the remove button.
 */
async function handleRemoveEntry(event) {
    const indexToRemove = parseInt(event.target.dataset.index, 10);

    try {
        const data = await chrome.storage.sync.get(['blockedEntries', 'breakEndTime']);
        const currentList = data.blockedEntries ?? [];
        const breakEndTime = data.breakEndTime ?? null;
        const now = Date.now();
        const isInBreak = breakEndTime && now < breakEndTime;

        if (indexToRemove >= 0 && indexToRemove < currentList.length) {
            const entryToRemove = currentList[indexToRemove];
            const updatedList = currentList.filter((_, index) => index !== indexToRemove);
            await chrome.storage.sync.set({ blockedEntries: updatedList });
            renderBlockList(updatedList, isInBreak);
            statusDiv.textContent = `"${entryToRemove}" removed.Remember to Save.`;
        }
    } catch (error) {
        console.error("Error removing entry:", error);
        statusDiv.textContent = "Error removing entry.";
    }
}

/**
 * Updates the status message based on current state.
 * @param {number} allowedTime - Allowed time in minutes.
 * @param {number} timeSpent - Time spent in milliseconds.
 * @param {number | null} breakEndTime - Timestamp when break ends, or null.
 */
async function updateStatus(allowedTime, timeSpent, breakEndTime) {
    const now = Date.now();

    if (localTimeSpent === 0 && timeSpent > 0) {
        localTimeSpent = timeSpent;
    }

    if (breakEndTime && now >= breakEndTime) {
        localTimeSpent = 0;
        await chrome.storage.sync.set({
            timeSpent: 0,
            breakEndTime: null
        });
    }

    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeUrl = activeTab?.url ?? '';

        const data = await chrome.storage.sync.get(['blockedEntries']);
        const blockedEntries = data.blockedEntries ?? [];

        const isBlocked = blockedEntries.some(entry => activeUrl.toLowerCase().includes(entry.toLowerCase()));

        if (isBlocked !== isOnBlockedSite) {
            isOnBlockedSite = isBlocked;
            if (isBlocked) {
                startLocalTimer();
            } else {
                stopLocalTimer();
            }
        }

        // Check if any timer is active to disable the settings button
        let isTimerActive = false;

        if (breakEndTime && now < breakEndTime) {
            const breakRemainingMs = breakEndTime - now;
            const breakMins = Math.floor(breakRemainingMs / 60000);
            const breakSecs = Math.floor((breakRemainingMs % 60000) / 1000);

            displayTimer(`${String(breakMins).padStart(2, '0')}:${String(breakSecs).padStart(2, '0')}`, true);
            statusDiv.textContent = `On break - timer will resume soon`;
            timerContainer.style.display = 'block';
            isTimerActive = true;
        } else if (activeUrl === BREAK_URL) {
            displayTimer("00:00", false);
            statusDiv.textContent = `Take a breath.`;
            timerContainer.style.display = 'block';
        } else if (isBlocked) {
            const allowedMs = allowedTime * 60 * 1000;
            const remainingMs = Math.max(0, allowedMs - localTimeSpent);

            const mins = Math.floor(remainingMs / 60000);
            const secs = Math.floor((remainingMs % 60000) / 1000);

            displayTimer(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, false);

            if (remainingMs <= 1000) {
                statusDiv.textContent = "Time's up! Redirecting...";
            } else {
                statusDiv.textContent = `Blocked site - time remaining`;
                isTimerActive = true;
            }

            timerContainer.style.display = 'block';

            await syncTimeWithStorage();
        } else {
            timerContainer.style.display = 'none';
            statusDiv.textContent = 'No blocked sites active';
        }

        // Update the save button state based on timer activity
        updateSaveButtonState(isTimerActive);

    } catch (error) {
        console.error("Error updating status:", error);
        statusDiv.textContent = "Error updating status.";
        displayTimer("--:--", false);
        timerContainer.style.display = 'block';
    }
}

/**
 * Updates the save button state - enabling or disabling it based on timer status
 * @param {boolean} isTimerActive - Whether a timer is currently active
 */
function updateSaveButtonState(isTimerActive) {
    if (isTimerActive) {
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.classList.add('disabled');
        saveSettingsBtn.title = "Cannot update settings while timer is active";
    } else {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.classList.remove('disabled');
        saveSettingsBtn.title = "Save current settings";
    }
}

/**
 * Helper function to display timer and manage classes
 * @param {string} timeText - Formatted time to display
 * @param {boolean} isBreak - Whether this is break time
 */
function displayTimer(timeText, isBreak) {
    timerValueSpan.textContent = timeText;
    if (isBreak) {
        timerValueSpan.classList.add('break-time');
    } else {
        timerValueSpan.classList.remove('break-time');
    }
}

/**
 * Starts the local timer to track time spent on blocked sites
 */
function startLocalTimer() {
    if (localTimerInterval) {
        clearInterval(localTimerInterval);
    }

    localTimerInterval = setInterval(() => {
        localTimeSpent += 1000;
        updateTimerUI();
    }, 1000);
}

/**
 * Stops the local timer
 */
function stopLocalTimer() {
    if (localTimerInterval) {
        clearInterval(localTimerInterval);
        localTimerInterval = null;
        syncTimeWithStorage();
    }
}

/**
 * Updates just the timer UI without fetching from storage
 */
function updateTimerUI() {
    try {
        if (!isOnBlockedSite) return;

        const allowedTime = parseInt(timeLimitInput.value, 10) || 30;
        const allowedMs = allowedTime * 60 * 1000;
        const remainingMs = Math.max(0, allowedMs - localTimeSpent);

        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);

        displayTimer(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, false);

        if (remainingMs <= 1000) {
            statusDiv.textContent = "Time's up! Redirecting...";
            // Button can be enabled once time is up
            updateSaveButtonState(false);
        } else {
            // Disable button while timer is running
            updateSaveButtonState(true);
        }
    } catch (error) {
        console.error("Error updating timer UI:", error);
    }
}

/**
 * Synchronizes the local time with storage
 */
async function syncTimeWithStorage() {
    try {
        const data = await chrome.storage.sync.get(['timeSpent', 'breakEndTime']);
        const storageTimeSpent = data.timeSpent ?? 0;
        const breakEndTime = data.breakEndTime ?? null;
        const now = Date.now();

        if (breakEndTime && now > breakEndTime) {
            localTimeSpent = 0;
            return;
        }

        if (localTimeSpent > storageTimeSpent) {
            await chrome.storage.sync.set({ timeSpent: localTimeSpent });
        } else if (storageTimeSpent > localTimeSpent) {
            localTimeSpent = storageTimeSpent;
        }
    } catch (error) {
        console.error("Error syncing time with storage:", error);
    }
}

/**
 * Immediately sets remaining time to 0 and starts a break period
 */
async function handleBlockNow() {
    try {
        const data = await chrome.storage.sync.get(['allowedTimeMinutes', 'blockedEntries']);
        const allowedTimeMinutes = data.allowedTimeMinutes ?? 30;
        const allowedTimeMs = allowedTimeMinutes * 60 * 1000;
        const blockedEntries = data.blockedEntries ?? [];

        const now = Date.now();
        const newBreakEndTime = now + allowedTimeMs;

        await chrome.storage.sync.set({
            timeSpent: allowedTimeMs,
            breakEndTime: newBreakEndTime,
            lastCheckTimestamp: now
        });

        statusDiv.textContent = "Break started! Sites will be blocked.";
        renderBlockList(blockedEntries, true);

        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.url) {
            const isBlocked = blockedEntries.some(entry =>
                activeTab.url.toLowerCase().includes(entry.toLowerCase())
            );

            if (isBlocked) {
                await chrome.tabs.update(activeTab.id, { url: BREAK_URL });
            }
        }

        timerContainer.style.display = 'block';

        // Disable settings button when break starts
        updateSaveButtonState(true);

        setTimeout(() => {
            updateStatus(allowedTimeMinutes, allowedTimeMs, newBreakEndTime);
        }, 1500);

    } catch (error) {
        console.error("Error triggering immediate block:", error);
        statusDiv.textContent = "Error starting break.";
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', async () => {
    timerContainer.style.display = 'none';

    localTimeSpent = 0;

    const data = await chrome.storage.sync.get(['breakEndTime', 'timeSpent']);
    const breakEndTime = data.breakEndTime ?? null;
    const timeSpent = data.timeSpent ?? 0;
    const now = Date.now();

    if (breakEndTime && now > breakEndTime) {
        await chrome.storage.sync.set({
            timeSpent: 0,
            breakEndTime: null
        });
    } else {
        localTimeSpent = timeSpent;
    }

    loadSettings();

    // Initialize button state (enabled by default)
    updateSaveButtonState(false);
});
addEntryBtn.addEventListener('click', handleAddEntry);
saveSettingsBtn.addEventListener('click', saveSettings);
blockNowBtn.addEventListener('click', handleBlockNow);

window.addEventListener('beforeunload', () => {
    syncTimeWithStorage();
    stopLocalTimer();
});

chrome.tabs.onActivated.addListener(() => {
    loadSettings();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        loadSettings();
    }
});

newEntryInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleAddEntry();
    }
});

setInterval(async () => {
    try {
        const data = await chrome.storage.sync.get(['allowedTimeMinutes', 'timeSpent', 'breakEndTime']);
        updateStatus(data.allowedTimeMinutes ?? 30, data.timeSpent ?? 0, data.breakEndTime ?? null);
    } catch (error) {
        console.error("Error fetching status update:", error);
    }
}, 1000);