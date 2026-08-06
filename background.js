speechSynthesis.addEventListener("voiceschanged", () => {
  speechSynthesis.getVoices();
});

// --------------------
// Look at account
// --------------------

async function findSpecialFolders(accountId)
{
  const allFolders = await messenger.folders.query();
  // prefer exact or exact-prefix match, PRIORITY folders
  const foundFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    isSpecialPath(f.path) && 
    getFolderDepth(f.path) == 1
  );

  if (foundFolders.length == 0) {
    await install_folders(accountId);
  }

  return foundFolders;
}


async function findRebuildableFolders(accountId)
{
  const allFolders = await messenger.folders.query({
    hasMessages: true
  });
  
  const nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.name && 
    f.name.includes('[REBUILD]')
  );

  if (nameFolders.length == 0) {
    const pathFolders = allFolders.filter((f) => f && 
      f.accountId === accountId &&  
      f.path && f.path.includes('[REBUILD]')
    );
    return pathFolders;
  }
  else {
    return nameFolders;
  }
}


async function findEmptyFolders(accountId)
{
  if (await allowFolderCreation() == false) {
    return [];
  }

  const allFolders = await messenger.folders.query({
    hasMessages: false,
    hasSubFolders: false,
    isRoot: false
  });

  let nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    f.path.includes('[REBUILD]')
  );

  if (nameFolders.length) {
    return nameFolders;
  }

  nameFolders = allFolders.filter((f) => f && 
    f.accountId === accountId &&
    isSpecialPath(f.path) &&
    getFolderDepth(f.path) > 1
  );

  return nameFolders;
}


async function findFolderIdWithPath(accountId, mailboxPath) {

  if (!accountId) {
    throw new Error('accountId required');
  }

  if (!mailboxPath) {
    throw new Error('mailboxPath required');
  }

  console.log('findFolderIdWithPath: looking for', mailboxPath, '[accountId]', accountId);

  const allFolders = await messenger.folders.query();
  const folders = allFolders.filter((f) => 
    f.accountId === accountId &&
    f.path.toUpperCase() === mailboxPath.toUpperCase()
  );

  if (!folders) {
    throw new Error('Folder name not found');
  }
  else if (folders.length > 1) {
    console.log(folders);
    throw new Error('Folder name is ambiguous');
  }
  else if (folders.length == 1) {
    return folders[0].id;
  }
  else {
    return null;
  }
}


function isSpecialPath(folderPath)
{
  return folderPath.startsWith('/PRIORITY-') 
}


// --------------------
// Create folders
// --------------------
// Relevant APIs:
//   https://webextension-api.thunderbird.net/en/mv3/folders.html#
//   https://webextension-api.thunderbird.net/en/mv3/messages.html
// --------------------

async function renderMessageDomain(Message) {
  if (!Message) {
    console.log('renderMessageDomain: no message provided');
    return null;
  }
  const author = Message.author || Message.from || '';
  // try to extract the email address
  const angleMatch = author.match(/<([^>]+)>/);
  const email = angleMatch ? angleMatch[1] : (author.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) || [null])[0];
  if (!email) {
    console.log('renderMessageDomain: no email parsed from author', author);
    return null;
  }

  let domain = email.replace('@', '.@.');
  let splits = domain.split('.');
  splits.reverse();
  let finalDomain = splits.join('.').toLowerCase();
  finalDomain = finalDomain.replace('.@.', ' @ ');
  // use the domain (e.g., gmail.com) as folder partial name
  console.log('renderMessageDomain: extracted domain', finalDomain);
  return finalDomain;
}


async function getSingleEmailAddress(Message) {

  const emailAddress = await messenger.messengerUtilities.parseMailboxString(Message.author).then(function(ParsedMailboxList) {
    return ParsedMailboxList[0];
  });

  let emailParts = emailAddress.email.split('@');
  let tmpDomain = emailParts[1].toLowerCase();
  let splits = tmpDomain.split('.');
  splits.reverse();

  emailAddress.email_user = emailParts[0];
  emailAddress.email_domain = emailParts[1];
  emailAddress.email_domain_sortable = splits.join('.');

  if (tmpDomain == 'gmail.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'yahoo.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'wordpress.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'live.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'hotmail.com')
      emailAddress.multi_tenant_domain = true;
  else if (tmpDomain == 'substack.com')
      emailAddress.multi_tenant_domain = true;
  else
      emailAddress.multi_tenant_domain = false;

//  console.log(emailAddress);

  return emailAddress;
}

