// --- Constants ---
const STORAGE_KEYS = {
    ALLOWED_TIME: 'allowedTimeMinutes',
    BLOCKED_ENTRIES: 'blockedEntries',
    TIME_SPENT: 'timeSpent', // Time spent on blocked sites today/session (in ms)
    BREAK_END_TIME: 'breakEndTime', // Timestamp (ms) when the current break ends
    LAST_CHECK_TIME: 'lastCheckTimestamp' // Timestamp of the last time check
};
const CHECK_ALARM_NAME = 'siteBlockerCheckAlarm';
const BREAK_URL = 'https://www.google.com/'; // Redirect target

// --- Initialization ---

// Set default values on installation
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log("Focus Time Blocker installed or updated.", details.reason);
    await setDefaultSettings();
    await createTrackingAlarm();
    console.log("Initial setup complete.");
});

// Ensure alarm exists on browser startup
chrome.runtime.onStartup.addListener(async () => {
    console.log("Browser started, ensuring alarm exists.");
    await createTrackingAlarm();
});

/**
 * Sets default settings in storage if they don't exist.
 */
async function setDefaultSettings() {
    try {
        const currentSettings = await chrome.storage.sync.get([
            STORAGE_KEYS.ALLOWED_TIME,
            STORAGE_KEYS.BLOCKED_ENTRIES,
            STORAGE_KEYS.TIME_SPENT,
            STORAGE_KEYS.BREAK_END_TIME,
            STORAGE_KEYS.LAST_CHECK_TIME
        ]);

        const defaults = {
            [STORAGE_KEYS.ALLOWED_TIME]: currentSettings[STORAGE_KEYS.ALLOWED_TIME] ?? 30,
            [STORAGE_KEYS.BLOCKED_ENTRIES]: currentSettings[STORAGE_KEYS.BLOCKED_ENTRIES] ?? [],
            [STORAGE_KEYS.TIME_SPENT]: currentSettings[STORAGE_KEYS.TIME_SPENT] ?? 0,
            [STORAGE_KEYS.BREAK_END_TIME]: currentSettings[STORAGE_KEYS.BREAK_END_TIME] ?? null,
            [STORAGE_KEYS.LAST_CHECK_TIME]: currentSettings[STORAGE_KEYS.LAST_CHECK_TIME] ?? Date.now() // Initialize last check
        };

        await chrome.storage.sync.set(defaults);
        console.log("Default settings ensured:", defaults);
    } catch (error) {
        console.error("Error setting default settings:", error);
    }
}

/**
 * Creates the periodic alarm for checking tabs if it doesn't exist.
 */
async function createTrackingAlarm() {
    try {
        const alarm = await chrome.alarms.get(CHECK_ALARM_NAME);
        if (!alarm) {
            // Check every minute. Adjust frequency as needed (balance accuracy and performance)
            chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: 1 });
            console.log("Tracking alarm created.");
        } else {
            console.log("Tracking alarm already exists.");
        }
    } catch (error) {
        console.error("Error creating/checking alarm:", error);
    }
}

// --- Core Logic ---

/**
 * Checks if a given URL matches any of the blocked entries (URL or keyword).
 * @param {string} url - The URL to check.
 * @param {string[]} blockedEntries - Array of blocked URLs/keywords.
 * @returns {boolean} - True if the URL is blocked, false otherwise.
 */
function isUrlBlocked(url, blockedEntries) {
    if (!url || !blockedEntries || blockedEntries.length === 0) {
        return false;
    }
    const lowerUrl = url.toLowerCase();
    return blockedEntries.some(entry => lowerUrl.includes(entry.toLowerCase()));
}

/**
 * Redirects a specific tab to the break URL.
 * @param {number} tabId - The ID of the tab to redirect.
 */
async function redirectToBreak(tabId) {
    try {
        await chrome.tabs.update(tabId, { url: BREAK_URL });
        console.log(`Tab ${tabId} redirected to break URL.`);
    } catch (error) {
        // Handle cases where the tab might have been closed etc.
        console.warn(`Failed to redirect tab ${tabId}:`, error.message);
    }
}

/**
 * The main function called by the alarm to check time and enforce blocks/breaks.
 */
