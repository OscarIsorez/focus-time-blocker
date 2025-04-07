// --- DOM Elements ---
const timeLimitInput = document.getElementById('timeLimit');
const newEntryInput = document.getElementById('newEntry');
const addEntryBtn = document.getElementById('addEntryBtn');
const blockListUl = document.getElementById('blockList');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const statusDiv = document.getElementById('status');

// --- Functions ---

/**
 * Renders the block list in the popup UI.
 * @param {string[]} list - Array of blocked URLs/keywords.
 */
function renderBlockList(list) {
    blockListUl.innerHTML = ''; // Clear existing list
    if (!list || list.length === 0) {
        blockListUl.innerHTML = '<li>No sites/keywords blocked yet.</li>';
        return;
    }
    list.forEach((entry, index) => {
        const li = document.createElement('li');
        const textSpan = document.createElement('span');
        textSpan.textContent = entry;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.dataset.index = index; // Store index for removal
        removeBtn.addEventListener('click', handleRemoveEntry);

        li.appendChild(textSpan);
        li.appendChild(removeBtn);
        blockListUl.appendChild(li);
    });
}

/**
 * Loads settings from chrome.storage and updates the UI.
 */
async function loadSettings() {
    try {
        const data = await chrome.storage.sync.get(['blockedEntries', 'allowedTimeMinutes', 'timeSpent', 'breakEndTime']);
        console.log("Loaded settings:", data); // Debugging line
        const allowedTime = data.allowedTimeMinutes ?? 30; // Default to 30 mins
        const blockedEntries = data.blockedEntries ?? []; // Default to empty array
        const timeSpent = data.timeSpent ?? 0;
        const breakEndTime = data.breakEndTime ?? null;

        timeLimitInput.value = allowedTime;
        renderBlockList(blockedEntries);
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

    // Get current block list from UI state (or storage if more robust needed)
    // Here, we re-read from storage to ensure consistency
    const data = await chrome.storage.sync.get(['blockedEntries']);
    const currentBlockedEntries = data.blockedEntries ?? [];

    try {
        await chrome.storage.sync.set({
            allowedTimeMinutes: allowedTime,
            blockedEntries: currentBlockedEntries // List is modified via add/remove handlers
        });
        // Optionally: Inform the background script settings changed if needed immediately
        // await chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED" });
        statusDiv.textContent = "Settings saved!";
        setTimeout(() => updateStatus(allowedTime, data.timeSpent ?? 0, data.breakEndTime ?? null), 1500); // Revert status message
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
    console.log("Adding entry:", newEntry);
    if (!newEntry) {
        alert("Please enter a URL or keyword to block.");
        return;
    }

    try {
        const data = await chrome.storage.sync.get(['blockedEntries']);
        const currentList = data.blockedEntries ?? [];

        if (!currentList.includes(newEntry)) {
            const updatedList = [...currentList, newEntry];
            await chrome.storage.sync.set({
                blockedEntries: updatedList,
                // Also save the current time limit when adding an entry
                allowedTimeMinutes: parseInt(timeLimitInput.value, 10)
            });
            renderBlockList(updatedList);
            newEntryInput.value = '';
            statusDiv.textContent = `"${newEntry}" added. ⚠️ Click "Save Settings" to apply changes!`;
        } else {
            alert(`"${newEntry}" is already in the block list.`);
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
        const data = await chrome.storage.sync.get(['blockedEntries']);
        const currentList = data.blockedEntries ?? [];

        if (indexToRemove >= 0 && indexToRemove < currentList.length) {
            const entryToRemove = currentList[indexToRemove];
            const updatedList = currentList.filter((_, index) => index !== indexToRemove);
            await chrome.storage.sync.set({ blockedEntries: updatedList });
            renderBlockList(updatedList); // Update UI immediately
            statusDiv.textContent = `"${entryToRemove}" removed. Remember to Save.`;
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
function updateStatus(allowedTime, timeSpent, breakEndTime) {
    const now = Date.now();
    if (breakEndTime && now < breakEndTime) {
        const breakMinsRemaining = Math.ceil((breakEndTime - now) / 60000);
        statusDiv.textContent = `On break for ${breakMinsRemaining} more min(s).`;
    } else {
        const allowedMs = allowedTime * 60 * 1000;
        const remainingMs = Math.max(0, allowedMs - timeSpent);
        const remainingMins = Math.ceil(remainingMs / 60000);
        statusDiv.textContent = `Time remaining: ${remainingMins} min(s).`;
    }
}


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', loadSettings);
addEntryBtn.addEventListener('click', handleAddEntry);
saveSettingsBtn.addEventListener('click', saveSettings);

// Add listener for Enter key in the input field
newEntryInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission if it were in a form
        handleAddEntry();
    }
});

// --- Periodic Status Update (Optional but good UX) ---
// Fetch latest status from background or storage periodically while popup is open
setInterval(async () => {
    try {
        const data = await chrome.storage.sync.get(['allowedTimeMinutes', 'timeSpent', 'breakEndTime']);
        updateStatus(data.allowedTimeMinutes ?? 30, data.timeSpent ?? 0, data.breakEndTime ?? null);
    } catch (error) {
        console.error("Error fetching status update:", error);
    }
}, 5000); // Update status every 5 seconds