// @todo pick this for new domains
// this needs to handle: gmail, wordpress, substack
// factor in reply-to and list-id

async function renderMessageFolderNamesImproved(Message)
{
  const domainFolder = await renderMessageDomain(Message);
  const emailAddress = await getSingleEmailAddress(Message);
  const userFolder = emailAddress.name + ' ' + Message.date.getFullYear();
  return domainFolder + '/' + userFolder;
}


async function renderMessageFolderNames(Message)
{
  const emailAddress = await getSingleEmailAddress(Message);
  const domainFolder = emailAddress.email_domain_sortable;
  let userFolder;

  if (await is_newsletter(Message)) {
    userFolder = Message.date.getFullYear() + ' ';
  }
  else {
    userFolder = '(Messages) ';
  }

  userFolder += emailAddress.email_user;

  if (emailAddress.name)
    userFolder += ' (' + emailAddress.name.slice(0, 40) + ')';
  
  return domainFolder + '/' + userFolder;
}


async function pickActualFolderName(Message)
{
  const partialFolderName = await renderMessageFolderNames(Message);
  const domainFolder = getParentFolderPath(partialFolderName);
  const topFolder = getTopLevelFolder(Message.folder.path);
  const accountId = Message.folder.accountId;
  const folders = await messenger.folders.query();
  const existing = folders.find((f) => 
    f.accountId == accountId && 
    f.name == domainFolder
  );
  let fallbackFolderName = null;
  
  console.log('looking for ' + partialFolderName, 'accountId', accountId);

  if (existing) {
    console.log('pickActualFolderName: found existing domain folder', existing);
    fallbackFolderName = getParentFolderPath(existing.path) + '/' + partialFolderName;
  }
  else if (isSpecialPath(topFolder)) {
    // Create a domain subfolder under the PRIORITY folder if it exists
    console.log('pickActualFolderName: found PRIORITY folder');
    fallbackFolderName = topFolder + '/' + partialFolderName;
  }
  else if (await is_newsletter(Message)) {
    const similarCount = await getSimilarEmailsCount(Message);
    if (similarCount > 1) {
      speakMessageWithCounts('Found # similar email(s), creating folder', similarCount);
      fallbackFolderName = '/AUTO-SORT/' + partialFolderName;
    }
    else {
      fallbackFolderName = '/AUTO-SORT/UNRECOGNIZED-NEWSLETTER';
    }
  }
  else {
    const similarCount = await getSimilarEmailsCount(Message);
    if (similarCount > 1) {
      speakMessageWithCounts('Found # similar email(s), creating folder', similarCount);
      fallbackFolderName = '/AUTO-SORT/' + partialFolderName;
    }
    else {
      // do not create a folder for a single email in the INBOX, put in staging folder first
      fallbackFolderName = '/AUTO-SORT/UNRECOGNIZED-EMAIL';
    }
  }
  

  if (fallbackFolderName.includes('[REBUILD]')) {
    console.log('pickActualFolderName: cancelling folder creation');
    return null;
  }

  if (fallbackFolderName.includes('Trash')) {
    console.log('pickActualFolderName: cancelling folder creation');
    return null;
  }

  let createdId = null;

  try {
    createdId = await create_and_return_folder(fallbackFolderName, accountId);
  }
  catch (error) {
    console.warn(error)
    speak('Exception occurred');
    speak(error.message);

    createdId = await create_and_return_folder('/AUTO-SORT/ERROR-ENCOUNTERED', accountId);
  }

  // create a new folder with the partial name
  return createdId;
}


function withTimeout(firstPromise, ms, message) {
  return firstPromise;

  return Promise.race([
    firstPromise,
    new Promise (
      (_, reject) => setTimeout (
        () => reject(
          new Error(message)
        ), 
        ms
      )
    ),
  ]);
}


function getParentFolderPath(fullFolderName) {

  const parentPath = fullFolderName.substring(0, fullFolderName.lastIndexOf('/'));

  if (parentPath.length > 0)
    return parentPath;
  else
    return '/';
}


function getTopLevelFolder(fullFolderName) {
  if (getFolderDepth(fullFolderName) > 1) {
    return getTopLevelFolder(getParentFolderPath(fullFolderName));
  }
  else {
    console.log('getTopLevelFolder:', fullFolderName);
    return fullFolderName;    
  }
}


function getFolderDepth(fullFolderName) {
  const depth = fullFolderName.trim('/').split('/').length - 1;
  return depth;
}