async function checkActiveTabAndManageTime() {
    console.log("Alarm triggered: Checking active tab...");
    const now = Date.now();

    try {
        const data = await chrome.storage.sync.get([
            STORAGE_KEYS.ALLOWED_TIME,
            STORAGE_KEYS.BLOCKED_ENTRIES,
            STORAGE_KEYS.TIME_SPENT,
            STORAGE_KEYS.BREAK_END_TIME,
            STORAGE_KEYS.LAST_CHECK_TIME
        ]);

        const {
            [STORAGE_KEYS.ALLOWED_TIME]: allowedTimeMinutes,
            [STORAGE_KEYS.BLOCKED_ENTRIES]: blockedEntries,
            [STORAGE_KEYS.TIME_SPENT]: currentTimeSpent,
            [STORAGE_KEYS.BREAK_END_TIME]: breakEndTime,
            [STORAGE_KEYS.LAST_CHECK_TIME]: lastCheckTimestamp
        } = data;

        const allowedTimeMs = (allowedTimeMinutes ?? 30) * 60 * 1000;

        // 1. Check if a break is ongoing
        if (breakEndTime && now < breakEndTime) {
            console.log(`Currently on break until ${new Date(breakEndTime).toLocaleTimeString()}`);
            await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_CHECK_TIME]: now });
            return;
        }

        // 2. Reset state if the break is over
        let updatedTimeSpent = currentTimeSpent;
        if (breakEndTime && now >= breakEndTime) {
            console.log("Break finished. Resetting timer.");
            updatedTimeSpent = 0;
            await chrome.storage.sync.set({
                [STORAGE_KEYS.BREAK_END_TIME]: null,
                [STORAGE_KEYS.TIME_SPENT]: 0
            });
        }

        // 3. Check the active tab
        const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTabs || activeTabs.length === 0) {
            console.log("No active tab found.");
            await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_CHECK_TIME]: now });
            return;
        }

        const activeTab = activeTabs[0];
        if (activeTab.url && isUrlBlocked(activeTab.url, blockedEntries)) {
            const timeElapsedMs = now - (lastCheckTimestamp ?? now);
            updatedTimeSpent += timeElapsedMs;

            console.log(`Blocked site active (${activeTab.url}). Time spent: ${Math.round(updatedTimeSpent / 1000)}s / ${allowedTimeMinutes * 60}s`);

            // 4. Notify user if time is almost up
            const remainingTimeMs = allowedTimeMs - updatedTimeSpent;
            if (remainingTimeMs <= 60000 && remainingTimeMs > 0) { // Less than 1 minute remaining
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/ICON_16.png',
                    title: 'Focus Time Blocker',
                    message: 'You have less than 1 minute remaining on this site!'
                });
            }

            // 5. Check if the time limit is reached
            if (updatedTimeSpent >= allowedTimeMs) {
                console.log("Time limit exceeded. Starting break.");
                const breakDurationMs = allowedTimeMs;
                const newBreakEndTime = now + breakDurationMs;

                await chrome.storage.sync.set({
                    [STORAGE_KEYS.TIME_SPENT]: updatedTimeSpent,
                    [STORAGE_KEYS.BREAK_END_TIME]: newBreakEndTime,
                    [STORAGE_KEYS.LAST_CHECK_TIME]: now
                });

                await redirectToBreak(activeTab.id);
                return;
            }
        }

        // 6. Update time spent
        await chrome.storage.sync.set({
            [STORAGE_KEYS.TIME_SPENT]: updatedTimeSpent,
            [STORAGE_KEYS.LAST_CHECK_TIME]: now
        });

    } catch (error) {
        console.error("Error during periodic check:", error);
        await chrome.storage.sync.set({ [STORAGE_KEYS.LAST_CHECK_TIME]: now });
    }
}

// --- Event Listeners ---

// Listener for the alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CHECK_ALARM_NAME) {
        checkActiveTabAndManageTime();
    }
});

// Optional: Add an onUpdated listener for faster redirection during breaks
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Check only when URL changes or page fully loads, and we have a URL
    if ((changeInfo.url || changeInfo.status === 'complete') && tab.url) {
        try {
            const data = await chrome.storage.sync.get([STORAGE_KEYS.BREAK_END_TIME, STORAGE_KEYS.BLOCKED_ENTRIES]);
            const breakEndTime = data[STORAGE_KEYS.BREAK_END_TIME];
            const blockedEntries = data[STORAGE_KEYS.BLOCKED_ENTRIES] ?? [];
            const now = Date.now();

            // If currently on break and the updated tab matches a blocked entry
            if (breakEndTime && now < breakEndTime && isUrlBlocked(tab.url, blockedEntries)) {
                // Avoid redirect loop
                if (!tab.url.startsWith(BREAK_URL)) {
                    console.log(`[onUpdated] Redirecting tab ${tabId} (${tab.url}) during break.`);
                    await redirectToBreak(tabId);
                }
            }
        } catch (error) {
            console.error("Error in onUpdated listener:", error);
        }
    }
});