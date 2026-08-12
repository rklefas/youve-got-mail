const DEFAULT_SETTINGS = {
  allowFolderCreation: true,
  allowInboxCleanup: false,
  emailFetchLimit: 1,
  periodMinutes: 2,
  speakEnabled: true,
};

const STORAGE_KEY = 'youve-got-mail-settings';

async function loadSettings() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEY] || {}),
  };
}

function applySettings(settings) {
  document.getElementById('allow-folder-creation').checked = Boolean(settings.allowFolderCreation);
  document.getElementById('allow-message-movement').checked = Boolean(settings.allowInboxCleanup);
  document.getElementById('enable-speech').checked = Boolean(settings.speakEnabled);
  document.getElementById('email-fetch-limit').value = settings.emailFetchLimit || DEFAULT_SETTINGS.emailFetchLimit;
  document.getElementById('period-minutes').value = settings.periodMinutes || DEFAULT_SETTINGS.periodMinutes;
}

async function saveSettings() {
  const parsedPeriodMinutes = Number.parseInt(document.getElementById('period-minutes').value, 10);
  const settings = {
    allowFolderCreation: document.getElementById('allow-folder-creation').checked,
    allowInboxCleanup: document.getElementById('allow-message-movement').checked,
    speakEnabled: document.getElementById('enable-speech').checked,
    emailFetchLimit: Number(document.getElementById('email-fetch-limit').value),
    periodMinutes: Number.isInteger(parsedPeriodMinutes) && parsedPeriodMinutes > 0
      ? parsedPeriodMinutes
      : DEFAULT_SETTINGS.periodMinutes,
  };

  await browser.storage.local.set({ [STORAGE_KEY]: settings });

  const status = document.getElementById('status');
  status.textContent = 'Settings saved.';

  const reloaded = await loadSettings();

  console.log('Saved Settings:', reloaded)
}

(async () => {
  const settings = await loadSettings();
  applySettings(settings);

  document.getElementById('save').addEventListener('click', saveSettings);
})();