async function delete_folder(folderObject)
{
  if (await allowFolderCreation() == false) {
    speak('Folder deletion is disabled');
    return null;
  }

  const fullFolderName = folderObject.path;

  if (getFolderDepth(fullFolderName) > 1)
  {
    const folderInfo = await messenger.folders.getFolderInfo(folderObject.id);

    if (folderInfo.totalMessageCount == 0) {
      console.log('delete_folder:', fullFolderName);
      await messenger.folders.delete(folderObject.id);
    }
  }
  else {
    console.log('delete_folder: skipping', fullFolderName);
  }

  return null;
}


async function install_folders(accountId)
{
  console.log('Installing folders');
  await create_and_return_folder('/PRIORITY-HEALTH', accountId);
  await create_and_return_folder('/PRIORITY-MONEY', accountId);
  await create_and_return_folder('/PRIORITY-PEOPLE', accountId);
  await create_and_return_folder('/PRIORITY-PLACES', accountId);
  await create_and_return_folder('/PRIORITY-SPIRIT', accountId);
}


async function create_and_return_folder(fullFolderName, accountId) {

  if (!fullFolderName) {
    throw new Error('fullFolderName required');
  }

  const folderId = await findFolderIdWithPath(accountId, fullFolderName);

  if (folderId) {
    return folderId;
  }

  const parentFolderName = getParentFolderPath(fullFolderName);
  const singleFolderName = fullFolderName.substring(fullFolderName.lastIndexOf('/') + 1);

  // prefer to create under the source account first

  if (fullFolderName == parentFolderName) {
    throw new Error('Stopped recursion');
  }

  console.log('create_and_return_folder: recursive call to create parent');
  const parentId = await create_and_return_folder(parentFolderName, accountId);

  if (!parentId) {
    throw new Error('parentId not found');
  }

  if (await allowFolderCreation() == false) {
    speak('Folder creation is disabled');
    return null;
  }

  speak('Creating folder: ' + singleFolderName);

  const created = await withTimeout(
    messenger.folders.create(parentId, singleFolderName),
    10000,
    `create_and_return_folder: messenger.folders.create timed out after 10000ms for folder ${singleFolderName}`
  );
  console.log('create_and_return_folder: created result', created);
  return (created) ? created.id : created;
}


// --------------------
// Move things
// --------------------
// Relevant APIs:
//   https://webextension-api.thunderbird.net/en/mv3/folders.html
//   https://webextension-api.thunderbird.net/en/mv3/messages.html
// --------------------

async function cleanupFolder(accountId, mailboxName) {
  const messageList = await getMessagesInFolder(accountId, mailboxName, await getEmailFetchLimit());
  const accountName = await getAccountName(accountId);

  speakMessageWithCounts(
    'Moving # email(s) in '  + accountName + ' ' + mailboxName + ' folder', 
    messageList.messages.length
  );

  let count = 0;
  for (const message of messageList.messages) {
    count++;
    console.log('Moving Email', count, 'of', messageList.messages.length);
    await moveSingleMessage(message);
  }

  speakMessageWithCounts(
    'Finished moving # email(s)', 
    messageList.messages.length
  );

  return count;
}


async function getAccountName(accountId) {
  return 'Email ' + accountId;
}


async function getMessagesInFolder(accountId, folderName, limit = null) {

  if (limit == 0) {
    return [];
  }

  const inboxId = await findFolderIdWithPath(accountId, folderName);

  // @todo These will work for v148 and later
  const listSortOptions = {
    sortOrder: 'descending',
    sortType: 'date'
  };

  const messageList = await messenger.messages.list(inboxId);

  if (limit > 0) {
    messageList.messages = messageList.messages.slice(0, limit);
  }

  return messageList;
}


async function moveSingleMessage(movingMessage)
{
  const newfolderId = await pickActualFolderName(movingMessage);

  if (!newfolderId) {
    throw new Error('Could not pick actual folder');
  }

  const ids = [movingMessage.id].filter(Boolean);
  let result;

  if (await getEmailFetchLimit() == 0) {
    console.log('Single message movement is disabled');
    return null;
  }

  result = await withTimeout(
    messenger.messages.move(ids, newfolderId),
    10000,
    `moveSingleMessage: messenger.messages.move timed out after 10000ms for folder ${newfolderId}`
  );

  console.log('moveSingleMessage: move result', result, 'ids', ids, 'destination', newfolderId);
  return result;
}


async function bulkMoveMessages(accountId, MessageList, staticFolder) {
  // normalize to an array of message objects
  const messagesArray = MessageList.messages || [];
  const ids = messagesArray.map((m) => m.id).filter(Boolean);
  if (!ids.length) {
    console.log('bulkMoveMessages: no message ids found');
    return null;
  }

  const newfolderId = await findFolderIdWithPath(accountId, staticFolder);

  if (await getEmailFetchLimit() == 0) {
    speak('Message movement is disabled');
    return null;
  }

  console.log('bulkMoveMessages: moving', ids, 'to static folder', staticFolder);
  const staticResult = await messenger.messages.move(ids, newfolderId);
  console.log('bulkMoveMessages: static move result', staticResult);
  return staticResult;
}


// --------------------
// Semantic Analysis
// --------------------

async function getSimilarEmailsCount(Message) {

  // query for the counts
  const messageList = await messenger.messages.query({
    accountId: Message.accountId,
    author: Message.author,
  });

  return messageList.messages.length;
}


async function hasVideo(Message)
{
  const lowerSubject = Message.subject.toLowerCase();

  if (lowerSubject.includes('video')) {
    return true;
  }

  if (lowerSubject.includes('watch now')) {
    return true;
  }

  return false;
}


async function is_newsletter(Message) {

  // https://webextension-api.thunderbird.net/en/mv3/messages.html#messages-headers-dictionary

  const fullObject = await messenger.messages.getFull(Message.id);
  const headers = fullObject.headers;
  let newsletterHeaders = 0;

  if (Object.hasOwn(headers, 'list-unsubscribe')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-unsubscribe-post')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-subscribe')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'list-id')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'x-campaignid')) {
    newsletterHeaders++;
  }
  else if (Object.hasOwn(headers, 'precedence')) {
    if (headers.precedence == 'bulk')
      newsletterHeaders++;
    else if (headers.precedence == 'list')
      newsletterHeaders++;
  }
  else {
    // @todo we can check for more headers or the email content itself
    console.log(headers);
  }

  if (newsletterHeaders > 0)
    return true;

  return false;
}




// --------------------
// Announce things
// --------------------

function formatSenderLabel(author) {
  if (!author) {
    return "unknown sender";
  }

  if (typeof messenger.messages.parseMailboxString === "function") {
    const parsed = messenger.messages.parseMailboxString(author);
    if (parsed?.name) {
      return parsed.name;
    }
    if (parsed?.email) {
      return parsed.email;
    }
  }

  const match = author.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].replace(/^["']|["']$/g, "").trim();
    return name || match[2].trim();
  }

  return author;
}

function speak(text) {

  let betterText = text.trim();
  betterText = betterText.replace(' | ', '; ');
  betterText = betterText.replace('-', ' ');
  console.log('SPEAK: ' + betterText);

  // @todo lower system volume first
  // https://developer.mozilla.org/en-US/docs/Web/API/Audio_Session_API

  // https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(betterText);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

async function announceMessages(messageList) {

  let unspokenMessages = 0;

  for (const message of messageList.messages) {
    if (message.date.toDateString() == new Date().toDateString()) {

      if (unspokenMessages == 0) {
        await singleAnnouncement(message);
      }
      
      unspokenMessages++;
    }
  }

  // Announce the amount of emails if more than one
  if (unspokenMessages > 1) {
    speakMessageWithCounts('You have # new message(s)', unspokenMessages);
  }
}


async function singleAnnouncement(message)
{
    const emailAddress = await getSingleEmailAddress(message);
    const sender = emailAddress.name ? emailAddress.name : emailAddress.email;

    if (await hasVideo(message)) {
      speak(`You've got a video from ${sender}`);
    }
    else if (await is_newsletter(message)) {
      speak(`You've got a newsletter from ${sender}`);
    }
    else {
      speak(`You've got mail from ${sender}`);
    }

    if (message.subject) {
      speak(`Subject: ${message.subject}`);
    }
}


function speakMessageWithCounts(verbiage, count) {
  const withNumber = verbiage.replace('#', count);
  let finalMessage = withNumber;
  if (count == 1) {
    finalMessage = withNumber.replace('(s)', '');
  }
  else {
    finalMessage = withNumber.replace('(s)', 's');
  }

  if (count > 0) {
    speak(finalMessage)
  }
  else {
    console.log(finalMessage)
  }
}



// --------------------
// Permissions
// --------------------


async function allowAccountManagement(accountRecord) {

  if (accountRecord.type == 'imap') {
    console.log('Managing mail account: ' + accountRecord.name);
    return true;
  }

  console.log('Not Managing Account', accountRecord);
  return false;
}


const SETTINGS_KEY = 'youve-got-mail-settings';
const DEFAULT_SETTINGS = {
  allowFolderCreation: true,
  allowInboxCleanup: false,
  emailFetchLimit: 1,
};

async function getSettings() {
  const result = await messenger.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] || {}),
  };
}

async function getEmailFetchLimit() {
  const settings = await getSettings();
  return Number(settings.emailFetchLimit) || DEFAULT_SETTINGS.emailFetchLimit;
}


async function allowFolderCreation() {
  const settings = await getSettings();
  return Boolean(settings.allowFolderCreation);
}

async function allowInboxCleanup() {
  const settings = await getSettings();
  return Boolean(settings.allowInboxCleanup);
}


// --------------------
// Listeners
// --------------------

messenger.messages.onNewMailReceived.addListener((_folder, messageList) => {
  announceMessages(messageList);
});


messenger.idle.onStateChanged.addListener(async (IdleState) => {

  const browser = await messenger.runtime.getBrowserInfo();

  if (IdleState == 'idle') {

    // The background.js will be unloaded when the client goes idle.

    const existingAlarm = await messenger.alarms.get('idle-alarm');

    if (existingAlarm)
      return;

    const periodMinutes = 20;
    const nowMinutes = new Date().getMinutes();
    const reducedNowMinutes = (nowMinutes > periodMinutes) ? nowMinutes % periodMinutes : nowMinutes;
    const delayMinutes = periodMinutes - reducedNowMinutes;

    speak(`Setting alarm to trigger every ${periodMinutes} minutes, starting in ${delayMinutes} minutes.`);
    
    messenger.alarms.create('idle-alarm', {
      delayInMinutes: delayMinutes,
      periodInMinutes: periodMinutes
    });
  }
  else {
    speak(browser.name + ' is now ' + IdleState);
    messenger.alarms.clear('idle-alarm');
  }

});


async function runningIdle(accountId) {
  try {

    console.log('runningIdle for account', accountId);

    const specialFolders = await findSpecialFolders(accountId);

    for (const folder of specialFolders) {
      await cleanupFolder(accountId, folder.path);
    }


    const purgableFolders = await findRebuildableFolders(accountId);
    speakMessageWithCounts('Found # folder(s) marked to rebuild', purgableFolders.length);

    for (const folder of purgableFolders) {
      let allMessages = await getMessagesInFolder(accountId, folder.path, await getEmailFetchLimit());
      await bulkMoveMessages(accountId, allMessages, '/INBOX');
      await delete_folder(folder);
      break;
    }


    const emptyFolders = await findEmptyFolders(accountId);
    speakMessageWithCounts('Found # empty folder(s) to delete', emptyFolders.length);

    for (const folder of emptyFolders) {
      await delete_folder(folder);
      break;
    }

    if (await allowInboxCleanup()) {
      await cleanupFolder(accountId, '/INBOX');
    }
    else {
      console.log('Not cleaning up the INBOX');
    }

  }
  catch (error) {
    console.warn(error)
    speak('Exception occurred');
    speak(error.message);
  }
}


messenger.alarms.onAlarm.addListener(async (alarmObject) => {

  const currentTime = new Date().toLocaleTimeString()
  const shorterTime = currentTime.replace(/:\d{2}\s/, ' '); // Remove seconds from the time string
  speak('The time is now ' + shorterTime);
  speak('Triggering: ' + alarmObject.name);

  if (alarmObject.name == 'idle-alarm') {

    // https://webextension-api.thunderbird.net/en/mv3/accounts.html#list-includesubfolders

    const accounts = await messenger.accounts.list();

    for (const account of accounts) {
      if (await allowAccountManagement(account)) {
        await runningIdle(account.id);
      }
    }
  }

});


// --------------------
// Test Listeners
// --------------------

messenger.messageDisplay.onMessagesDisplayed.addListener((_tab, messageList) => {

  const firstMessage = messageList.messages[0];

  if (firstMessage.folder.name == 'ANNOUNCE') {
    speak('Test announcement');
    singleAnnouncement(firstMessage);
  }

});


messenger.folders.onUpdated.addListener((originalFolder, updatedFolder) => {

  if (updatedFolder.name == 'IDLE') {
    speak('Test folder updated');
    console.log(updatedFolder);
    runningIdle(updatedFolder.accountId);
  }

});

